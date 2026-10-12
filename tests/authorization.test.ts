import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Authorization, checkCallbackPort } from "../src/core/authorization.ts";
import { AuthorizationBrowser } from "../src/desktop/authorization-browser.ts";
import { Pi, Vault } from "../src/core/pi.ts";
import { Store } from "../src/core/store.ts";
import type { AuthorizationState, LoginInput } from "../src/shared/types.ts";

const input = (
	method: LoginInput["method"] = "browser",
	provider = "openai-codex",
): LoginInput => ({ attemptId: randomUUID(), provider, method });
async function until<T>(fn: () => T | undefined | false): Promise<T> {
	for (let i = 0; i < 500; i++) {
		const result = fn();
		if (result) return result;
		await delay(10);
	}
	throw new Error("Timed out waiting for authorization state");
}
const token = () =>
	Response.json({
		access_token: `test.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64")}.signature`,
		refresh_token: "fixture-refresh-only",
		expires_in: 3600,
	});
async function harness() {
	const dir = mkdtempSync(join(tmpdir(), "picareer-auth-")),
		states: AuthorizationState[] = [];
	const store = new Store(dir),
		crypt = async (op: string, value: string) =>
			op === "encrypt"
				? Buffer.from(value).toString("base64")
				: Buffer.from(value, "base64").toString();
	const vault = new Vault(store, crypt);
	const pi = new Pi(
		dir,
		vault,
		() => ({
			provider: "custom",
			model: "",
			api: "openai-completions",
			baseUrl: "https://example.invalid/v1",
		}),
		(e) => {
			if (e.type === "authorization") states.push(e.state);
		},
		async () => {
			throw new Error("OAuth must not use generic prompts");
		},
	);
	await pi.init();
	return { pi, states, store, vault, dir, crypt };
}

test("real Pi browser OAuth: callback state, token exchange, persistence and model status", async (t) => {
	const h = await harness(),
		request = input();
	t.after(async () => {
		await h.pi.authorization.cancel(request.attemptId);
		h.store.close();
	});
	const fetchOriginal = globalThis.fetch;
	let exchanged = 0;
	t.mock.method(
		globalThis,
		"fetch",
		async (url: string | URL | Request, init?: RequestInit) => {
			const address = String(url);
			if (address.startsWith("http://127.0.0.1:1455/"))
				return fetchOriginal(url, init);
			assert.equal(
				address,
				"https://auth.openai.com/oauth/token",
				"No external service may be called by the test",
			);
			const body = new URLSearchParams(String(init?.body));
			assert.equal(body.get("code"), "fixture-code");
			assert.equal(
				body.get("redirect_uri"),
				"http://localhost:1455/auth/callback",
			);
			assert.ok((body.get("code_verifier")?.length ?? 0) >= 32);
			exchanged++;
			return token();
		},
	);
	const done = h.pi.authorization.start(request);
	const waiting = await until(() => h.states.find((s) => s.prompt && s.url));
	assert.equal(waiting.prompt!.kind, "manual_code");
	assert.equal(
		h.states.some((s) => s.prompt?.kind === "select"),
		false,
		"Codex browser selection is automatic",
	);
	assert.equal(
		(
			await fetchOriginal(
				"http://127.0.0.1:1455/auth/callback?state=wrong&code=fixture-code",
			)
		).status,
		400,
	);
	const state = new URL(waiting.url!).searchParams.get("state")!;
	assert.equal(
		(await fetchOriginal(`http://127.0.0.1:1455/auth/callback?state=${state}`))
			.status,
		400,
	);
	const result = await fetchOriginal(
		`http://127.0.0.1:1455/auth/callback?state=${state}&code=fixture-code`,
	);
	assert.equal(result.status, 200);
	assert.equal((await done).status, "succeeded");
	assert.equal(exchanged, 1);
	assert.equal(h.states.at(-1)?.url, undefined);
	assert.equal(h.states.at(-1)?.prompt, undefined);
	assert.equal(
		(await h.pi.models()).providers.find((p) => p.id === "openai-codex")
			?.credentialType,
		"oauth",
	);
	assert.equal((await h.vault.read("openai-codex"))?.type, "oauth");
	assert.ok(
		!h.store
			.get<string>("secrets", "openai-codex")!
			.includes("fixture-refresh-only"),
	);
	const reopened = new Store(h.dir),
		restored = new Vault(reopened, h.crypt);
	try {
		assert.equal((await restored.read("openai-codex"))?.type, "oauth");
		const restarted = new Pi(
			h.dir,
			restored,
			h.pi.settings,
			() => {},
			async () => "",
		);
		await restarted.init();
		assert.equal(
			(await restarted.models()).providers.find((p) => p.id === "openai-codex")
				?.credentialType,
			"oauth",
		);
	} finally {
		reopened.close();
	}
	await checkCallbackPort();
});

test("real Pi cancellation clears manual prompt and listener; duplicate/late input cannot affect retry", async (t) => {
	const h = await harness();
	t.after(() => h.store.close());
	for (let index = 0; index < 3; index++) {
		const request = input(),
			done = h.pi.authorization.start(request);
		t.after(() => h.pi.authorization.cancel(request.attemptId));
		assert.equal(
			h.pi.authorization.start(request),
			done,
			"Duplicate starts share one attempt",
		);
		await assert.rejects(h.pi.authorization.start(input()), /正在进行/);
		const waiting = await until(() =>
			h.states.find(
				(s) => s.attemptId === request.attemptId && s.prompt && s.url,
			),
		);
		assert.throws(
			() =>
				h.pi.authorization.reply(request.attemptId, waiting.prompt!.id, " "),
			/请输入/,
		);
		assert.throws(
			() =>
				h.pi.authorization.reply(
					request.attemptId,
					waiting.prompt!.id,
					"http://localhost:1455/auth/callback?code=fixture&state=old",
				),
			/本次授权/,
		);
		assert.equal(await h.pi.authorization.cancel("unrelated-attempt"), false);
		assert.equal(await h.pi.authorization.cancel(request.attemptId), true);
		assert.equal((await done).status, "cancelled");
		assert.equal(h.states.at(-1)?.url, undefined);
		assert.equal(h.states.at(-1)?.prompt, undefined);
		assert.equal(
			h.pi.authorization.reply(
				request.attemptId,
				waiting.prompt!.id,
				"old-code",
			),
			false,
		);
		await checkCallbackPort();
	}
	assert.equal((await h.vault.list()).length, 0);
});

test("occupied callback port fails before displaying a login URL and does not disturb listener", async () => {
	const server = createServer();
	await new Promise<void>((resolve) =>
		server.listen(1455, "127.0.0.1", resolve),
	);
	try {
		let called = false;
		const auth = new Authorization(
			async () => {
				called = true;
			},
			() => {},
		);
		const result = await auth.start(input());
		assert.equal(result.status, "failed");
		assert.equal(result.details, "CALLBACK_PORT_UNAVAILABLE");
		assert.equal(result.url, undefined);
		assert.equal(called, false);
		assert.equal(server.listening, true);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

test("real Pi device code and manual callback fallback use the existing token flow", async (t) => {
	const h = await harness();
	t.after(() => h.store.close());
	let mode = "device",
		exchanges = 0;
	t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
		const address = String(url);
		if (address === "https://auth.openai.com/api/accounts/deviceauth/usercode")
			return Response.json({
				device_auth_id: "fixture-device",
				user_code: "TEST-CODE",
				interval: 0,
			});
		if (address === "https://auth.openai.com/api/accounts/deviceauth/token")
			return Response.json({
				authorization_code: "fixture-code",
				code_verifier: "fixture-verifier",
			});
		assert.equal(address, "https://auth.openai.com/oauth/token");
		exchanges++;
		if (mode === "failure")
			return new Response("fixture-secret-must-not-escape", { status: 401 });
		return token();
	});
	const device = await h.pi.authorization.start(input("device_code"));
	assert.equal(device.status, "succeeded");
	assert.ok(
		h.states.some(
			(s) =>
				s.userCode === "TEST-CODE" &&
				s.expiresAt &&
				s.url?.endsWith("/codex/device"),
		),
	);
	for (mode of ["manual", "failure"]) {
		const request = input(),
			done = h.pi.authorization.start(request);
		t.after(() => h.pi.authorization.cancel(request.attemptId));
		const waiting = await until(() =>
			h.states.find(
				(s) => s.attemptId === request.attemptId && s.prompt && s.url,
			),
		);
		const state = new URL(waiting.url!).searchParams.get("state");
		assert.equal(
			h.pi.authorization.reply(
				request.attemptId,
				waiting.prompt!.id,
				`http://localhost:1455/auth/callback?state=${state}&code=fixture-code`,
			),
			true,
		);
		assert.equal(
			h.pi.authorization.reply(
				request.attemptId,
				waiting.prompt!.id,
				"duplicate",
			),
			false,
		);
		const result = await done;
		assert.equal(result.status, mode === "failure" ? "failed" : "succeeded");
		assert.equal(result.url, undefined);
		assert.ok(!JSON.stringify(result).includes("fixture-secret"));
		await checkCallbackPort();
	}
	assert.equal(exchanges, 3);
});

test("timeout, global abort, provider prompt abort and generic providers settle without empty replies", async () => {
	let states: AuthorizationState[] = [];
	const auth = new Authorization(
		async (_p, interaction) => {
			await interaction.prompt({
				type: "manual_code",
				message: "fixture input",
				signal: new AbortController().signal,
			});
		},
		(s) => states.push(s),
		{ timeout: 35 },
	);
	const result = await auth.start(input("browser", "fixture-provider"));
	assert.equal(result.status, "failed");
	assert.equal(result.details, "AUTH_TIMEOUT");
	assert.equal(result.prompt, undefined);
	states = [];
	let entered = "";
	const generic = new Authorization(
		async (_p, i) => {
			entered = await i.prompt({ type: "secret", message: "fixture secret" });
		},
		(s) => states.push(s),
	);
	const request = input("browser", "fixture-provider"),
		done = generic.start(request);
	const prompt = await until(() => states.find((s) => s.prompt)?.prompt);
	assert.equal(
		generic.reply(request.attemptId, prompt.id, "fixture-input"),
		true,
	);
	assert.equal((await done).status, "succeeded");
	assert.equal(entered, "fixture-input");
	let promptClosed = false;
	const providerAbort = new Authorization(
		async (_p, i) => {
			const controller = new AbortController();
			const waiting = i.prompt({
				type: "manual_code",
				message: "fixture",
				signal: controller.signal,
			});
			controller.abort();
			await assert.rejects(waiting);
		},
		(s) => {
			if (s.status === "waiting" && !s.prompt) promptClosed = true;
		},
	);
	assert.equal(
		(await providerAbort.start(input("browser", "fixture-provider"))).status,
		"succeeded",
	);
	assert.equal(promptClosed, true);
});

test("network failure is localized and contains no source URL or token", async () => {
	const auth = new Authorization(
		async () => {
			throw new Error(
				"fetch failed https://example.invalid/?code=fixture-private",
			);
		},
		() => {},
	);
	const result = await auth.start(input("browser", "fixture-provider"));
	assert.equal(result.details, "AUTH_NETWORK_ERROR");
	assert.ok(!JSON.stringify(result).includes("fixture-private"));
});

test("cancelling during credential encryption preserves the existing credential", async () => {
	const store = new Store(mkdtempSync(join(tmpdir(), "picareer-auth-vault-")));
	const controller = new AbortController();
	let cancelOnEncryption = false;
	const vault = new Vault(store, async (op, value) => {
		if (op === "decrypt") return Buffer.from(value, "base64").toString();
		if (cancelOnEncryption) controller.abort(new Error("cancel before commit"));
		return Buffer.from(value).toString("base64");
	});
	try {
		await vault.modify("fixture", async () => ({
			type: "api_key",
			key: "previous-fixture-key",
		}));
		cancelOnEncryption = true;
		await assert.rejects(
			vault.modify(
				"fixture",
				async () => ({
					type: "oauth",
					access: "new-fixture-access",
					refresh: "new-fixture-refresh",
					expires: Date.now() + 100000,
				}),
				{ signal: controller.signal },
			),
			/cancel before commit/,
		);
		assert.deepEqual(await vault.read("fixture"), {
			type: "api_key",
			key: "previous-fixture-key",
		});
		assert.equal((await vault.list())[0].type, "api_key");
	} finally {
		store.close();
	}
});

test("other providers retain optional text defaults and explicit choice prompts", async () => {
	const states: AuthorizationState[] = [];
	let defaultValue = "not submitted",
		choice = "";
	const auth = new Authorization(
		async (_p, i) => {
			defaultValue = await i.prompt({
				type: "text",
				message: "GitHub Enterprise URL/domain (blank for github.com)",
			});
			choice = await i.prompt({
				type: "select",
				message: "Choose",
				options: [
					{ id: "one", label: "One" },
					{ id: "two", label: "Two" },
				],
			});
		},
		(s) => states.push(s),
	);
	const request = input("browser", "fixture-provider"),
		done = auth.start(request);
	const optional = await until(
		() => states.find((s) => s.prompt?.kind === "text")?.prompt,
	);
	assert.equal(auth.reply(request.attemptId, optional.id, ""), true);
	const select = await until(
		() => states.find((s) => s.prompt?.kind === "select")?.prompt,
	);
	assert.throws(() => auth.reply(request.attemptId, select.id, "bad"), /有效/);
	auth.reply(request.attemptId, select.id, "two");
	assert.equal((await done).status, "succeeded");
	assert.equal(defaultValue, "");
	assert.equal(choice, "two");
});

test("expired authorization and disabled device login provide actionable errors", async () => {
	for (const [error, expected] of [
		["invalid_grant fixture-secret", "AUTH_EXPIRED"],
		[
			"OpenAI Codex device code login is not enabled for this server",
			"AUTH_DEVICE_NOT_ENABLED",
		],
	]) {
		const auth = new Authorization(
			async () => {
				throw new Error(error);
			},
			() => {},
		);
		const result = await auth.start(input("device_code"));
		assert.equal(result.status, "failed");
		assert.equal(result.details, expected);
		assert.equal(result.url, undefined);
		assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
	}
});

test("desktop browser bridge opens once, permits retry/copy, invalidates stale links and ignores late completion", async () => {
	const states: AuthorizationState[] = [],
		opened: string[] = [],
		copied: string[] = [];
	let finishOpen: () => void = () => {};
	const bridge = new AuthorizationBrowser(
		(url) => {
			opened.push(url);
			return new Promise<void>((resolve) => {
				finishOpen = resolve;
			});
		},
		(url) => {
			copied.push(url);
		},
		(s) => states.push(s),
	);
	const request = input(),
		waiting: AuthorizationState = {
			...request,
			status: "waiting",
			message: "waiting",
			url: "https://auth.openai.com/oauth/authorize?state=fixture",
			expiresAt: Date.now() + 30000,
		};
	bridge.arm(request);
	bridge.receive(waiting);
	bridge.receive(waiting);
	assert.equal(opened.length, 1);
	await bridge.link(request.attemptId, "copy");
	assert.equal(copied.length, 1);
	bridge.receive({ ...waiting, status: "cancelled", url: undefined });
	finishOpen();
	await delay(0);
	assert.equal(states.at(-1)?.status, "cancelled");
	assert.equal(states.at(-1)?.url, undefined);
	await assert.rejects(bridge.link(request.attemptId, "open"), /失效/);
	const next = input();
	bridge.arm(next);
	bridge.receive(waiting);
	assert.equal(opened.length, 1);
	bridge.fail("后台已退出");
	assert.equal(states.at(-1)?.details, "AUTH_BACKEND_UNAVAILABLE");
});

test("desktop browser failures are recoverable; expired URLs cannot open or copy", async () => {
	const states: AuthorizationState[] = [];
	let fail = true;
	const bridge = new AuthorizationBrowser(
		async () => {
			if (fail) throw new Error("OS failure");
		},
		() => {},
		(s) => states.push(s),
	);
	const request = input(),
		waiting: AuthorizationState = {
			...request,
			status: "waiting",
			message: "waiting",
			url: "https://auth.openai.com/oauth/authorize",
			expiresAt: Date.now() + 30000,
		};
	bridge.arm(request);
	bridge.receive(waiting);
	await delay(0);
	assert.equal(states.at(-1)?.browser, "failed");
	fail = false;
	assert.equal(await bridge.link(request.attemptId, "open"), true);
	assert.equal(states.at(-1)?.browser, "opened");
	bridge.receive({ ...waiting, expiresAt: Date.now() - 1 });
	await assert.rejects(bridge.link(request.attemptId, "copy"), /失效/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ProxyAgent } from "undici";
import { createCodexFetch, proxyRoute } from "../src/core/codex-network.ts";
import { Authorization, checkCallbackPort } from "../src/core/authorization.ts";
import { authProgress } from "../src/core/auth-context.ts";
import { Pi, Vault } from "../src/core/pi.ts";
import { Store } from "../src/core/store.ts";
import type { AuthorizationState } from "../src/shared/types.ts";
const { codexServer, fixtureToken, ca } = await import(new URL("./fixtures/codex-server.mjs", import.meta.url).href);
const { decodeJwtPayload } = await import(new URL("../scripts/patch-sdk.mjs", import.meta.url).href);
const { openaiCodexOAuth } = await import(new URL("../resources/pi/node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js", import.meta.url).href);

test("JWT compatibility: URL-safe alphabet, padding, UTF-8, malformed payloads", () => {
	const segment = fixtureToken().split(".")[1];
	assert.match(segment, /-/); assert.match(segment, /_/);
	for (const p of [segment, Buffer.from(segment, "base64url").toString("base64")]) {
		assert.equal(decodeJwtPayload(p).name, "中文😀࠿࠾");
	}
	for (const p of ["!bad", "a", "====", Buffer.from([0xff]).toString("base64url"), Buffer.from("null").toString("base64url")]) assert.throws(() => decodeJwtPayload(p));
});

test("actual SDK refresh rejects missing account identity and missing token fields without disclosing tokens", async (t) => {
	for (const body of [
		{ access_token: fixtureToken({ "https://api.openai.com/auth": {} }), refresh_token: "fixture-private-refresh", expires_in: 3600 },
		{ access_token: "fixture-private-access" },
	]) {
		const mock = t.mock.method(globalThis, "fetch", async () => Response.json(body));
		try {
			await assert.rejects(openaiCodexOAuth.refresh({ refresh: "fixture" }, new AbortController().signal), (error: Error) => {
				assert.doesNotMatch(error.message, /fixture-private/);
				return /extract accountId|missing fields/.test(error.message);
			});
		} finally { mock.mock.restore(); }
	}
});

test("real Pi through local HTTPS proxy: callback, long token persistence, refresh and SSE", async (t) => {
	const server = await codexServer();
	const original = globalThis.fetch;
	const network = createCodexFetch(async (origin) => { assert.ok(["https://auth.openai.com", "https://chatgpt.com"].includes(origin)); return server.route; }, original,
		uri => new ProxyAgent({ uri, requestTls: { ca } }));
	t.mock.method(globalThis, "fetch", network.fetch);
	const dir = mkdtempSync(join(tmpdir(), "picareer-compat-"));
	const store = new Store(dir);
	const states: AuthorizationState[] = [];
	let storageFails = false;
	const vault = new Vault(store, async (op, value) => {
		if (storageFails) throw new Error("fixture-private-storage-error");
		return op === "encrypt" ? Buffer.from(value).toString("base64") : Buffer.from(value, "base64").toString();
	});
	let model = "";
	const pi = new Pi(dir, vault, () => ({ provider: "openai-codex", model, baseUrl: "", api: "openai-completions" }), e => { if (e.type === "authorization") states.push(e.state); }, async () => "");
	t.after(async () => { await network.close(); await server.close(); store.close(); });
	await pi.init();
	model = (await pi.models()).models.find(m => m.provider === "openai-codex")!.id;
	async function login() {
		states.length = 0;
		const done = pi.authorization.start({ provider: "openai-codex", method: "browser", attemptId: randomUUID() });
		for (let i = 0; i < 300 && !states.some(s => s.url && s.prompt); i++) await delay(10);
		const waiting = states.find(s => s.url && s.prompt)!;
		assert.ok(waiting);
		const state = new URL(waiting.url!).searchParams.get("state");
		const callback = await original(`http://127.0.0.1:1455/auth/callback?state=${state}&code=fixture-code`);
		const html = await callback.text();
		assert.match(html, /已收到授权结果/); assert.doesNotMatch(html, /Authentication successful/);
		return done;
	}
	assert.equal((await login()).status, "succeeded");
	assert.ok(["exchanging", "validating", "saving", "refreshing", "complete"].every(stage => states.some(s => s.stage === stage)));
	const credential = await vault.read("openai-codex");
	assert.equal(credential?.type, "oauth");
	const refreshed = await openaiCodexOAuth.refresh(credential, new AbortController().signal);
	assert.equal(refreshed.accountId, "fixture-account");
	assert.equal(await pi.complete("fixture", "hello"), "代理与令牌测试通过");
	assert.ok(server.tunnels.includes("auth.openai.com:443"));
	assert.ok(server.tunnels.includes("chatgpt.com:443"));
	assert.ok(server.calls.some((c: { grant: string }) => c.grant === "refresh_token"));
	assert.ok(server.calls.some((c: { path: string; authorizationMatches: boolean }) => c.path.includes("responses") && c.authorizationMatches));
	for (const [mode, category, stage] of [["403", "AUTH_HTTP_ERROR", "exchanging"], ["invalid", "AUTH_TOKEN_INVALID", "validating"], ["disconnect", "AUTH_NETWORK_ERROR", "exchanging"], ["success", "AUTH_STORAGE_ERROR", "saving"]]) {
		server.mode = mode; storageFails = category === "AUTH_STORAGE_ERROR";
		const before = server.calls.length;
		const result = await login();
		assert.equal(result.status, "failed"); assert.equal(result.diagnostic?.category, category); assert.equal(result.diagnostic?.stage, stage);
		assert.equal(server.calls.length - before, 1, "Authorization code must be exchanged once only");
		assert.ok(!JSON.stringify(result).includes("fixture-private"));
		assert.equal(result.url, undefined);
		await checkCallbackPort();
	}
	storageFails = false;
	assert.equal((await vault.read("openai-codex"))?.type, "oauth", "Failures retain previously saved credential");
	assert.ok(store.list("auth-diagnostic").length >= 4);
});

test("proxy choices never silently bypass configured proxy; unrelated fetch remains unchanged", async () => {
	assert.equal(proxyRoute("DIRECT"), undefined);
	assert.equal(proxyRoute("PROXY 127.0.0.1:7890; DIRECT"), "http://127.0.0.1:7890");
	assert.equal(proxyRoute("HTTPS proxy.example:443"), "https://proxy.example");
	assert.throws(() => proxyRoute("SOCKS5 127.0.0.1:7890; DIRECT"));
	assert.throws(() => proxyRoute("PROXY user:password@proxy.example:443"));
	let resolved = 0;
	const network = createCodexFetch(async () => { resolved++; throw new Error("AUTH_PROXY_RESOLUTION"); }, async () => new Response("unchanged"));
	try {
		assert.equal(await (await network.fetch("http://localhost:3000")).text(), "unchanged");
		assert.equal(resolved, 0);
		await assert.rejects(network.fetch("https://auth.openai.com/oauth/token"), /AUTH_PROXY_RESOLUTION/);
	} finally { await network.close(); }
});

test("token exchange timeout and cancellation terminate requests without retries", async (t) => {
	const timeout = AbortSignal.timeout.bind(AbortSignal);
	t.mock.method(AbortSignal, "timeout", () => timeout(20));
	let calls = 0;
	const network = createCodexFetch(async () => "DIRECT", async (_input, init) => {
		calls++;
		return new Promise((_resolve, reject) => {
			const abort = () => reject(init!.signal!.reason);
			if (init!.signal!.aborted) abort();
			else init!.signal!.addEventListener("abort", abort, { once: true });
		});
	});
	// AbortSignal.timeout is unref'ed; keep this isolated test alive until it fires.
	const keepAlive = setInterval(() => {}, 1000);
	try {
		await assert.rejects(network.fetch("https://auth.openai.com/oauth/token", { method: "POST" }), /AUTH_NETWORK_TIMEOUT/);
		assert.equal(calls, 1);
		const controller = new AbortController();
		const pending = network.fetch("https://auth.openai.com/oauth/token", { signal: controller.signal });
		controller.abort(new Error("cancel-fixture"));
		await assert.rejects(pending, /cancel-fixture/);
		assert.equal(calls, 1, "Cancelled before proxy resolution must not send a request");
	} finally { clearInterval(keepAlive); await network.close(); }
});

test("credential synchronization failure is saved authorization with retryable model refresh", async () => {
	const auth = new Authorization(async () => {
		authProgress("saving"); authProgress("refreshing");
		const error = new Error("fixture-private"); error.name = "CredentialSynchronizationError"; throw error;
	}, () => {}, { preflight: async () => {} });
	const result = await auth.start({ provider: "openai-codex", method: "browser", attemptId: randomUUID() });
	assert.equal(result.status, "succeeded"); assert.equal(result.modelsRefreshRequired, true);
	assert.equal(result.diagnostic?.category, "AUTH_MODEL_REFRESH_ERROR");
	assert.doesNotMatch(JSON.stringify(result), /fixture-private/);
});

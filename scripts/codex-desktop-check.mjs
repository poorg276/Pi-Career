import { _electron as electron } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { codexServer, fixtureToken } from "../tests/fixtures/codex-server.mjs";

const root = resolve(import.meta.dirname, ".."), scale = process.env.PICAREER_SCALE ?? "1.25";
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const out = join(root, ".test-data", `codex-${version}-${scale}`);
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(out, "data-")), fixture = await codexServer();
let app, page;
const errors = [];
async function launch() {
	app = await electron.launch({
		executablePath: process.env.PICAREER_EXE ?? join(root, "node_modules/electron/dist/electron.exe"),
		args: [...(process.env.PICAREER_EXE ? [] : [root]), `--force-device-scale-factor=${scale}`],
		env: { ...process.env, PICAREER_TEST_DATA: data, NODE_EXTRA_CA_CERTS: join(root, "tests/fixtures/codex-test-cert.pem") }, timeout: 60000,
	});
	page = await app.firstWindow();
	assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
	page.on("pageerror", e => errors.push(e.message));
	await page.getByRole("heading", { name: "PiCareer工作台" }).waitFor({ timeout: 60000 });
	await app.evaluate(async ({ session, shell, safeStorage, BrowserWindow }, proxy) => {
		await session.defaultSession.setProxy({ proxyRules: proxy });
		globalThis.__authOpened = [];
		shell.openExternal = async url => { globalThis.__authOpened.push(url); };
		globalThis.__storageFails = false;
		const encrypt = safeStorage.encryptStringAsync.bind(safeStorage);
		safeStorage.encryptStringAsync = value => globalThis.__storageFails ? Promise.reject(new Error("fixture-private-storage")) : encrypt(value);
		const win = BrowserWindow.getAllWindows()[0]; win.setSize(1024, 700); win.showInactive();
	}, fixture.proxy);
	await page.evaluate(() => { window.__states = []; window.__deltas = []; window.picareer.onEvent(e => { if(e.type === "authorization") window.__states.push(e.state); if(e.type === "chatUpdate") window.__deltas.push(e.chat.entries?.filter(m => m.role === "assistant").map(m => m.text).join("")); }); });
	await page.getByRole("button", { name: "模型与设置", exact: true }).click();
}
async function login(mode = "success") {
	fixture.mode = mode;
	await page.evaluate(() => { window.__states = []; });
	await page.locator(".oauth-row").filter({ hasText: "OpenAI Codex" }).getByRole("button", { name: /^(重新)?连接$/ }).click();
	await page.getByRole("dialog").waitFor();
	await page.waitForFunction(() => window.__states.some(s => s.url && s.prompt));
	const state = await page.evaluate(() => new URL(window.__states.find(s => s.url && s.prompt).url).searchParams.get("state"));
	const result = await fetch(`http://127.0.0.1:1455/auth/callback?state=${state}&code=fixture-code`);
	assert.match(await result.text(), /已收到授权结果/);
	if (mode !== "wait") await page.waitForFunction(() => ["succeeded", "failed"].includes(window.__states.at(-1)?.status), { timeout: 15000 });
	return page.evaluate(() => window.__states.at(-1));
}
try {
	await launch();
	let result = await login();
	assert.equal(result.status, "succeeded", JSON.stringify(result));
	const stages = await page.evaluate(() => [...new Set(window.__states.map(s => s.stage))]);
	assert.ok(["exchanging", "validating", "saving", "refreshing", "complete"].every(s => stages.includes(s)));
	await page.screenshot({ path: join(out, "success.png") });
	// Show a saved-credential / refresh-only warning without creating another login.
	await app.evaluate(({ BrowserWindow }, state) => BrowserWindow.getAllWindows()[0].webContents.send("event", { type: "authorization", state: { ...state, modelsRefreshRequired: true, message: "授权已保存，模型列表刷新失败。" } }), result);
	await page.getByRole("button", { name: "刷新模型列表", exact: true }).click();
	await page.getByText("已授权。模型列表已刷新，请选择模型，保存后测试连接。", { exact: true }).waitFor();
	await page.getByRole("button", { name: "选择模型", exact: true }).click();
	const options = await page.evaluate(() => window.picareer.call("models", null));
	assert.equal(options.providers.find(p => p.id === "openai-codex").credentialType, "oauth");
	const model = options.models.find(m => m.provider === "openai-codex").id;
	await page.evaluate(model => window.picareer.call("settings", { provider: "openai-codex", model, baseUrl: "", api: "openai-completions" }), model);
	assert.match(await page.evaluate(() => window.picareer.call("testModel", null)), /代理与令牌测试通过/);
	const chat = await page.evaluate(() => window.picareer.call("chat", { text: "fixture chat" }));
	assert.ok(chat.turns[0].context.contextWindow > 0); assert.ok(chat.turns[0].context.tokens > 0); assert.equal(chat.turns[0].status, "complete");
	assert.ok((await page.evaluate(() => window.__deltas.join(""))).includes("代理与令牌测试通过"));
	for (const [mode, category] of [["403", "AUTH_HTTP_ERROR"], ["invalid", "AUTH_TOKEN_INVALID"], ["success", "AUTH_STORAGE_ERROR"]]) {
		await app.evaluate((_electron, failure) => { globalThis.__storageFails = failure; }, category === "AUTH_STORAGE_ERROR");
		result = await login(mode);
		assert.equal(result.status, "failed"); assert.equal(result.diagnostic.category, category, JSON.stringify(result));
		assert.ok(!JSON.stringify(result).includes("fixture-private"));
		await page.getByText("技术详情", { exact: true }).click();
		if (mode === "403") await page.screenshot({ path: join(out, "http-error.png") });
		await page.getByRole("button", { name: "关闭", exact: true }).click();
	}
	await app.evaluate(() => { globalThis.__storageFails = false; });
	await login("wait");
	await page.waitForFunction(() => window.__states.at(-1)?.stage === "exchanging");
	await page.getByRole("button", { name: "取消授权", exact: true }).click();
	await page.waitForFunction(() => window.__states.at(-1)?.status === "cancelled");
	await page.getByRole("button", { name: "关闭", exact: true }).click();
	assert.equal((await login()).status, "succeeded");
	await page.getByRole("button", { name: "选择模型", exact: true }).click();
	const expiredCipher = await app.evaluate(async ({ safeStorage }, access) => (await safeStorage.encryptStringAsync(JSON.stringify({
		type: "oauth", access, refresh: "fixture-refresh", accountId: "fixture-account", expires: Date.now() - 60000,
	}))).toString("base64"), fixtureToken());
	await app.close(); app = undefined;
	const db = new DatabaseSync(join(data, "picareer.sqlite"), { readOnly: true });
	const saved = db.prepare("SELECT value FROM records WHERE kind='secrets' AND id='openai-codex'").get();
	assert.ok(saved && !saved.value.includes("fixture-refresh") && !saved.value.includes("fixture-account"));
	db.close();
	const fixtureDb = new DatabaseSync(join(data, "picareer.sqlite"));
	fixtureDb.prepare("UPDATE records SET value=? WHERE kind='secrets' AND id='openai-codex'").run(JSON.stringify(expiredCipher));
	fixtureDb.close();
	await launch();
	assert.equal((await page.evaluate(() => window.picareer.call("models", null))).providers.find(p => p.id === "openai-codex").credentialType, "oauth");
	assert.match(await page.evaluate(() => window.picareer.call("testModel", null)), /代理与令牌测试通过/);
	assert.ok(fixture.calls.some(c => c.grant === "refresh_token"));
	assert.deepEqual(errors, []);
	const evidence = { passed: true, version, scale, stages, actualElectron: true, contextFromSDK: chat.turns[0].context, windowsEncryptedLongCredential: true, restartRestoresCredential: true, proxyTokenExchange: true, proxyRefreshToken: true, proxySSE: true, cancellationRetry: true, httpAndTokenAndStorageFailures: true, refreshOnlyAction: true, realAccountLogin: "not_verified", productionCertificateValidation: "enabled; test CA trusted only in isolated test process", errors };
	writeFileSync(join(out, "result.json"), JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify(evidence));
} catch (e) { if (page && !page.isClosed()) await page.screenshot({ path: join(out, "failure.png") }); throw e; }
finally { await app?.close(); await fixture.close(); }

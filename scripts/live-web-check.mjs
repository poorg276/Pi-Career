// Opt-in: uses the existing local account. Only creates a named acceptance chat.
import { _electron as electron } from "playwright";
import { join, resolve } from "node:path";
import { mkdirSync, copyFileSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
if (!process.argv.includes("--real-account")) throw new Error("Requires --real-account");
const root = resolve(import.meta.dirname, ".."), version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const data = join(process.env.APPDATA, "PiCareer"), database = join(data, "picareer.sqlite"), backup = join(data, "backups");
assert.ok(existsSync(database)); mkdirSync(backup, { recursive: true });
copyFileSync(database, join(backup, `pre-${version}-web-${Date.now()}.sqlite`));
const protectedRows = () => {
	const db = new DatabaseSync(database, { readOnly: true });
	try { return db.prepare("SELECT kind,id,value FROM records WHERE kind IN ('plan','interview','favorite','draft','result','config') ORDER BY kind,id").all(); }
	finally { db.close(); }
};
const before = protectedRows();
const app = await electron.launch({ executablePath: process.env.PICAREER_EXE ?? join(root, "node_modules/electron/dist/electron.exe"), args: process.env.PICAREER_EXE ? [] : [root], env: { ...process.env, PICAREER_TEST_DATA: data }, timeout: 60000 });
const evidence = { version, at: new Date().toISOString(), realAccount: true, realNetwork: true, packaged: !!process.env.PICAREER_EXE, cases: [] };
let page, chat;
try {
	page = await app.firstWindow(); await page.getByRole("heading", { name: "PiCareer工作台" }).waitFor({ timeout: 60000 });
	const call = (method, input = null) => page.evaluate(({ method, input }) => window.picareer.call(method, input), { method, input });
	const { settings } = await call("state"); assert.ok(settings.model); assert.equal(!!settings.hasSearchKey, false, "Acceptance requires NO Tavily key");
	evidence.provider = settings.provider; evidence.model = settings.model;
	const previousFile = join(root, `docs/evidence/live-web-${version}.json`);
	if (existsSync(previousFile)) {
		try { const previous = JSON.parse(readFileSync(previousFile, "utf8")); const candidate = await call("chatSnapshot", { id: previous.chatId }); if (candidate.title === `${version} 验收：免密钥联网搜索`) chat = candidate; } catch { /* User may have deleted the previous acceptance chat. */ }
	}
	chat ??= await call("createChat", {}); await call("renameChat", { id: chat.id, title: `${version} 验收：免密钥联网搜索` }); evidence.chatId = chat.id;
	page.on("console", (message) => { if (message.type() === "log" && message.text().startsWith("WEB_CHECK ")) console.log(message.text()); });
	await page.evaluate(() => { const seen = new Set(); window.picareer.onEvent((e) => { if (e.type === "chatUpdate") for (const entry of e.chat.entries ?? []) if (entry.role === "tool") { const key = entry.id + entry.status; if (!seen.has(key)) { seen.add(key); console.log("WEB_CHECK " + entry.name + " " + entry.status); } } }); });
	const cases = process.argv.includes("--quick") ? [
		["packaged_search_read", "请用 web_search 搜索 Electron net.fetch official documentation，再用 web_fetch 读取 https://www.electronjs.org/docs/latest/api/net 。据实际正文用中文概括它对系统代理的支持，附来源链接，100字以内。"],
	] : [
		["chinese_current_edg", "请联网查询 EDG 无畏契约现在的成员名单及公开资料中的家乡/籍贯。先用 web_search 查找最近资料，再用 web_fetch 读取至少一条原文。注意资料日期，不能把2024年的阵容当作当前阵容；没有可靠来源的籍贯标为未核实。若当前阵容无法确定，说明实际查到了什么及来源日期。附原文链接，回答不超过350字。"],
		["english_search_read", "请用英文关键词 Electron net.fetch official documentation 进行 web_search，并用 web_fetch 读取 https://www.electronjs.org/docs/latest/api/net 。据实际正文用中文说明 Electron 是否支持系统代理配置，附来源链接，100字以内。"],
	];
	for (const [name, text] of cases) {
		console.log(`WEB_CHECK starting ${name}`);
		const timer = setTimeout(() => { void call("stopChat", { id: chat.id }).catch(() => {}); }, 240000);
		let result; try { result = await call("chat", { id: chat.id, text }); } finally { clearTimeout(timer); }
		const tools = result.entries.filter((entry) => entry.role === "tool" && entry.turnId === result.run.turnId);
		const current = { name, status: result.run.status, search: tools.some((e) => e.name === "web_search" && e.status === "complete" && /"searchEngine": "(Bing|DuckDuckGo)"/.test(e.text)),
			read: tools.some((e) => e.name === "web_fetch" && e.status === "complete" && e.text.includes('"fullText": true')),
			tools: tools.map((e) => ({ name: e.name, status: e.status,
				request: e.text.split("\n\n结果：\n")[0], resultCharacters: e.text.length,
				resultSha256: createHash("sha256").update(e.text).digest("hex"),
				sourceUrls: [...new Set([...e.text.matchAll(/"url": "([^"\n]+)"/g)].map((m) => m[1]))],
				engines: [...new Set([...e.text.matchAll(/"searchEngine": "([^"\n]+)"/g)].map((m) => m[1]))],
				...(e.status === "error" ? { error: e.text.split("\n\n结果：\n").at(-1) } : {}) })), response: result.messages.at(-1).text, turn: result.turns.at(-1) };
		evidence.cases.push(current); console.log(JSON.stringify({ name, status: current.status, search: current.search, read: current.read, context: current.turn.context }));
		assert.equal(current.status, "complete"); assert.ok(current.search, "Actual keyless search required"); assert.ok(current.read, "Actual full-text read required");
		assert.ok(current.turn.context?.tokens > 0, "SDK context usage required");
	}
	await page.getByRole("button", { name: /通用 Agent/ }).first().click(); await page.locator(".chat-history-row").filter({ hasText: `${version} 验收：免密钥联网搜索` }).first().click();
	assert.equal(await page.locator(".topbar").count(), 0); assert.ok(await page.locator(".chat-turn-end.complete").count() >= cases.length);
	await page.screenshot({ path: join(root, `docs/screenshots/web-live-${version}${evidence.packaged ? "-packaged" : ""}.png`) });
	assert.deepEqual(protectedRows(), before); evidence.learningAndSettingsPreserved = true; evidence.passed = true;
} finally {
	writeFileSync(join(root, `docs/evidence/live-web-${version}${evidence.packaged ? "-packaged" : ""}.json`), JSON.stringify(evidence, null, 2));
	await app.close();
}

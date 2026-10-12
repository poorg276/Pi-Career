// Explicit opt-in: use the existing local account to run one read-only date/weather conversation.
import { _electron as electron } from "playwright";
import { join, resolve } from "node:path";
import { mkdirSync, copyFileSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
if (!process.argv.includes("--real-account")) throw new Error("Requires --real-account; this check uses the configured real model.");
const root = resolve(import.meta.dirname, ".."), data = join(process.env.APPDATA, "PiCareer");
assert.ok(existsSync(join(data, "picareer.sqlite")), "Existing user data required");
const backup = join(data, "backups"); mkdirSync(backup, { recursive: true });
copyFileSync(join(data, "picareer.sqlite"), join(backup, `pre-0.1.4-${Date.now()}.sqlite`));
const app = await electron.launch({ executablePath: process.env.PICAREER_EXE ?? join(root, "node_modules/electron/dist/electron.exe"), args: process.env.PICAREER_EXE ? [] : [root], env: { ...process.env, PICAREER_TEST_DATA: data }, timeout: 60000 });
let page;
try {
	page = await app.firstWindow();
	await page.getByRole("heading", { name: "PiCareer工作台" }).waitFor({ timeout: 60000 });
	const call = (method, input = null) => page.evaluate(({ method, input }) => window.picareer.call(method, input), { method, input });
	const { settings } = await call("state"); assert.ok(settings.model);
	const evidencePath = join(root, "docs/evidence/live-chat-0.1.4.json");
	let c;
	if (existsSync(evidencePath)) { const previous = JSON.parse(readFileSync(evidencePath, "utf8")); try { const candidate = await call("chatSnapshot", { id: previous.chatId }); if (candidate.title === "0.1.4 验收：日期与长沙天气") c = candidate; } catch {} }
	c ??= await call("createChat", {}); await call("renameChat", { id: c.id, title: "0.1.4 验收：日期与长沙天气" });
	const result = await call("chat", { id: c.id, text: "今天是几月几号、星期几？长沙现在的天气怎么样？请使用系统时间与天气工具查询，注明当地数据时间与来源；如果查不到就如实说明。简短回答，不超过200字。" });
	const tools = result.entries.filter((e) => e.role === "tool" && e.turnId === result.run.turnId);
	const time = tools.find((e) => e.name === "get_current_time" && e.status === "complete");
	const weather = tools.find((e) => e.name === "get_weather" && e.status === "complete" && e.text.includes('"current"'));
	const evidence = { version: "0.1.4", at: new Date().toISOString(), provider: settings.provider, model: settings.model, chatId: c.id, status: result.run.status,
		timeTool: !!time, weatherTool: !!weather, tools: tools.map((e) => ({ name: e.name, status: e.status, result: e.text.slice(0, 6000) })),
		response: result.messages.at(-1).text, realAccount: true, hasSearchKey: !!settings.hasSearchKey, localFileAndCommandAccess: false };
	evidence.passed = evidence.status === "complete" && evidence.timeTool && evidence.weatherTool;
	writeFileSync(join(root, "docs/evidence/live-chat-0.1.4.json"), JSON.stringify(evidence, null, 2));
	await page.getByRole("button", { name: /通用 Agent/ }).first().click(); await page.locator(".chat-history-row").filter({ hasText: "0.1.4 验收：日期与长沙天气" }).click();
	await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 850); w.showInactive(); });
	await page.locator(".chat-workspace").screenshot({ path: join(root, "docs/screenshots/chat-live-0.1.4.png") });
	console.log(JSON.stringify({ passed: evidence.passed, provider: evidence.provider, model: evidence.model, timeTool: !!time, weatherTool: !!weather, run: result.run, tools: evidence.tools, response: evidence.response }));
} finally { await app.close(); }

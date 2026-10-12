import { _electron as electron } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(
	readFileSync(join(root, "package.json"), "utf8"),
).version;
const out = join(
	root,
	".test-data",
	`desktop-${version}-${process.env.PICAREER_EXE ? "packaged" : "dev"}`,
);
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(out, "data-"));
const errors = [];
const app = await electron.launch({
	executablePath:
		process.env.PICAREER_EXE ??
		join(root, "node_modules/electron/dist/electron.exe"),
	args: process.env.PICAREER_EXE ? [] : [root],
	env: {
		...process.env,
		PICAREER_TEST_DATA: data,
		ELECTRON_ENABLE_LOGGING: "1",
	},
	timeout: 60000,
});
app.process().stderr.on("data", (b) => {
	const s = String(b);
	if (/Error|ERR_|failed|Cannot/.test(s)) errors.push(s.slice(0, 3000));
});
try {
	const page = await app.firstWindow({ timeout: 60000 });
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (msg) => {
		if (msg.type() === "error") errors.push(msg.text());
	});
	await page
		.getByRole("heading", { name: "PiCareer工作台" })
		.waitFor({ timeout: 90000 });
	const state = await page.evaluate(() => window.picareer.call("state", null));
	assert.ok(Array.isArray(state.chats));
	await app.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].showInactive(),
	);
	await page.screenshot({ path: join(data, "home.png"), fullPage: true });
	await page.getByRole("button", { name: "Hot100 练习", exact: true }).click();
	assert.equal(await page.locator(".topbar").count(), 0);
	assert.equal(await page.locator("iframe").count(), 0);
	assert.ok(
		(await page.locator(".official-description").textContent()).includes(
			"整数数组",
		),
	);
	await page.getByRole("radio", { name: "正确", exact: true }).check();
	await page.getByRole("button", { name: "保存本次记录", exact: true }).click();
	await page.getByRole("alert").filter({ hasText: "刷题记录已保存" }).waitFor();
	await page.screenshot({ path: join(data, "coding.png"), fullPage: true });
	const updated = await page.evaluate(() =>
		window.picareer.call("state", null),
	);
	assert.ok(updated.solved.includes(1));
	await page.getByRole("button", { name: "知识背诵", exact: true }).click();
	await page
		.getByLabel("目标岗位 JD")
		.fill("Python Agent RAG LangGraph 数据库 网络 系统设计 部署 安全 评测");
	await page.getByRole("button", { name: "生成背诵计划", exact: true }).click();
	await page
		.getByRole("heading", { name: /共 .* 条知识点需要背诵/ })
		.waitFor({ timeout: 20000 });
	await page.getByRole("button", { name: /这10条背完了/ }).click();
	await page.getByText(/已完成 10 \/ /).waitFor();
	await page.screenshot({ path: join(data, "learning.png"), fullPage: true });
	const modelOptions = await page.evaluate(() =>
		window.picareer.call("models", null),
	);
	assert.ok(modelOptions.providers.length > 0);
	assert.ok(modelOptions.models.length > 0);
	console.log(
		JSON.stringify(
			{
				home: true,
				officialStatementAndManualAttempt: true,
				studyProgress: true,
				modelCount: modelOptions.models.length,
				oauthProviders: modelOptions.providers.map((p) => p.id),
				errors,
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(out, "result.json"),
		JSON.stringify(
			{
				version,
				packaged: !!process.env.PICAREER_EXE,
				home: true,
				officialStatementAndManualAttempt: true,
				studyProgress: true,
				modelCatalog: true,
				data,
				passed: errors.length === 0,
				errors,
				at: new Date().toISOString(),
			},
			null,
			2,
		),
	);
	if (errors.length) throw new Error(errors.join("\n"));
} catch (error) {
	console.error("Runtime errors:", errors);
	const page = await app.firstWindow();
	console.error((await page.locator("body").innerText()).slice(0, 7000));
	await page.screenshot({ path: join(data, "failure.png"), fullPage: true });
	throw error;
} finally {
	await app.close();
}

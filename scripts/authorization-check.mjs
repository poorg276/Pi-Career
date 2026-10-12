import { _electron as electron } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."),
	scale = process.env.PICAREER_SCALE ?? "1.25";
const out = join(
	root,
	".test-data",
	`authorization-${process.env.PICAREER_EXE ? "packaged" : "dev"}-${scale}`,
);
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(out, "data-")),
	errors = [];
const app = await electron.launch({
	executablePath:
		process.env.PICAREER_EXE ??
		join(root, "node_modules/electron/dist/electron.exe"),
	args: [
		...(process.env.PICAREER_EXE ? [] : [root]),
		`--force-device-scale-factor=${scale}`,
	],
	env: { ...process.env, PICAREER_TEST_DATA: data },
	timeout: 60000,
});
let occupied;
async function portFree() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(1455, "127.0.0.1", () => server.close(resolve));
	});
}
try {
	const page = await app.firstWindow();
	page.on("pageerror", (e) => errors.push(e.message));
	await page
		.getByRole("heading", { name: "PiCareer工作台" })
		.waitFor({ timeout: 60000 });
	await app.evaluate(({ BrowserWindow, shell, clipboard }) => {
		globalThis.__authOpened = [];
		globalThis.__authCopied = [];
		globalThis.__authOpenFail = false;
		shell.openExternal = async (url) => {
			globalThis.__authOpened.push(url);
			if (globalThis.__authOpenFail)
				throw new Error("test browser unavailable");
		};
		clipboard.writeText = (text) => globalThis.__authCopied.push(text);
		const win = BrowserWindow.getAllWindows()[0];
		win.showInactive();
		win.setSize(1024, 700);
	});
	await page.getByRole("button", { name: "模型与设置", exact: true }).click();
	await page.evaluate(() => {
		window.__authStates = [];
		window.picareer.onEvent((e) => {
			if (e.type === "authorization") window.__authStates.push(e.state);
		});
	});
	const row = page.locator(".oauth-row").filter({ hasText: "OpenAI Codex" }),
		connect = row.getByRole("button", { name: "连接", exact: true }),
		dialog = page.getByRole("dialog");
	await connect.scrollIntoViewIfNeeded();
	await page.locator(".main").evaluate((el) => {
		el.scrollTop = 300;
	});
	await connect.click();
	await dialog.waitFor();
	await page.waitForFunction(
		() => window.__authStates.at(-1)?.browser === "opened",
	);
	const initial = await page.evaluate(() => {
		const s = window.__authStates.at(-1);
		return { attemptId: s.attemptId, promptId: s.prompt?.id, status: s.status };
	});
	assert.equal(initial.status, "waiting");
	assert.equal(await app.evaluate(() => globalThis.__authOpened.length), 1);
	assert.equal(
		await dialog
			.getByRole("button", { name: "取消授权", exact: true })
			.isVisible(),
		true,
	);
	assert.equal(
		await page.locator(".main .alert").count(),
		0,
		"OAuth must not appear as an off-screen global alert",
	);
	const geometry = await dialog.evaluate((el) => {
		const r = el.getBoundingClientRect();
		return {
			top: r.top,
			bottom: r.bottom,
			viewport: innerHeight,
			width: r.width,
		};
	});
	assert.ok(geometry.top >= 36 && geometry.bottom <= geometry.viewport);
	await page.screenshot({ path: join(out, "waiting.png") });
	await dialog.getByRole("button", { name: "复制链接", exact: true }).click();
	assert.equal(await app.evaluate(() => globalThis.__authCopied.length), 1);
	await dialog
		.getByRole("button", { name: "重新打开授权页面 ↗", exact: true })
		.click();
	assert.equal(await app.evaluate(() => globalThis.__authOpened.length), 2);
	await dialog
		.getByText("浏览器回调失败？手动粘贴授权结果", { exact: true })
		.click();
	assert.equal(
		await dialog
			.getByRole("button", { name: "提交授权结果", exact: true })
			.isDisabled(),
		true,
	);
	await dialog
		.getByLabel("粘贴浏览器地址栏中的完整回调地址")
		.fill("http://localhost:1455/auth/callback?code=fixture&state=wrong");
	await dialog
		.getByRole("button", { name: "提交授权结果", exact: true })
		.click();
	await dialog.getByText(/这不是本次授权的有效回调地址/).waitFor();
	await page.waitForFunction(() => {
		const error = document
			.querySelector('.auth-body [role="alert"]')
			?.getBoundingClientRect();
		const body = document.querySelector(".auth-body")?.getBoundingClientRect();
		return (
			error &&
			body &&
			error.top >= body.top - 1 &&
			error.bottom <= body.bottom + 1
		);
	});
	assert.equal(
		await dialog
			.getByRole("button", { name: "重新打开授权页面 ↗", exact: true })
			.isVisible(),
		true,
	);
	await page.screenshot({ path: join(out, "manual-validation.png") });
	await dialog.getByRole("button", { name: "取消授权", exact: true }).click();
	await dialog
		.getByText("已取消授权。重新连接会生成新的授权链接。", { exact: true })
		.waitFor();
	assert.equal(
		await dialog.getByRole("button", { name: "重新打开授权页面 ↗" }).count(),
		0,
	);
	assert.equal(
		(await dialog.innerText()).includes("Missing authorization code"),
		false,
	);
	await assert.rejects(
		page.evaluate(
			(id) =>
				window.picareer.call("authLink", { attemptId: id, action: "open" }),
			initial.attemptId,
		),
		/失效/,
	);
	await portFree();
	await dialog.getByRole("button", { name: "关闭", exact: true }).click();
	// Actual main-process browser failure, followed by a user retry.
	await app.evaluate(() => {
		globalThis.__authOpenFail = true;
	});
	await connect.click();
	await dialog.getByText(/未能自动打开浏览器/).waitFor();
	await page.screenshot({ path: join(out, "browser-unavailable.png") });
	await app.evaluate(() => {
		globalThis.__authOpenFail = false;
	});
	await dialog
		.getByRole("button", { name: "重新打开授权页面 ↗", exact: true })
		.click();
	await page.waitForFunction(
		() => window.__authStates.at(-1)?.browser === "opened",
	);
	await dialog.getByRole("button", { name: "取消授权", exact: true }).click();
	await dialog.getByRole("button", { name: "关闭", exact: true }).click();
	await portFree();
	occupied = createServer();
	await new Promise((resolve, reject) => {
		occupied.once("error", reject);
		occupied.listen(1455, "127.0.0.1", resolve);
	});
	const before = await app.evaluate(() => globalThis.__authOpened.length);
	await connect.click();
	await dialog.getByText(/本地授权端口 1455 无法使用/).waitFor();
	assert.equal(
		await app.evaluate(() => globalThis.__authOpened.length),
		before,
	);
	assert.equal(
		await dialog
			.getByRole("button", { name: "改用设备码登录", exact: true })
			.isEnabled(),
		true,
	);
	await page.screenshot({ path: join(out, "port-occupied.png") });
	await new Promise((resolve) => occupied.close(resolve));
	occupied = undefined;
	await dialog.getByRole("button", { name: "重新连接", exact: true }).click();
	await page.waitForFunction(
		() => window.__authStates.at(-1)?.browser === "opened",
	);
	await app.evaluate(({ app }) => {
		const worker = app.getAppMetrics().find((m) => m.name === "PiCareer Agent");
		if (!worker) throw new Error("Worker missing");
		process.kill(worker.pid);
	});
	await dialog.getByText(/后台.*退出|无法启动授权/).waitFor();
	assert.equal(
		await dialog.getByRole("button", { name: "重新打开授权页面 ↗" }).count(),
		0,
	);
	await portFree();
	assert.deepEqual(errors, []);
	writeFileSync(
		join(out, "result.json"),
		JSON.stringify(
			{
				passed: true,
				scale,
				geometry,
				immediateDialog: true,
				autoBrowser: true,
				clipboard: true,
				manualValidation: true,
				cancelAndPortRelease: true,
				staleLinkRejected: true,
				retry: true,
				occupiedPort: true,
				browserFailureRecovery: true,
				workerExit: true,
				errors,
				realAccount: "not_verified",
				at: new Date().toISOString(),
			},
			null,
			2,
		),
	);
	console.log(
		`PASS authorization desktop checks at ${scale}; evidence: ${out}`,
	);
} catch (e) {
	const page = await app.firstWindow();
	await page.screenshot({ path: join(out, "failure.png") });
	throw e;
} finally {
	if (occupied) await new Promise((resolve) => occupied.close(resolve));
	await app.close();
}

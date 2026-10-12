import { _electron as electron } from "playwright";
import { join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { toolsServer } from "../tests/fixtures/tools-server.mjs";
const root = resolve(import.meta.dirname, ".."),
	version = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	).version,
	scale = process.env.PICAREER_SCALE ?? "1.25";
const out = join(
	root,
	`.test-data/jobs-${version}-${process.env.PICAREER_EXE ? "packaged" : "dev"}-${scale}`,
);
mkdirSync(out, { recursive: true });
const fixture = await toolsServer();
fixture.mode = "jobs";
const app = await electron.launch({
	executablePath:
		process.env.PICAREER_EXE ??
		join(root, "node_modules/electron/dist/electron.exe"),
	args: [
		...(process.env.PICAREER_EXE ? [] : [root]),
		`--force-device-scale-factor=${scale}`,
	],
	env: {
		...process.env,
		PICAREER_TEST_DATA: mkdtempSync(join(out, "data-")),
		NODE_EXTRA_CA_CERTS: join(root, "tests/fixtures/tools-test-cert.pem"),
	},
	timeout: 60000,
});
const errors = [],
	evidence = { version, scale, passed: false };
let page;
try {
	page = await app.firstWindow();
	page.on("pageerror", (e) => errors.push(e.message));
	await page
		.getByRole("heading", { name: "PiCareer工作台" })
		.waitFor({ timeout: 60000 });
	await app.evaluate(
		({ session }, certificate) => {
			const original = session.fromPartition.bind(session);
			session.fromPartition = (...args) => {
				const isolated = original(...args);
				if (String(args[0]).startsWith("picareer-web-"))
					isolated.setCertificateVerifyProc((request, callback) => {
						const fixtureHost = [
							"www.bing.com",
							"html.duckduckgo.com",
							"example.com",
						].includes(request.hostname);
						callback(
							fixtureHost &&
								request.certificate.data.trim() === certificate.trim()
								? 0
								: -3,
						);
					});
				return isolated;
			};
		},
		readFileSync(join(root, "tests/fixtures/tools-test-cert.pem"), "utf8"),
	);
	await app.evaluate(async ({ session, BrowserWindow }, proxy) => {
		await session.defaultSession.setProxy({ proxyRules: proxy });
		const w = BrowserWindow.getAllWindows()[0];
		w.setSize(1060, 760);
		w.showInactive();
	}, fixture.proxy);
	const call = (method, input = null) =>
		page.evaluate(({ method, input }) => window.picareer.call(method, input), {
			method,
			input,
		});
	await call("settings", {
		provider: "custom",
		model: "fixture-long-model-name-".repeat(4),
		baseUrl: "http://127.0.0.1:9/v1",
		api: "openai-completions",
	});
	await page.reload();
	await page.getByRole("button", { name: "企业岗位", exact: true }).click();
	assert.equal(await page.locator(".topbar").count(), 0);
	await page.getByLabel("目标城市", { exact: true }).fill("长沙");
	await page.getByLabel("目标企业", { exact: true }).fill("华为");
	await page.getByLabel("目标岗位", { exact: true }).fill("Agent 开发工程师");
	await page.getByRole("button", { name: "搜索岗位", exact: true }).click();
	await page
		.getByRole("heading", { name: "严格匹配 · 1", exact: true })
		.waitFor({ timeout: 60000 });
	assert.equal(await page.locator(".job").count(), 2);
	assert.ok(await page.locator(".jobs-related").evaluate((e) => !e.open));
	assert.equal(
		await page
			.locator(".job")
			.first()
			.getByText("华为技术有限公司 · 长沙 · 未提供", { exact: true })
			.count(),
		1,
	);
	await page.locator(".jobs-related>summary").click();
	await page.getByText("城市：不一致（深圳）", { exact: true }).waitFor();
	assert.ok(fixture.calls.some((c) => c.host === "html.duckduckgo.com"));
	evidence.strictRelatedFallback = true;
	const sizes = await page
		.locator(".jobs-page")
		.evaluate((root) =>
			[...root.querySelectorAll("*")]
				.filter(
					(e) =>
						e.getClientRects().length &&
						[...e.childNodes].some(
							(n) => n.nodeType === 3 && n.textContent.trim(),
						),
				)
				.map((e) => parseFloat(getComputedStyle(e).fontSize)),
		);
	assert.ok(Math.min(...sizes) >= 13, JSON.stringify(sizes));
	evidence.minimumFont = Math.min(...sizes);
	assert.ok(
		await page
			.locator(".jobs-model span")
			.evaluate((e) => e.scrollWidth > e.clientWidth),
	);
	await page.screenshot({ path: join(out, "results.png") });
	await page.locator(".main").evaluate((e) => e.scrollTo(0, 0));
	await page.screenshot({ path: join(out, "header.png") });
	for (const [button, heading] of [
		["匹配知识点", "八股知识背诵"],
		["准备面试", "模拟面试"],
	]) {
		await page
			.locator(".job")
			.first()
			.getByRole("button", { name: button, exact: true })
			.scrollIntoViewIfNeeded();
		const scroll = await page.locator(".main").evaluate((e) => e.scrollTop),
			calls = fixture.calls.length;
		await page
			.locator(".job")
			.first()
			.getByRole("button", { name: button, exact: true })
			.click();
		await page
			.getByRole("heading", { name: heading, exact: true })
			.waitFor({ timeout: 30000 });
		assert.match(
			await page.getByLabel(/目标岗位 JD|岗位 JD/).inputValue(),
			/任务规划/,
		);
		await page
			.getByRole("button", { name: "← 返回岗位检索", exact: true })
			.click();
		await page
			.getByRole("heading", { name: "严格匹配 · 1", exact: true })
			.waitFor();
		assert.equal(
			await page.getByLabel("目标城市", { exact: true }).inputValue(),
			"长沙",
		);
		assert.ok(await page.locator(".jobs-related").evaluate((e) => e.open));
		assert.ok(
			Math.abs(
				(await page.locator(".main").evaluate((e) => e.scrollTop)) - scroll,
			) < 3,
		);
		assert.equal(
			fixture.calls.length,
			calls + 1,
			"Return must not issue another search",
		);
	}
	evidence.returnJDAndScroll = true;
	await page
		.locator(".job")
		.first()
		.getByRole("button", { name: "收藏", exact: true })
		.click();
	await page.getByRole("button", { name: "我的收藏 (1)", exact: true }).click();
	await page
		.getByRole("heading", { name: "我的收藏 · 1", exact: true })
		.waitFor();
	await page.locator(".jobs-model").click();
	await page
		.getByRole("button", { name: "← 返回岗位检索", exact: true })
		.click();
	await page
		.getByRole("heading", { name: "我的收藏 · 1", exact: true })
		.waitFor();
	evidence.favoritesAndSettingsReturn = true;
	await page.getByRole("button", { name: "返回搜索", exact: true }).click();
	fixture.mode = "wait";
	await page.getByRole("button", { name: "搜索岗位", exact: true }).click();
	await page.getByRole("button", { name: "停止检索", exact: true }).click();
	await page
		.getByRole("button", { name: "搜索岗位", exact: true })
		.waitFor({ timeout: 10000 });
	fixture.mode = "jobs";
	await page.getByRole("button", { name: "搜索岗位", exact: true }).click();
	await page
		.getByRole("heading", { name: "严格匹配 · 1", exact: true })
		.waitFor({ timeout: 20000 });
	evidence.cancelRetry = true;
	fixture.mode = "wait";
	await page.getByRole("button", { name: "搜索岗位", exact: true }).click();
	await page.getByRole("button", { name: "工作台", exact: true }).click();
	await page.getByRole("button", { name: "企业岗位", exact: true }).click();
	await page.getByRole("button", { name: "停止检索", exact: true }).waitFor();
	await page.getByLabel("目标城市", { exact: true }).fill("深圳");
	fixture.mode = "jobs";
	await page.getByRole("button", { name: "重新检索", exact: true }).click();
	await page
		.getByRole("heading", { name: "严格匹配 · 1", exact: true })
		.waitFor({ timeout: 20000 });
	assert.match(await page.locator(".jobs-query").textContent(), /深圳/);
	assert.match(
		await page.locator(".job").first().textContent(),
		/华为技术有限公司 · 深圳/,
	);
	evidence.runningNavigationAndNewRequestIsolation = true;
	const old = await call("favorite", {
		id: "legacy",
		title: "长沙市 百度百科",
		role: "长沙市 百度百科",
		url: "https://example.com/tour",
		company: "未提供",
		city: "未提供",
		experience: "未提供",
		content: "旧版无关页面",
		kind: "web",
		score: 0,
		retrievedAt: new Date().toISOString(),
	});
	assert.ok(old.length === 2);
	await page.getByRole("button", { name: "工作台", exact: true }).click();
	await page.reload();
	await page.getByRole("button", { name: "企业岗位", exact: true }).click();
	await page.getByRole("button", { name: "我的收藏 (2)", exact: true }).click();
	await page
		.locator(".job")
		.filter({ hasText: "长沙市 百度百科" })
		.getByRole("button", { name: "匹配知识点", exact: true })
		.click();
	await page.getByRole("dialog", { name: "确认岗位 JD" }).waitFor();
	assert.equal(
		await page.getByLabel("岗位职责与任职要求", { exact: true }).inputValue(),
		"",
	);
	await page.getByRole("button", { name: "取消", exact: true }).click();
	evidence.legacyJDGuard = true;
	assert.deepEqual(errors, []);
	evidence.passed = true;
	evidence.errors = errors;
	console.log(JSON.stringify(evidence));
} catch (e) {
	if (page)
		console.log(
			(await page.locator("body").textContent()).slice(-6000),
			JSON.stringify(fixture.calls.slice(-8)),
		);
	await page?.screenshot({ path: join(out, "failure.png") }).catch(() => {});
	throw e;
} finally {
	writeFileSync(join(out, "result.json"), JSON.stringify(evidence, null, 2));
	await app.close();
	await fixture.close();
}

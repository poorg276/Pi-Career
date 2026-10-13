import { _electron as electron } from "playwright";
import { join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
const root = resolve(import.meta.dirname, ".."),
	version = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	).version,
	scale = process.env.PICAREER_SCALE ?? "1.25";
const out = join(
	root,
	`.test-data/manual-jobs-${version}-${process.env.PICAREER_EXE ? "packaged" : "dev"}-${scale}`,
);
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(out, "data-")),
	evidence = { version, scale, passed: false },
	errors = [];
let app, page;
const launch = async () => {
	app = await electron.launch({
		executablePath:
			process.env.PICAREER_EXE ??
			join(root, "node_modules/electron/dist/electron.exe"),
		args: [
			...(process.env.PICAREER_EXE ? [] : [root]),
			`--force-device-scale-factor=${scale}`,
		],
		env: { ...process.env, PICAREER_TEST_DATA: data, PICAREER_DASHBOARD_AUTOSTART: "0" },
		timeout: 60000,
	});
	page = await app.firstWindow();
	page.on("pageerror", (e) => errors.push(e.message));
	await page
		.getByRole("heading", { name: "PiCareer工作台" })
		.waitFor({ timeout: 60000 });
	await app.evaluate(async ({ session, BrowserWindow }) => {
		globalThis.manualNetworkRequests = [];
		const original = session.fromPartition.bind(session);
		session.fromPartition = (...args) => {
			const s = original(...args);
			if (String(args[0]).startsWith("picareer-web-"))
				s.webRequest.onBeforeRequest(
					{ urls: ["https://*/*", "http://*/*"] },
					(request, callback) => {
						globalThis.manualNetworkRequests.push(request.url);
						callback({ cancel: true });
					},
				);
			return s;
		};
		await session.defaultSession.setProxy({ proxyRules: "127.0.0.1:9" });
		const win = BrowserWindow.getAllWindows()[0];
		win.setSize(1060, 760);
		win.showInactive();
	});
};
const call = (method, input = null) =>
	page.evaluate(({ method, input }) => window.picareer.call(method, input), {
		method,
		input,
	});
const button = (name) => page.getByRole("button", { name, exact: true });
const field = (name) => page.getByLabel(new RegExp(`^${name}`));
const open = () => button("＋ 手动录入目标岗位").first().click();
try {
	await launch();
	assert.equal((await call("state")).settings.model, "");
	await button("企业岗位").click();
	await open();
	await button("保存到我的收藏").click();
	await page.getByRole("alert").filter({ hasText: "请填写企业名" }).waitFor();
	await field("企业名").fill("星河科技");
	await page.keyboard.press("Escape");
	await open();
	assert.equal(await field("企业名").inputValue(), "星河科技");
	await field("工作地点").fill("长沙 · 岳麓区");
	await field("岗位名称").fill("Agent 研发实习生");
	await field("岗位类型").selectOption("实习");
	const responsibilities = "1. 研发 Agent 应用\n2. 建设工具调用与 RAG 系统";
	const requirements =
		"Python、算法与工程能力\n了解多步 Agent 工作流 <script>window.manualExecuted=true</script>";
	await field("岗位职责").fill(responsibilities);
	await field("岗位要求").fill(requirements);
	for (const [name, value] of [
		["学历要求", "本科及以上"],
		["经验要求", "项目经验"],
		["面向毕业年份", "2027届"],
		["薪资待遇", "200–300 元/天"],
		["备注", "来自线下宣讲，面试时间待确认"],
	])
		await field(name).fill(value);
	await field("招聘来源链接").fill("javascript:alert(1)");
	await button("保存到我的收藏").click();
	await page.getByRole("alert").filter({ hasText: "HTTP／HTTPS" }).waitFor();
	assert.equal(await field("岗位职责").inputValue(), responsibilities);
	await field("招聘来源链接").fill("");
	const geometry = await page.locator(".manual-dialog").evaluate((e) => {
		const r = e.getBoundingClientRect(),
			body = e.querySelector(".manual-body"),
			footer = e.querySelector(".manual-footer").getBoundingClientRect();
		return {
			top: r.top,
			bottom: r.bottom,
			viewport: innerHeight,
			footerBottom: footer.bottom,
			scrollable: body.scrollHeight > body.clientHeight,
			horizontalOverflow: e.scrollWidth > e.clientWidth,
		};
	});
	assert.ok(
		geometry.top >= 0 &&
			geometry.bottom <= geometry.viewport + 1 &&
			geometry.footerBottom <= geometry.viewport + 1 &&
			geometry.scrollable &&
			!geometry.horizontalOverflow,
	);
	evidence.dialogGeometry = geometry;
	await page.screenshot({ path: join(out, "form.png") });
	await page.locator(".manual-body").evaluate((e) => e.scrollTo(0, 0));
	await page.screenshot({ path: join(out, "form-top.png") });
	const lock = new DatabaseSync(join(data, "picareer.sqlite"));
	try {
		lock.exec("BEGIN IMMEDIATE");
		await button("保存到我的收藏").click();
		await page
			.getByRole("alert")
			.filter({ hasText: /locked/ })
			.waitFor();
		assert.equal(await field("岗位职责").inputValue(), responsibilities);
	} finally {
		lock.exec("ROLLBACK");
		lock.close();
	}
	evidence.failedSaveRetainsDraft = true;
	await page.locator(".manual-dialog form").evaluate((form) => {
		form.requestSubmit();
		form.requestSubmit();
	});
	await page
		.getByRole("heading", { name: "我的收藏 · 1", exact: true })
		.waitFor();
	let job = (await call("state")).favorites[0];
	assert.equal(job.manual.requirements, requirements);
	assert.equal(job.url, "");
	assert.equal(job.origin, "manual");
	assert.equal(await button("原文 ↗").count(), 0);
	assert.equal(await page.getByText("正文已核验", { exact: true }).count(), 0);
	assert.equal(await page.evaluate(() => window.manualExecuted), undefined);
	const repeated = await Promise.all([
		call("saveManualJob", { ...job.manual, id: job.id, mode: "create" }),
		call("saveManualJob", { ...job.manual, id: job.id, mode: "create" }),
	]);
	assert.equal(repeated[1].length, 1);
	await button("查看详情").click();
	await page.getByRole("dialog", { name: "目标岗位详情" }).waitFor();
	assert.match(
		await page.locator(".manual-details").textContent(),
		/本科及以上/,
	);
	assert.match(await page.locator(".manual-details").textContent(), /RAG/);
	await button("关闭").click();
	await button("编辑").click();
	assert.equal(await field("岗位要求").inputValue(), requirements);
	await field("企业名").fill("取消修改");
	await button("取消").click();
	assert.equal((await call("state")).favorites[0].company, "星河科技");
	await button("编辑").click();
	await field("岗位名称").fill("Agent 校招研发工程师");
	await field("岗位类型").selectOption("校招");
	await button("保存修改").click();
	await page
		.getByRole("heading", { name: "Agent 校招研发工程师", exact: true })
		.waitFor();
	assert.equal((await call("state")).favorites[0].id, job.id);
	for (const [name, heading] of [
		["匹配知识点", "八股知识背诵"],
		["准备面试", "模拟面试"],
	]) {
		await button(name).scrollIntoViewIfNeeded();
		const scroll = await page.locator(".main").evaluate((e) => e.scrollTop);
		await button(name).click();
		await page.getByRole("heading", { name: heading, exact: true }).waitFor();
		const jd = await page.getByLabel(/目标岗位 JD|岗位 JD/).inputValue();
		assert.ok(jd.includes(responsibilities) && jd.includes(requirements));
		assert.match(jd, /用户手动录入/);
		assert.match(jd, /岗位类型：校招/);
		await button("← 返回岗位检索").click();
		await page
			.getByRole("heading", { name: "我的收藏 · 1", exact: true })
			.waitFor();
		assert.ok(
			Math.abs(
				(await page.locator(".main").evaluate((e) => e.scrollTop)) - scroll,
			) < 3,
		);
	}
	const fakeJD = await call("prepareJobJD", {
		job: { ...job, manual: { ...job.manual, requirements: "forged" } },
	});
	assert.ok(fakeJD.text.includes(requirements));
	assert.ok(!fakeJD.text.includes("forged"));
	evidence.offlineCreateEditJD = true;
	assert.deepEqual(
		await app.evaluate(() => globalThis.manualNetworkRequests),
		[],
	);
	await page.screenshot({ path: join(out, "favorite.png") });
	await app.close();
	app = undefined;
	await launch();
	await button("企业岗位").click();
	await button("我的收藏 (1)").click();
	await page
		.getByRole("heading", { name: "Agent 校招研发工程师", exact: true })
		.waitFor();
	evidence.restartRestored = true;
	await button("删除").click();
	assert.match(
		await page.getByRole("dialog", { name: "删除手动岗位" }).textContent(),
		/星河科技 · Agent 校招研发工程师/,
	);
	await button("取消").click();
	assert.equal((await call("state")).favorites.length, 1);
	await button("删除").click();
	await button("删除岗位").click();
	await page
		.getByRole("heading", { name: "我的收藏 · 0", exact: true })
		.waitFor();
	assert.equal((await call("deleteManualJob", { id: job.id })).length, 0);
	const legacy = {
		id: "legacy",
		title: "旧在线收藏",
		role: "岗位",
		company: "企业",
		city: "长沙",
		experience: "未提供",
		url: "https://example.com/job",
		kind: "web",
		score: 0,
		content: "旧数据",
		retrievedAt: new Date().toISOString(),
	};
	await call("favorite", legacy);
	await page.reload();
	await button("企业岗位").click();
	await button("我的收藏 (1)").click();
	assert.equal(await button("取消收藏").count(), 1);
	assert.equal(await button("编辑").count(), 0);
	assert.equal(await button("原文 ↗").count(), 1);
	evidence.legacyPreserved = true;
	const manualId = crypto.randomUUID(),
		manual = {
			...job.manual,
			id: manualId,
			mode: "create",
			sourceUrl: "https://example.com/job",
		};
	await call("saveManualJob", manual);
	await page.reload();
	await button("企业岗位").click();
	await button("我的收藏 (2)").click();
	assert.equal(await button("原文 ↗").count(), 2);
	evidence.optionalSourceAndDeletion = true;
	assert.deepEqual(errors, []);
	evidence.errors = errors;
	evidence.passed = true;
	console.log(JSON.stringify(evidence));
} catch (error) {
	if (page) {
		console.log((await page.locator("body").textContent()).slice(-3000));
		await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
	}
	throw error;
} finally {
	writeFileSync(join(out, "result.json"), JSON.stringify(evidence, null, 2));
	if (app) await app.close();
}

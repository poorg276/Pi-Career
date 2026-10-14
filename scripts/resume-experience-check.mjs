import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
	existsSync,
} from "node:fs";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, ".."),
	version = JSON.parse(readFileSync(join(root, "package.json"))).version,
	scale = process.env.PICAREER_SCALE ?? "1.25";
const out = join(
	root,
	`.test-data/resume-experience-${version}-${process.env.PICAREER_EXE ? "packaged" : "dev"}-${scale}`,
);
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(out, "data-"));
let requests = 0,
	delay = false,
	numericFault = false;
const server = createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	requests++;
	const value = JSON.parse(body),
		last = value.messages.at(-1),
		raw =
			typeof last.content === "string"
				? last.content
				: last.content
						.filter((x) => x.type === "text")
						.map((x) => x.text)
						.join("\n"),
		input = JSON.parse(raw);
	let content;
	if (input.problems)
		content = { facts: [{ text: "实现检索函数", evidence: [{ unitId: input.units[0].id, quote: input.units[0].text.slice(0, 60) }] }] };
	else if (input.units)
		content = {
			issues: input.overview.includes("贡献不明")
				? ["请说明本人负责的检索和测试工作及对应材料"]
				: [],
			facts: input.units
				.filter((u) => u.text)
				.slice(0, 1)
				.map((u) => ({
					text: numericFault ? "实现检索函数，准确率99%" : "实现检索函数",
					evidence: [{ unitId: u.id, quote: u.text.slice(0, 60) }],
				})),
		};
	else if (input.experiences)
		content = {
			valid: !input.overview.includes("核验失败"),
			issues: input.overview.includes("核验失败")
				? ["文稿贡献超出概述，请核对"]
				: [],
		};
	else
		content = [
			{
				kind: "project",
				name: "资料检索项目",
				time: "",
				role: "开发者",
				bullets: [
					{ text: "实现检索函数与空结果处理。", factIds: ["overview"] },
					{ text: "编写单元测试验证检索结果。", factIds: ["overview"] },
				],
			},
		];
	if (delay) await new Promise((r) => setTimeout(r, 2500));
	if (res.destroyed) return;
	res.writeHead(200, { "Content-Type": "text/event-stream" });
	const event = (delta, finish_reason = null) =>
		res.write(
			"data: " +
				JSON.stringify({
					id: "resume-check",
					object: "chat.completion.chunk",
					created: 1,
					model: "mock-resume",
					choices: [{ index: 0, delta, finish_reason }],
				}) +
				"\n\n",
		);
	event({ role: "assistant" });
	event({ content: JSON.stringify(content) });
	event({}, "stop");
	res.end("data: [DONE]\n\n");
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
let app, page;
const errors = [],
	result = { version, scale, passed: false };
const launch = async () => {
	app = await electron.launch({
		executablePath:
			process.env.PICAREER_EXE ??
			join(root, "node_modules/electron/dist/electron.exe"),
		args: [
			...(process.env.PICAREER_EXE ? [] : [root]),
			"--force-device-scale-factor=" + scale,
		],
		env: {
			...process.env,
			PICAREER_TEST_DATA: data,
			PICAREER_DASHBOARD_AUTOSTART: "0",
		},
		timeout: 60000,
	});
	page = await app.firstWindow();
	page.on("pageerror", (e) => errors.push(e.message));
	await page
		.getByRole("heading", { name: "PiCareer工作台" })
		.waitFor({ timeout: 60000 });
	await app.evaluate(({ BrowserWindow }) => {
		const w = BrowserWindow.getAllWindows()[0];
		w.setSize(1024, 700);
		w.showInactive();
	});
};
const call = (method, input = null) =>
	page.evaluate(({ method, input }) => window.picareer.call(method, input), {
		method,
		input,
	});
const section = () => page.locator(".resume-page:visible");
const enter = async () => {
	await page.getByRole("button", { name: "简历优化", exact: true }).click();
	await section()
		.getByRole("heading", { name: "简历优化", exact: true })
		.waitFor();
};
const ready = async () => {
	await section()
		.getByText("已完成", { exact: true })
		.waitFor({ timeout: 30000 });
};
try {
	await launch();
	await enter();
	assert.equal(await section().locator(".resume-content").count(), 0);
	assert.equal(await section().locator("textarea").count(), 0);
	const before = (await call("resumeList")).length;
	await section()
		.getByRole("button", { name: /^完整简历/ })
		.click();
	await section()
		.getByText("该功能还在开发中......", { exact: true })
		.waitFor();
	assert.equal((await call("resumeList")).length, before);
	await section()
		.getByRole("button", { name: "← 返回简历优化", exact: true })
		.click();
	await section()
		.getByRole("button", { name: /^项目经历优化/ })
		.click();
	const overview = () => section().getByLabel("经历概述（必填）");
	const generate = () =>
		section().getByRole("button", {
			name: "依据提供的信息生成简历中的项目经历及科研经历",
			exact: true,
		});
	assert.equal(await generate().isDisabled(), true);
	await section().getByLabel("草稿名称").fill("保留草稿");
	await overview().fill(
		"本人实现检索函数与空结果处理，并编写单元测试，时间未知、性能未测量。",
	);
	await section().getByRole("button", { name: "保存", exact: true }).click();
	assert.equal(requests, 0);
	let d = (await call("resumeList"))[0];
	const id = d.id;
	assert.equal(d.title, "保留草稿");
	await section()
		.getByRole("button", { name: "配置模型", exact: true })
		.click();
	await page
		.getByRole("button", { name: "← 返回简历优化", exact: true })
		.click();
	assert.equal(await overview().inputValue(), d.overview);
	await call("settings", {
		provider: "custom",
		model: "mock-resume",
		baseUrl: "http://127.0.0.1:" + server.address().port + "/v1",
		api: "openai-completions",
		key: "fixture-only",
	});
	await app.evaluate(
		({ dialog }, path) => {
			dialog.showOpenDialog = async () => ({
				canceled: false,
				filePaths: [path],
			});
		},
		join(root, ".test-data/resume-fixtures/中文 Agent 项目"),
	);
	await section()
		.getByRole("button", { name: "导入源码目录", exact: true })
		.click();
	await section().getByText("中文 Agent 项目", { exact: true }).waitFor();
	await section()
		.getByRole("button", { name: "保存", exact: true })
		.waitFor({ state: "visible" });
	await page.waitForTimeout(300);
	const text = await section().textContent();
	for (const removed of [
		"分析材料与岗位",
		"事实确认与补充的问题",
		"模板与预览",
		"导出 PDF",
		"现有经历（可直接粘贴）",
	])
		assert.ok(!text.includes(removed), removed);
	assert.deepEqual(
		await section().getByLabel("材料用途").locator("option").allTextContents(),
		["项目", "论文／专利"],
	);
	await generate().click();
	await ready();
	await section()
		.getByRole("heading", { name: "生成结果", exact: true })
		.waitFor();
	d = (await call("resumeList")).find((d) => d.id === id);
	assert.equal(d.experiences.length, 1);
	assert.equal(requests, 3);
	await section()
		.getByRole("button", { name: "整体复制", exact: true })
		.click();
	await section().getByText("已复制全部经历文本", { exact: true }).waitFor();
	const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
	assert.match(copied, /实现检索函数/);
	assert.ok(!/证据|factIds|资料依据/.test(copied));
	await section()
		.getByLabel("条目 1", { exact: true })
		.fill("实现并测试检索函数，保留空结果处理。");
	await section()
		.getByRole("button", { name: "复制本项", exact: true })
		.click();
	await section().getByText("已复制本项经历", { exact: true }).waitFor();
	assert.match(
		await app.evaluate(({ clipboard }) => clipboard.readText()),
		/实现并测试/,
	);
	await overview().fill("贡献不明：上传的代码是团队资料。");
	await generate().click();
	await section().getByText("请补充概述后重新生成", { exact: true }).waitFor();
	assert.match(await section().textContent(), /请说明本人负责/);
	assert.equal(
		(await call("resumeList")).find((d) => d.id === id).experiences.length,
		1,
	);
	await overview().fill(
		"本人实现检索函数、处理空结果并编写测试。时间未知、指标未测量。",
	);
	await generate().click();
	await ready();
	d = (await call("resumeList")).find((d) => d.id === id);
	assert.equal(d.versions.length, 1);
	await section().getByText("生成版本恢复", { exact: true }).click();
	await section()
		.getByRole("button", { name: "恢复此版本", exact: true })
		.first()
		.click();
	await section().getByRole("button", { name: "保存", exact: true }).click();
	numericFault = true;
	const repairPreviousRequest = (await call("resumeList")).find((d) => d.id === id).run.requestId;
	await generate().click();
	await page.waitForFunction(async ({ id, previous }) => {
		const current = (await window.picareer.call("resumeList", null)).find((d) => d.id === id);
		return current?.run?.requestId !== previous && current?.run?.status !== "running";
	}, { id, previous: repairPreviousRequest });
	await ready();
	d = (await call("resumeList")).find((d) => d.id === id);
	assert.equal(d.run.status, "complete", d.run.stage);
	assert.match(d.generationWarnings.join("\n"), /99%/);
	assert.ok(!JSON.stringify(d.experiences).includes("99"));
	assert.equal(await section().getByText(/^材料校验说明/).count(), 1);
	numericFault = false;
	result.numericRepairWithActualSDK = true;
	delay = true;
	await generate().click();
	await section().getByRole("button", { name: "停止", exact: true }).waitFor();
	await page.getByRole("button", { name: "工作台", exact: true }).click();
	await enter();
	await section()
		.getByRole("button", { name: /^项目经历优化/ })
		.click();
	await section().getByRole("button", { name: "停止", exact: true }).waitFor();
	await section().getByRole("button", { name: "停止", exact: true }).click();
	await section()
		.getByText("已停止，已完成的内容已保留", { exact: true })
		.waitFor();
	delay = false;
	await page.getByRole("button", { name: "工作台", exact: true }).click();
	await enter();
	assert.equal(await section().locator(".resume-content").count(), 0);
	await section()
		.getByRole("button", { name: /^项目经历优化/ })
		.click();
	assert.match(await overview().inputValue(), /本人实现/);
	await section().getByRole("button", { name: "新建", exact: true }).click();
	await page.waitForFunction(
		() =>
			document.querySelector('.resume-page input[aria-label="草稿名称"]')
				?.value === "经历优化",
	);
	await section().getByLabel("经历草稿").selectOption(id);
	await page.waitForFunction(() =>
		document
			.querySelector(
				'.resume-page textarea[aria-describedby="resume-overview-help"]',
			)
			?.value.includes("本人实现"),
	);
	await overview().waitFor();
	assert.match(await overview().inputValue(), /本人实现/);
	await section()
		.getByRole("button", { name: "删除草稿", exact: true })
		.click();
	await page
		.getByRole("dialog", { name: "删除草稿", exact: true })
		.getByRole("button", { name: "取消", exact: true })
		.click();
	for (const area of ["entry", "editor"]) {
		if (area === "entry") {
			await enter();
		} else {
			await section()
				.getByRole("button", { name: /^项目经历优化/ })
				.click();
		}
		const geometry = await page.evaluate(() => {
			const m = document.querySelector(".main");
			return { scroll: m.scrollWidth, viewport: m.clientWidth };
		});
		assert.ok(
			geometry.scroll <= geometry.viewport + 1,
			JSON.stringify(geometry),
		);
		await page.screenshot({ path: join(out, area + ".png") });
	}
	await app.close();
	await launch();
	await enter();
	assert.equal(await section().locator(".resume-content").count(), 0);
	await section()
		.getByRole("button", { name: /^项目经历优化/ })
		.click();
	await section().getByLabel("经历草稿").selectOption(id);
	await overview().waitFor();
	assert.match(await overview().inputValue(), /本人实现/);
	assert.ok(
		(await call("resumeList")).find((d) => d.id === id).experiences.length,
	);
	await section()
		.getByRole("button", { name: "删除草稿", exact: true })
		.click();
	await page
		.getByRole("dialog", { name: "删除草稿", exact: true })
		.getByRole("button", { name: "删除", exact: true })
		.click();
	await page.waitForTimeout(200);
	assert.ok(!(await call("resumeList")).some((d) => d.id === id));
	assert.ok(
		existsSync(
			join(root, ".test-data/resume-fixtures/中文 Agent 项目/agent.py"),
		),
	);
	assert.deepEqual(errors, []);
	Object.assign(result, {
		passed: true,
		requests,
		landingOnly: true,
		fullPlaceholderNoDraft: true,
		offlineDraft: true,
		settingsReturn: true,
		selectedSourceImport: true,
		actualPiMockModel: true,
		threeStageGeneration: true,
		missingContributionGate: true,
		copyWithoutEvidence: true,
		editing: true,
		versions: true,
		cancellation: true,
		sidebarReset: true,
		draftSwitch: true,
		restart: true,
		deleteOriginalPreserved: true,
		errors,
	});
} catch (e) {
	result.error = e.message;
	if (page)
		await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
	throw e;
} finally {
	writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
	await app?.close().catch(() => {});
	server.close();
}

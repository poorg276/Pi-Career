import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	existsSync,
} from "node:fs";
import assert from "node:assert/strict";
import { toolsServer } from "../tests/fixtures/tools-server.mjs";

const root = resolve(import.meta.dirname, ".."),
	scale = process.env.PICAREER_SCALE ?? "1.25";
const version = JSON.parse(
	readFileSync(join(root, "package.json"), "utf8"),
).version;
const out = join(
	root,
	".test-data",
	`chat-${version}-${process.env.PICAREER_EXE ? "packaged" : "dev"}-${scale}`,
);
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(out, "data-")),
	workspace = join(data, "中文 项目");
mkdirSync(workspace);
mkdirSync(join(workspace, ".pi/skills/fixture"), { recursive: true });
writeFileSync(join(workspace, "AGENTS.md"), "PROJECT_INSTRUCTIONS_MARKER\n");
writeFileSync(
	join(workspace, ".pi/skills/fixture/SKILL.md"),
	"---\nname: fixture\ndescription: 专用于测试资源加载\n---\nSKILL_INSTRUCTIONS_MARKER\n",
);
writeFileSync(join(workspace, "sample.txt"), "before");
writeFileSync(join(data, "outside.txt"), "outside");
const fixture = await toolsServer(),
	requests = [],
	errors = [],
	evidence = { version, scale };
const markdown =
	"**已完成**，这是本地模拟服务的测试结果。\n\n- 文件操作有记录\n- 联网资料有来源\n\n| 项目 | 状态 |\n| --- | --- |\n| 工具调用 | 正常 |\n\n```python\nprint('PiCareer')\n```\n\n[查看来源](https://example.com/agent)\n\n<script>window.__injected=true</script>";
const server = createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	const value = JSON.parse(body);
	requests.push(value);
	const messages = value.messages ?? [];
	let userIndex = messages.findLastIndex((m) => m.role === "user");
	const prompt = JSON.stringify(messages[userIndex]?.content),
		results = messages.slice(userIndex + 1).filter((m) => m.role === "tool");
	let tool,
		text = markdown;
	const callTool = (name, args) => {
		tool = {
			id: `call_${requests.length}`,
			type: "function",
			function: { name, arguments: JSON.stringify(args) },
		};
	};
	if (prompt.includes("TEST_TEN_TOOLS")) {
		await new Promise((r) => setTimeout(r, 100));
		if (results.length < 10) callTool("get_current_time", {});
	} else if (prompt.includes("TEST_ARTIFACTS")) {
		const steps = [
			["write", { path: "output/owned.txt", content: "fresh" }],
			[
				"edit",
				{ path: "output/owned.txt", oldText: "fresh", newText: "edited" },
			],
			[
				"powershell",
				{
					command:
						"Set-Content -LiteralPath 'output/declared.txt' -Value 'declared'",
					outputPaths: ["output/declared.txt"],
				},
			],
			[
				"powershell",
				{
					command:
						"Set-Content -LiteralPath 'output/unknown.txt' -Value 'untracked'",
				},
			],
			["write", { path: "output/external.txt", content: "initial" }],
			["write", { path: "output/shared.txt", content: "shared" }],
		];
		if (steps[results.length]) callTool(...steps[results.length]);
	} else if (prompt.includes("TEST_READ_SHARED") && !results.length)
		callTool("read", { path: "output/shared.txt" });
	else if (prompt.includes("TEST_SEQUENCE")) {
		if (results.length === 0) callTool("read", { path: "sample.txt" });
		else if (results.length === 1)
			callTool("edit", {
				path: "sample.txt",
				oldText: "before",
				newText: "after",
			});
		else if (results.length === 2)
			callTool("powershell", {
				command: "Get-Content -LiteralPath 'sample.txt'",
				timeout: 10,
			});
	} else if (prompt.includes("TEST_DATE") && !results.length)
		callTool("get_current_time", {});
	else if (prompt.includes("TEST_WEATHER") && !results.length)
		callTool("get_weather", { city: "长沙" });
	else if (prompt.includes("TEST_SEARCH") && !results.length)
		callTool("web_search", { query: "Agent 开发" });
	else if (prompt.includes("TEST_FETCH") && !results.length)
		callTool("web_fetch", { url: "https://example.com/agent" });
	else if (prompt.includes("TEST_DENY") && !results.length)
		callTool("write", { path: "denied.txt", content: "must not be written" });
	else if (prompt.includes("TEST_ESCAPE") && !results.length)
		callTool("read", { path: "../outside.txt" });
	else if (prompt.includes("SKILL_INSTRUCTIONS_MARKER")) text = "SKILL_READY";
	else if (prompt.includes("TEST_VISUAL"))
		text =
			"现在可以查询**日期与天气**、检索网页资料。\n\n选择工作目录后，还可以读取、编辑文件并执行 PowerShell；写入和命令操作前会请求确认。\n\n这段对话来自本地模拟服务，用于检查界面。";
	else if (prompt.includes("TEST_LONG"))
		text = Array.from(
			{ length: 35 },
			(_, i) =>
				`第 ${i + 1} 段：` + "这是一段用于测试阅读滚动位置的文字。".repeat(4),
		).join("\n\n");
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
	});
	const emit = (delta, finish_reason = null) =>
		res.write(
			`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "mock-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
		);
	emit({ role: "assistant" });
	if (prompt.includes("TEST_SLOW")) {
		let n = 0;
		const timer = setInterval(() => {
			emit({ content: `流式片段 ${++n}。\n\n` });
			if (n >= 30) {
				clearInterval(timer);
				emit({}, "stop");
				res.end("data: [DONE]\n\n");
			}
		}, 130);
		res.on("close", () => clearInterval(timer));
		return;
	}
	if (tool) {
		emit({ tool_calls: [{ index: 0, ...tool }] });
		emit({}, "tool_calls");
	} else {
		for (let i = 0; i < text.length; i += 25)
			emit({ content: text.slice(i, i + 25) });
		emit({}, "stop");
	}
	res.end("data: [DONE]\n\n");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let app, page;
const call = (method, input = null) =>
	page.evaluate(({ method, input }) => window.picareer.call(method, input), {
		method,
		input,
	});
async function launch() {
	app = await electron.launch({
		executablePath:
			process.env.PICAREER_EXE ??
			join(root, "node_modules/electron/dist/electron.exe"),
		args: [
			...(process.env.PICAREER_EXE ? [] : [root]),
			`--force-device-scale-factor=${scale}`,
		],
		env: {
			...process.env,
			PICAREER_TEST_DATA: data,
			NODE_EXTRA_CA_CERTS: join(root, "tests/fixtures/tools-test-cert.pem"),
		},
		timeout: 60000,
	});
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
	await app.evaluate(
		async ({ BrowserWindow, session, dialog, shell }, { proxy, workspace }) => {
			await session.defaultSession.setProxy({ proxyRules: proxy });
			const w = BrowserWindow.getAllWindows()[0];
			w.setSize(1060, 760);
			w.showInactive();
			dialog.showOpenDialog = async () => ({
				canceled: false,
				filePaths: [workspace],
			});
			globalThis.__opened = [];
			shell.openExternal = async (url) => {
				globalThis.__opened.push(url);
			};
		},
		{ proxy: fixture.proxy, workspace },
	);
}
const openChat = async (id) => {
	await page
		.getByRole("button", { name: /通用 Agent/ })
		.first()
		.click();
	if ((await page.locator(".chat-history").count()) === 0)
		await page
			.getByRole("button", { name: /通用 Agent/ })
			.first()
			.click();
	if (id) {
		const c = await call("chatSnapshot", { id });
		await page
			.locator(".chat-history-row")
			.filter({ hasText: c.title })
			.first()
			.click();
	}
};
try {
	await launch();
	await call("settings", {
		provider: "custom",
		model: "mock-model",
		api: "openai-completions",
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
		key: "fixture-only",
	});
	await page.reload();
	await page.getByRole("heading", { name: "PiCareer工作台" }).waitFor();
	await openChat();
	await page.getByRole("button", { name: /新对话/ }).click();
	await page.getByLabel("对话消息").fill("TEST_DATE");
	await page.getByRole("button", { name: "发送 →", exact: true }).click();
	await page.locator(".chat-message.assistant strong").waitFor();
	let c = (await call("state")).chats[0];
	assert.equal(await page.locator(".topbar").count(), 0);
	assert.equal(
		await page.locator(".composer-model").textContent(),
		"mock-model",
	);
	await page.locator(".chat-turn-end.complete").waitFor();
	assert.equal(c.turns.length, 1);
	assert.equal(c.turns[0].context, undefined);
	evidence.endMarkerAndModelPosition = true;
	assert.equal(
		await page
			.locator(".chat-header")
			.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
		44,
	);
	assert.equal(
		await page
			.locator(".chat-header .eyebrow,.chat-capabilities,.chat-tool")
			.count(),
		0,
	);
	assert.equal(
		await page.locator(".chat-header").getByRole("button").count(),
		0,
	);
	assert.ok(
		await page
			.locator(".composer-directory")
			.evaluate(
				(el) =>
					el.getBoundingClientRect().left >
					document.querySelector(".composer-model").getBoundingClientRect()
						.right,
			),
	);
	evidence.compactHeaderAndDirectory = true;
	assert.ok(
		c.entries.some(
			(e) => e.name === "get_current_time" && e.status === "complete",
		),
	);
	const names = requests[0].tools.map((t) => t.function.name);
	for (const name of [
		"get_current_time",
		"get_weather",
		"web_search",
		"web_fetch",
	])
		assert.ok(names.includes(name), name);
	assert.ok(!names.includes("powershell") && !names.includes("read"));
	evidence.defaultTools = true;
	assert.equal(await page.locator(".chat-prose table").count(), 1);
	assert.equal(await page.locator(".chat-prose pre code").count(), 1);
	assert.equal(await page.evaluate(() => !!window.__injected), false);
	await page.locator(".chat-prose a").click();
	assert.deepEqual(await app.evaluate(() => globalThis.__opened), [
		"https://example.com/agent",
	]);
	evidence.markdown = true;
	await page
		.locator(".chat-history-row")
		.filter({ hasText: "TEST_DATE" })
		.click({ button: "right" });
	await page.getByRole("menuitem", { name: "重命名" }).click();
	await page.getByLabel("对话名称").fill("我的 Agent 工作空间");
	await page.getByLabel("对话名称").press("Enter");
	await page.getByRole("heading", { name: "我的 Agent 工作空间" }).waitFor();
	await page
		.getByRole("button", { name: /通用 Agent/ })
		.first()
		.click();
	assert.equal(await page.locator(".chat-history").count(), 0);
	assert.equal(
		await page.getByRole("heading", { name: "我的 Agent 工作空间" }).count(),
		1,
	);
	await page
		.getByRole("button", { name: /通用 Agent/ })
		.first()
		.click();
	await page.getByRole("button", { name: /选择工作目录/ }).click();
	await page.getByRole("button", { name: /更换工作目录/ }).waitFor();
	await page.evaluate(() => {
		window.__approve = "yes";
		window.picareer.onEvent((e) => {
			if (
				e.type === "prompt" &&
				e.prompt.kind === "approval" &&
				window.__approve
			)
				void window.picareer.call("reply", {
					id: e.prompt.id,
					value: window.__approve,
				});
		});
	});
	const sequence = await call("chat", { id: c.id, text: "TEST_SEQUENCE" });
	assert.equal(readFileSync(join(workspace, "sample.txt"), "utf8"), "after");
	assert.equal(sequence.title, "我的 Agent 工作空间");
	assert.deepEqual(
		sequence.entries
			.filter((e) => e.turnId === sequence.run.turnId && e.role === "tool")
			.map((e) => [e.name, e.status]),
		[
			["read", "complete"],
			["edit", "complete"],
			["powershell", "complete"],
		],
	);
	assert.ok(
		requests.some((r) =>
			JSON.stringify(r.messages).includes("PROJECT_INSTRUCTIONS_MARKER"),
		),
	);
	assert.ok(
		requests.some((r) =>
			JSON.stringify(r.messages).includes("专用于测试资源加载"),
		),
	);
	assert.match(
		(await call("chat", { id: c.id, text: "/skill:fixture" })).messages.at(-1)
			.text,
		/SKILL_READY/,
	);
	evidence.projectAndSkills = true;
	const many = call("chat", { id: c.id, text: "TEST_TEN_TOOLS" });
	await page.locator(".turn-progress.running .activity-line").first().waitFor();
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(await page.locator(".activity-line").first().evaluate(el=>getComputedStyle(el).animationName), "none");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	let sawThree = false;
	for (let i = 0; i < 12; i++) {
		const rows = await page
			.locator(".turn-progress.running .activity-line")
			.count();
		assert.ok(rows <= 3);
		if (rows === 3 && !sawThree) await page.screenshot({ path: join(out, "progress.png") });
		sawThree ||= rows === 3;
		await page.waitForTimeout(80);
	}
	assert.ok(sawThree);
	await page.emulateMedia({ reducedMotion: "reduce" });
	if (await page.locator(".activity-line").count())
		assert.equal(
			await page
				.locator(".activity-line")
				.first()
				.evaluate((el) => getComputedStyle(el).animationName),
			"none",
		);
	const manyResult = await many;
	assert.equal(
		manyResult.entries.filter(
			(e) => e.turnId === manyResult.run.turnId && e.role === "tool",
		).length,
		10,
	);
	assert.equal(await page.locator(".activity-line").count(), 0);
	assert.match(
		await page.locator(".turn-progress.settled").last().textContent(),
		/已完成思考与工具调用/,
	);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	evidence.threeLineProgressAndReducedMotion = true;
	const artifacts = await call("createChat", { cwd: workspace });
	const created = await call("chat", {
		id: artifacts.id,
		text: "TEST_ARTIFACTS",
	});
	assert.ok(
		created.entries
			.filter((e) => e.role === "tool")
			.every((e) => e.status === "complete"),
	);
	const reader = await call("createChat", { cwd: workspace });
	await call("chat", { id: reader.id, text: "TEST_READ_SHARED" });
	writeFileSync(join(workspace, "output/external.txt"), "user changed");
	await page.locator(".chat-history-row").filter({ hasText: created.title }).click({ button: "right" });
	await page.getByRole("menuitem", { name: "删除", exact: true }).click();
	await page.getByText("查看清理清单", { exact: true }).click();
	await page.screenshot({ path: join(out, "delete-preview.png") });
	await page.getByRole("dialog", { name: "删除对话", exact: true }).press("Escape");
	const preview = await call("previewDeleteChat", { id: artifacts.id });
	assert.equal(preview.files.length, 2);
	assert.equal(preview.skipped.length, 2);
	assert.equal(preview.undeclaredCommands, 1);
	assert.equal(
		(await call("deleteChat", { id: artifacts.id, token: "stale-token" }))
			.deleted,
		false,
	);
	await app.evaluate(({ shell }) => {
		const original = shell.trashItem.bind(shell);
		let once = true;
		globalThis.__trashCalls = [];
		shell.trashItem = async (path) => {
			if (once && path.endsWith("owned.txt")) {
				once = false;
				throw new Error("fixture occupied");
			}
			globalThis.__trashCalls.push(path);
			return original(path);
		};
	});
	const failedDelete = await call("deleteChat", {
		id: artifacts.id,
		token: preview.token,
	});
	assert.equal(failedDelete.deleted, false);
	assert.ok(failedDelete.errors.length);
	const retryPreview = await call("previewDeleteChat", { id: artifacts.id });
	assert.equal(retryPreview.files.length, 1);
	assert.equal(
		(await call("deleteChat", { id: artifacts.id, token: retryPreview.token }))
			.deleted,
		true,
	);
	assert.equal(existsSync(join(workspace, "output/owned.txt")), false);
	assert.equal(existsSync(join(workspace, "output/declared.txt")), false);
	for (const name of ["external.txt", "shared.txt", "unknown.txt"])
		assert.ok(existsSync(join(workspace, "output", name)));
	assert.equal((await app.evaluate(() => globalThis.__trashCalls)).length, 2);
	assert.equal(existsSync(created.sessionFile), false);
	evidence.realRecycleBinAndOwnership = true;
	await page.evaluate(() => {
		window.__approve = "no";
	});
	const denied = await call("chat", { id: c.id, text: "TEST_DENY" });
	assert.ok(
		denied.entries.some((e) => e.name === "write" && e.text.includes("拒绝")),
	);
	const escape = await call("chat", { id: c.id, text: "TEST_ESCAPE" });
	assert.ok(
		escape.entries.some(
			(e) => e.name === "read" && e.text.includes("路径超出"),
		),
	);
	evidence.toolBoundaries = true;
	const keyless = await call("chat", { id: c.id, text: "TEST_SEARCH" });
	assert.ok(
		keyless.entries.some(
			(e) =>
				e.turnId === keyless.run.turnId &&
				e.name === "web_search" &&
				e.status === "complete" &&
				e.text.includes('"Bing"'),
		),
		JSON.stringify(keyless.entries.at(-2)),
	);
	const direct = await call("chat", { id: c.id, text: "TEST_FETCH" });
	assert.ok(
		direct.entries.some(
			(e) =>
				e.turnId === direct.run.turnId &&
				e.name === "web_fetch" &&
				e.status === "complete" &&
				e.text.includes("直接读取"),
		),
	);
	fixture.mode = "bing-blocked";
	const fallback = await call("chat", { id: c.id, text: "TEST_SEARCH" });
	assert.ok(
		fallback.entries.some(
			(e) =>
				e.turnId === fallback.run.turnId && e.text.includes('"DuckDuckGo"'),
		),
	);
	fixture.mode = "ok";
	evidence.keylessSearchExtractionAndFallback = true;
	const weather = await call("chat", { id: c.id, text: "TEST_WEATHER" });
	assert.ok(
		weather.entries.some(
			(e) =>
				e.name === "get_weather" &&
				e.status === "complete" &&
				e.text.includes("Open-Meteo"),
		),
	);
	await call("settings", {
		provider: "custom",
		model: "mock-model",
		api: "openai-completions",
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
		searchKey: "fixture-only-search",
	});
	for (const [text, name] of [
		["TEST_SEARCH", "web_search"],
		["TEST_FETCH", "web_fetch"],
	]) {
		const r = await call("chat", { id: c.id, text });
		assert.ok(
			r.entries.some(
				(e) =>
					e.turnId === r.run.turnId &&
					e.name === name &&
					e.status === "complete",
			),
		);
	}
	assert.ok(
		[
			"api.tavily.com:443",
			"api.open-meteo.com:443",
			"geocoding-api.open-meteo.com:443",
		].every((host) => fixture.tunnels.includes(host)),
	);
	evidence.proxyTools = true;
	fixture.mode = "429";
	const limited = await call("chat", { id: c.id, text: "TEST_WEATHER" });
	assert.ok(
		limited.entries.some(
			(e) =>
				e.turnId === limited.run.turnId &&
				e.status === "error" &&
				e.text.includes("429"),
		),
	);
	fixture.mode = "wait";
	const waiting = call("chat", { id: c.id, text: "TEST_WEATHER" });
	await page.waitForFunction(() =>
		[
			...document.querySelectorAll(".turn-progress.running .activity-line"),
		].some((el) => el.textContent.includes("查询天气")),
	);
	await call("stopChat", { id: c.id });
	assert.equal((await waiting).run.status, "cancelled");
	fixture.mode = "ok";
	await call("chat", { id: c.id, text: "TEST_LONG" });
	const slow = call("chat", { id: c.id, text: "TEST_SLOW" });
	await page.getByRole("button", { name: "停止生成", exact: true }).waitFor();
	await call("renameChat", { id: c.id, title: "持续工作的 Agent" });
	await page.evaluate(() => {
		const el = document.querySelector(".chat-messages");
		el.scrollTop = 0;
		el.dispatchEvent(new Event("scroll"));
	});
	await page.waitForTimeout(400);
	assert.equal(
		await page.locator(".chat-messages").evaluate((el) => el.scrollTop),
		0,
	);
	evidence.readingPosition = true;
	await page.getByRole("button", { name: "企业岗位", exact: true }).click();
	await page.waitForTimeout(300);
	await openChat(c.id);
	assert.ok(await page.getByText(/流式片段/).count());
	await page.getByRole("button", { name: "停止生成", exact: true }).click();
	assert.equal((await slow).run.status, "cancelled");
	assert.equal(
		(await call("chatSnapshot", { id: c.id })).title,
		"持续工作的 Agent",
	);
	evidence.streamingNavigationRenameStop = true;
	// IME Enter confirms composition rather than sending a new turn.
	const before = requests.length;
	await page.getByLabel("对话消息").fill("输入法测试");
	await page
		.getByLabel("对话消息")
		.evaluate((el) =>
			el.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					isComposing: true,
				}),
			),
		);
	await page.waitForTimeout(100);
	assert.equal(requests.length, before);
	evidence.ime = true;
	const visual = await call("chat", {
		text: "请介绍一下现在可以使用的功能。TEST_VISUAL",
	});
	await page
		.locator(".chat-history-row")
		.filter({ hasText: visual.title })
		.first()
		.click();
	const geometry = await page.evaluate(() => {
		const r = (selector) => {
			const el = document.querySelector(selector),
				b = el.getBoundingClientRect();
			return {
				x: b.x,
				y: b.y,
				right: b.right,
				bottom: b.bottom,
				width: b.width,
				height: b.height,
				font: getComputedStyle(el).fontSize,
			};
		};
		return {
			viewport: { width: innerWidth, height: innerHeight },
			user: r(".chat-message.user"),
			assistant: r(".chat-message.assistant"),
			composer: r(".chat-composer"),
			input: r(".chat-composer textarea"),
			workspace: r(".chat-workspace"),
			prose: r(".chat-prose"),
			horizontalOverflow:
				document.querySelector(".main").scrollWidth >
				document.querySelector(".main").clientWidth,
		};
	});
	assert.ok(geometry.user.x > geometry.assistant.x);
	assert.equal(geometry.prose.font, "16px");
	assert.equal(geometry.input.font, "16px");
	assert.ok(geometry.composer.bottom <= geometry.viewport.height);
	assert.ok(!geometry.horizontalOverflow);
	evidence.geometry = geometry;
	await page.screenshot({ path: join(out, "chat.png") });
	const del = await call("createChat", {});
	await call("renameChat", { id: del.id, title: "待删除的生成中对话" });
	await page
		.locator(".chat-history-row")
		.filter({ hasText: "待删除的生成中对话" })
		.click();
	const deletingRun = call("chat", { id: del.id, text: "TEST_SLOW" });
	deletingRun.catch(() => {});
	await page
		.locator(".chat-message.assistant")
		.filter({ hasText: "流式片段" })
		.first()
		.waitFor();
	await page
		.locator(".chat-history-row")
		.filter({ hasText: "待删除的生成中对话" })
		.click({ button: "right" });
	await page.getByRole("menuitem", { name: "删除", exact: true }).click();
	await page.getByRole("button", { name: "删除对话", exact: true }).click();
	const deletedSnapshot = await deletingRun;
	await page
		.getByRole("dialog", { name: "删除对话", exact: true })
		.waitFor({ state: "hidden" });
	assert.equal(
		(await call("state")).chats.some((chat) => chat.id === del.id),
		false,
	);
	assert.equal(existsSync(deletedSnapshot.sessionFile), false);
	await app.evaluate(
		({ BrowserWindow }, chat) =>
			BrowserWindow.getAllWindows()[0].webContents.send("event", {
				type: "chatUpdate",
				chatId: chat.id,
				chat,
			}),
		deletedSnapshot,
	);
	await call("deleteChat", { id: del.id });
	await page.waitForTimeout(150);
	assert.equal(
		await page
			.locator(".chat-history-row")
			.filter({ hasText: "待删除的生成中对话" })
			.count(),
		0,
	);
	evidence.deleteDuringGenerationAndLateEvent = true;
	await app.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].setSize(1024, 700),
	);
	await page.waitForTimeout(150);
	assert.ok(
		await page
			.locator(".chat-composer")
			.evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
	);
	await page.screenshot({ path: join(out, "chat-small.png") });
	const longModel = "model-" + "long-name-".repeat(12);
	await call("settings", {
		provider: "custom",
		model: longModel,
		api: "openai-completions",
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
	});
	await page.reload();
	await page.getByRole("heading", { name: "PiCareer工作台" }).waitFor();
	await openChat(visual.id);
	assert.ok(
		await page
			.locator(".composer-model span")
			.evaluate((el) => el.scrollWidth > el.clientWidth),
	);
	assert.ok(
		await page
			.locator(".chat-composer")
			.evaluate(
				(el) =>
					el.scrollWidth <= el.clientWidth &&
					el.getBoundingClientRect().bottom <= innerHeight,
			),
	);
	evidence.longModel = true;
	await page
		.locator(".chat-history-row")
		.filter({ hasText: visual.title })
		.click({ button: "right" });
	await page.getByRole("menuitem", { name: "删除", exact: true }).click();
	await page
		.getByRole("dialog", { name: "删除对话", exact: true })
		.press("Escape");
	assert.ok((await call("state")).chats.some((chat) => chat.id === visual.id));
	evidence.cancelDelete = true;
	await call("settings", {
		provider: "custom",
		model: "mock-model",
		api: "openai-completions",
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
	});
	await app.close();
	app = undefined;
	await launch();
	assert.equal(
		(await call("chatSnapshot", { id: c.id })).title,
		"持续工作的 Agent",
	);
	evidence.restart = true;
	const crashing = call("chat", { id: c.id, text: "TEST_SLOW" }).catch(
		() => undefined,
	);
	await page.waitForTimeout(700);
	await app.evaluate(({ app }) => {
		const worker = app.getAppMetrics().find((m) => m.name === "PiCareer Agent");
		process.kill(worker.pid);
	});
	await crashing;
	await app.close();
	app = undefined;
	await launch();
	const recovered = await call("chatSnapshot", { id: c.id });
	assert.equal(recovered.run.status, "interrupted");
	assert.ok(
		recovered.entries.some(
			(e) => e.turnId === recovered.run.turnId && e.text.includes("流式片段"),
		),
	);
	evidence.crashRecovery = true;
	assert.equal(recovered.turns.at(-1).status, "interrupted");
	assert.equal(
		new Set(recovered.turns.map((turn) => turn.turnId)).size,
		recovered.turns.length,
	);
	await openChat(c.id);
	for (const chat of (await call("state")).chats) {
		const p = await call("previewDeleteChat", { id: chat.id });
		assert.equal(
			(await call("deleteChat", { id: chat.id, token: p.token })).deleted,
			true,
		);
	}
	await page.getByRole("heading", { name: "今天想一起做些什么？" }).waitFor();
	assert.equal((await call("state")).chats.length, 0);
	assert.equal(readFileSync(join(workspace, "sample.txt"), "utf8"), "after");
	evidence.deleteLastKeepsProject = true;
	assert.deepEqual(errors, []);
	evidence.passed = true;
	evidence.requests = requests.length;
	evidence.errors = errors;
	writeFileSync(join(out, "result.json"), JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify(evidence));
} catch (error) {
	if (page && !page.isClosed())
		await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
	throw error;
} finally {
	await app?.close();
	server.closeAllConnections();
	await new Promise((r) => server.close(r));
	await fixture.close();
}

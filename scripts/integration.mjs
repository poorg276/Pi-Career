import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import {
	mkdtempSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	existsSync,
} from "node:fs";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, ".test-data"), { recursive: true });
const data = mkdtempSync(join(root, ".test-data", "integration-中文 空格-")),
	workspace = join(data, "workspace");
mkdirSync(workspace);
const requests = [];
const server = createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	const value = JSON.parse(body);
	requests.push(value);
	const messages = value.messages ?? [],
		last = messages.at(-1),
		prompt =
			typeof last?.content === "string"
				? last.content
				: JSON.stringify(last?.content);
	let content = "PiCareer mock connection successful";
	let tool;
	if (prompt?.includes("TEST_LIMIT") || prompt?.includes("TEST_EXPIRED")) {
		res.writeHead(prompt.includes("TEST_LIMIT") ? 429 : 401, {
			"Content-Type": "application/json",
			"Retry-After": "0",
		});
		res.end(
			JSON.stringify({
				error: {
					message: prompt.includes("TEST_LIMIT")
						? "test rate limit"
						: "test invalid token",
					type: "test_error",
				},
			}),
		);
		return;
	}
	if (prompt?.includes("TEST_DISCONNECT")) {
		req.socket.destroy();
		return;
	}
	if (last?.role === "tool")
		content = "Tool operation handled. " + JSON.stringify(last.content);
	else if (
		prompt?.includes("TEST_GREP") ||
		prompt?.includes("TEST_FIND") ||
		prompt?.includes("TEST_POWERSHELL") ||
		prompt?.includes("TEST_READ")
	) {
		const name = prompt.includes("TEST_GREP")
			? "grep"
			: prompt.includes("TEST_FIND")
				? "find"
				: prompt.includes("TEST_READ")
					? "read"
					: "powershell";
		const args =
			name === "grep"
				? { pattern: "approved", path: "." }
				: name === "find"
					? { pattern: "*.txt", path: "." }
					: name === "read"
						? { path: "verification.txt" }
						: { command: "Write-Output 'PS_READY'", timeout: 10 };
		tool = {
			id: "call_native",
			type: "function",
			function: { name, arguments: JSON.stringify(args) },
		};
	} else if (prompt?.includes("TEST_WRITE"))
		tool = {
			id: "call_test",
			type: "function",
			function: {
				name: "write",
				arguments: JSON.stringify({
					path: "verification.txt",
					content: "approved test write",
				}),
			},
		};
	else if (prompt?.includes("安排8道"))
		content = JSON.stringify({
			questions: Array.from(
				{ length: 8 },
				(_, i) => `模拟问题${i + 1}：请解释你的 Agent 项目设计。`,
			),
		});
	else if (prompt?.includes("决定是否需要追问")) content = '{"followup":""}';
	else if (prompt?.includes("生成面试报告"))
		content = "测试报告：已完成8题，参考反馈仅为自动化模拟数据。";
	else if (prompt?.includes("选择需复习的编号"))
		content = JSON.stringify({
			ids: Array.from(
				{ length: 113 },
				(_, i) => "K" + String(i + 1).padStart(3, "0"),
			),
			reason: "测试选择113条，用于验证两个阶段测验及结业测验。",
		});
	else if (prompt?.includes("每题0-10分"))
		content = JSON.stringify({
			feedback: "测试小测反馈：检查参考答案，继续复习。",
			reviewIds: ["K001"],
		});
	else if (prompt?.includes("TEST_CONTEXT")) {
		content = messages.some((m) =>
			JSON.stringify(m.content).includes("TEST_FIRST"),
		)
			? "context restored"
			: "ERROR: missing context";
	}
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
	});
	const emit = (delta, finish_reason = null) =>
		res.write(
			"data: " +
				JSON.stringify({
					id: "test-completion",
					object: "chat.completion.chunk",
					created: 1,
					model: "mock-model",
					choices: [{ index: 0, delta, finish_reason }],
				}) +
				"\n\n",
		);
	emit({ role: "assistant" });
	if (prompt?.includes("TEST_STOP")) {
		emit({ content: "partial" });
		const timer = setTimeout(() => {
			emit({}, "stop");
			res.end("data: [DONE]\n\n");
		}, 30000);
		res.on("close", () => clearTimeout(timer));
		return;
	}
	if (tool) {
		emit({ tool_calls: [{ index: 0, ...tool }] });
		emit({}, "tool_calls");
	} else {
		for (let i = 0; i < content.length; i += 25)
			emit({ content: content.slice(i, i + 25) });
		emit({}, "stop");
	}
	res.end("data: [DONE]\n\n");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
// Explicitly unavailable search service: this suite validates JD-only fallback, not public sites.
const offlineProxy = createServer((_request, response) => { response.writeHead(502); response.end(); });
offlineProxy.on("connect", (_request, socket) => socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"));
await new Promise((resolve) => offlineProxy.listen(0, "127.0.0.1", resolve));
let app;
async function start() {
	const runtimeEnv = { ...process.env, PICAREER_TEST_DATA: data };
	if (process.env.PICAREER_CLEAN_PATH) {
		for (const k of Object.keys(runtimeEnv))
			if (k.toLowerCase() === "path") delete runtimeEnv[k];
		runtimeEnv.Path = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`;
	}
	app = await electron.launch({
		executablePath:
			process.env.PICAREER_EXE ??
			join(root, "node_modules/electron/dist/electron.exe"),
		args: process.env.PICAREER_EXE ? [] : [root],
		env: runtimeEnv,
		timeout: 60000,
	});
	const page = await app.firstWindow();
	await page
		.getByRole("heading", { name: "PiCareer工作台" })
		.waitFor({ timeout: 60000 });
	await app.evaluate(async ({ session }, port) => session.defaultSession.setProxy({ mode: "fixed_servers", proxyRules: `http://127.0.0.1:${port}` }), offlineProxy.address().port);
	return page;
}
try {
	let page = await start();
	const call = (method, input = null) =>
		page.evaluate(({ method, input }) => window.picareer.call(method, input), {
			method,
			input,
		});
	await call("settings", {
		provider: "custom",
		model: "mock-model",
		baseUrl: `http://127.0.0.1:${port}/v1`,
		api: "openai-completions",
		key: "test-key-only-not-real",
	});
	assert.match(await call("testModel"), /mock connection/);
	const chat = await call("chat", { text: "TEST_FIRST" });
	assert.match(chat.messages.at(-1).text, /mock connection/);
	assert.ok(chat.sessionFile && existsSync(chat.sessionFile));
	await app.close();
	page = await start();
	const restored = await call("chat", { id: chat.id, text: "TEST_CONTEXT" });
	assert.match(restored.messages.at(-1).text, /context restored/);
	assert.equal(
		readFileSync(join(data, "picareer.sqlite")).includes(
			Buffer.from("test-key-only-not-real"),
		),
		false,
	);
	// Stop while a permission request is pending must cancel the request and close its modal.
	await page.evaluate(() => {
		window.__approvalSeen = false;
		window.__approvalClosed = false;
		window.picareer.onEvent((e) => {
			if (e.type === "prompt") window.__approvalSeen = true;
			if (e.type === "promptClosed") window.__approvalClosed = true;
		});
	});
	const waiting = call("chat", { text: "TEST_WRITE", cwd: workspace });
	await page.waitForFunction(() => window.__approvalSeen);
	await call("stop");
	await waiting;
	assert.equal(await page.evaluate(() => window.__approvalClosed), true);
	assert.equal(existsSync(join(workspace, "verification.txt")), false);
	// Exercise actual Pi tool execution and the approval extension, not a mocked UI action.
	await page.evaluate(() =>
		window.picareer.onEvent((e) => {
			if (e.type === "prompt")
				window.picareer.call("reply", { id: e.prompt.id, value: "no" });
		}),
	);
	await call("chat", { text: "TEST_WRITE", cwd: workspace });
	assert.equal(existsSync(join(workspace, "verification.txt")), false);
	await app.close();
	page = await start();
	await page.evaluate(() =>
		window.picareer.onEvent((e) => {
			if (e.type === "prompt")
				window.picareer.call("reply", { id: e.prompt.id, value: "yes" });
		}),
	);
	await call("chat", { text: "TEST_WRITE", cwd: workspace });
	assert.equal(
		readFileSync(join(workspace, "verification.txt"), "utf8"),
		"approved test write",
	);
	const stopped = call("chat", { text: "TEST_STOP" });
	await new Promise((r) => setTimeout(r, 500));
	await call("stop");
	const partial = await stopped;
	assert.ok(
		partial.messages.at(-1).text.includes("partial") ||
			partial.messages.at(-1).text.includes("停止"),
	);
	for (const [text, expected] of [
		["TEST_GREP", "approved test write"],
		["TEST_FIND", "verification.txt"],
		["TEST_READ", "approved test write"],
		["TEST_POWERSHELL", "PS_READY"],
	]) {
		const result = await call("chat", { text, cwd: workspace });
		assert.ok(
			result.messages.at(-1).text.includes(expected),
			result.messages.at(-1).text,
		);
	}
	for (const text of ["TEST_LIMIT", "TEST_EXPIRED", "TEST_DISCONNECT"]) {
		const result = await call("chat", { text });
		assert.equal(result.run.status, "error");
		assert.ok(result.run.error);
	}
	let interview = await call("startInterview", {
		company: "测试企业",
		role: "Agent开发",
		jd: "Python Agent RAG",
	});
	assert.equal(interview.questions.length, 8);
	assert.ok(interview.warning);
	for (let n = 0; n < 8; n++) {
		interview = await call("answerInterview", {
			id: interview.id,
			answer: "测试回答",
		});
		if (n === 2) {
			await app.close();
			page = await start();
			const snapshot = await call("state");
			assert.equal(
				snapshot.interviews.find((i) => i.id === interview.id).current,
				3,
			);
		}
	}
	assert.equal(interview.status, "complete");
	assert.match(interview.report, /测试报告/);
	const allSkills = [
		...new Set(
			JSON.parse(
				readFileSync(join(root, "content/knowledge.json"), "utf8"),
			).flatMap((k) => k.tags),
		),
	].join(" ");
	let plan = await call("startPlan", { jd: allSkills });
	assert.equal(plan.items.length, 113);
	for (let n = 0; n < 5; n++)
		plan = await call("advancePlan", { id: plan.id, token: plan.batchToken });
	assert.equal(plan.status, "quiz");
	await app.close();
	page = await start();
	let state = await call("state");
	plan = state.plans.find((p) => p.id === plan.id);
	assert.equal(plan.status, "quiz");
	while (plan.status !== "complete") {
		if (plan.status === "learning")
			plan = await call("advancePlan", { id: plan.id, token: plan.batchToken });
		else {
			const q = plan.quizzes.at(-1);
			plan = await call("submitQuiz", {
				id: plan.id,
				quizId: q.id,
				answers: Object.fromEntries(q.itemIds.map((id) => [id, "测试回答"])),
			});
		}
	}
	assert.equal(plan.completed, 113);
	assert.equal(plan.quizzes.length, 3);
	await app.evaluate(({ shell }) => {
		shell.openExternal = async () => {};
	});
	const attemptId = "integration-auth-cancel";
	const login = call("login", {
		provider: "openai-codex",
		method: "browser",
		attemptId,
	});
	await new Promise((r) => setTimeout(r, 600));
	await call("cancelLogin", { attemptId });
	assert.equal(
		(
			await Promise.race([
				login,
				new Promise((r) => setTimeout(() => r(false), 5000)),
			])
		).status,
		"cancelled",
	);
	await app.evaluate(({ app }) => {
		const worker = app.getAppMetrics().find((m) => m.name === "PiCareer Agent");
		if (!worker) throw new Error("Missing worker process");
		process.kill(worker.pid);
	});
	await page.getByText(/后台进程已退出/).waitFor({ timeout: 10000 });
	await assert.rejects(() => call("state"), /后台/);
	writeFileSync(
		join(data, "result.json"),
		JSON.stringify(
			{
				passed: true,
				api: true,
				encryptedCredentials: true,
				restartContext: true,
				toolAllowDeny: true,
				cancel: true,
				interview8: true,
				learning113: true,
				nativeReadSearchFindPowerShell: true,
				oauthCancel: true,
				workerCrash: true,
				modelRateLimitInvalidTokenDisconnect: true,
				cleanPath: !!process.env.PICAREER_CLEAN_PATH,
				requests: requests.length,
			},
			null,
			2,
		),
	);
	console.log(
		"PASS: real Pi SDK + local mock provider; encrypted credentials, restart context, tool allow/deny, cancellation, 8-question interview, 113-item study plan. Requests:",
		requests.length,
	);
} finally {
	if (app) await app.close().catch(() => {});
	await new Promise((r) => server.close(r));
	await new Promise((r) => offlineProxy.close(r));
}

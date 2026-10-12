import { _electron as electron } from "playwright";
import { join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, ".."),
	version = JSON.parse(readFileSync(join(root, "package.json"))).version,
	scale = process.env.PICAREER_SCALE ?? "1.25";
const out = join(
	root,
	`.test-data/coding-${version}-${process.env.PICAREER_EXE ? "packaged" : "dev"}-${scale}`,
);
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(out, "data-")),
	errors = [],
	evidence = { version, scale, passed: false };
const official = JSON.parse(
	readFileSync(join(root, "content/official-problems.json")),
);
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
		env: { ...process.env, PICAREER_TEST_DATA: data },
		timeout: 60000,
	});
	page = await app.firstWindow();
	page.on("pageerror", (e) => errors.push(e.message));
	await page
		.getByRole("heading", { name: "PiCareer工作台" })
		.waitFor({ timeout: 60000 });
	await app.evaluate(async ({ BrowserWindow, shell, clipboard }) => {
		const w = BrowserWindow.getAllWindows()[0];
		w.setSize(1060, 760);
		w.showInactive();
		globalThis.codingOpened = [];
		globalThis.originalOpen = shell.openExternal;
		globalThis.originalWrite = clipboard.writeText;
		globalThis.clipboardBackup = await clipboard.read();
		shell.openExternal = async (url) => {
			globalThis.codingOpened.push(url);
		};
	});
};
const call = (method, input = null) =>
	page.evaluate(({ method, input }) => window.picareer.call(method, input), {
		method,
		input,
	});
const button = (name) => page.getByRole("button", { name, exact: true });
const pick = async (id) => {
	await page.getByRole("button", { name: new RegExp(`^${id}\\.`) }).click();
	await page
		.locator(".problem-detail h2")
		.filter({ hasText: new RegExp(`^${id}\\.`) })
		.waitFor();
};
const enterCode = async (text) => {
	await page.locator(".monaco-editor").click({ position: { x: 150, y: 45 } });
	await page.keyboard.press("Control+A");
	await page.keyboard.insertText(text);
};
const alert = (message) => page.getByRole("alert").filter({ hasText: message });
const close = async () => {
	if (app) {
		await app
			.evaluate(async ({ clipboard, shell }) => {
				if (globalThis.clipboardBackup)
					await clipboard.write(globalThis.clipboardBackup);
				if (globalThis.originalOpen)
					shell.openExternal = globalThis.originalOpen;
				if (globalThis.originalWrite)
					clipboard.writeText = globalThis.originalWrite;
			})
			.catch(() => {});
		await app.close();
		app = null;
	}
};
try {
	await launch();
	await call("draft", {
		id: 1,
		code: "# old draft\nclass Solution:\n    pass",
	});
	await call("solved", { id: 1, passed: true });
	await page.reload();
	await button("Hot100 练习").click();
	assert.equal(await page.locator(".topbar").count(), 0);
	assert.equal(await page.locator("iframe").count(), 0);
	for (const text of [
		"运行示例",
		"本地提交",
		"运行结果",
		"自定义输入",
		"提示 1",
		"Agent 讲解",
		"查看参考实现与复杂度",
		"本地运行",
		"WRITE · RUN · UNDERSTAND",
	])
		assert.ok(
			!(await page.locator(".coding-layout").innerText()).includes(text),
		);
	assert.ok(
		(await page.locator(".monaco-editor").innerText())
			.replaceAll("\u00a0", " ")
			.includes("old draft"),
	);
	assert.ok(
		(await page.locator(".legacy-result").innerText()).includes(
			"旧版本地判题结果",
		),
	);
	await button("保存本次记录").click();
	await alert("请先根据力扣").waitFor();
	assert.equal((await call("state")).codingAttempts.length, 0);
	await page.getByRole("radio", { name: "错误", exact: true }).check();
	await page
		.getByLabel("本次刷题心得（选填）")
		.fill("第一次错误\n边界判断遗漏");
	await button("保存本次记录").dblclick();
	await page
		.getByRole("heading", { name: "第 2 次刷题", exact: true })
		.waitFor();
	let state = await call("state");
	assert.equal(state.codingAttempts.length, 1);
	assert.equal(state.codingAttempts[0].number, 1);
	assert.ok(state.failed.includes(1));
	await page.getByRole("radio", { name: "正确", exact: true }).check();
	await button("保存本次记录").click();
	await page
		.getByRole("heading", { name: "第 3 次刷题", exact: true })
		.waitFor();
	assert.deepEqual(
		await page
			.locator(".problem-entry.selected .attempt-dot")
			.evaluateAll((es) => es.map((e) => e.getAttribute("aria-label"))),
		["第 1 次：错误", "第 2 次：正确"],
	);
	await button("编辑记录").first().click();
	await page.getByLabel("本次刷题心得（选填）").fill("修订心得\n仍保留编号");
	await button("保存修改").click();
	await page
		.getByRole("heading", { name: "第 3 次刷题", exact: true })
		.waitFor();
	state = await call("state");
	assert.equal(state.codingAttempts.length, 2);
	assert.equal(state.codingAttempts[0].number, 1);
	assert.equal(state.codingAttempts[0].notes, "修订心得\n仍保留编号");
	const code = "import sys\nanswer = [0, 1]\n# 中文草稿 preserved";
	await enterCode(code);
	await pick(49);
	await pick(1);
	await page
		.locator(".monaco-editor .view-lines")
		.filter({ hasText: "中文草稿" })
		.waitFor();
	await button("企业岗位").click();
	await button("Hot100 练习").click();
	await page
		.locator(".monaco-editor .view-lines")
		.filter({ hasText: "中文草稿" })
		.waitFor();
	await button("力扣原题 ↗").click();
	await alert("代码已复制").waitFor();
	assert.equal(
		await app.evaluate(({ clipboard }) => clipboard.readText()),
		code,
	);
	assert.deepEqual(await app.evaluate(() => globalThis.codingOpened), [
		"https://leetcode.cn/problems/two-sum/description/",
	]);
	assert.equal((await call("state")).drafts[1], code);
	await app.evaluate(({ clipboard }) => {
		clipboard.writeText = async () => {
			throw Error("simulated clipboard failure");
		};
	});
	await button("力扣原题 ↗").click();
	await alert("复制失败").waitFor();
	assert.equal((await app.evaluate(() => globalThis.codingOpened)).length, 1);
	await app.evaluate(({ clipboard, shell }) => {
		clipboard.writeText = globalThis.originalWrite;
		shell.openExternal = async () => {
			throw Error("simulated browser failure");
		};
	});
	await button("力扣原题 ↗").click();
	await alert("打开力扣失败").waitFor();
	await app.evaluate(({ shell }) => {
		shell.openExternal = async (url) => {
			globalThis.codingOpened.push(url);
		};
	});
	await button("力扣原题 ↗").click();
	await alert("代码已复制").waitFor();
	await assert.rejects(() =>
		call("copyCodeAndOpenProblem", { id: 999999, code: "x" }),
	);
	evidence.clipboardAndDerivedURL = true;
	evidence.failureAndRetry = true;
	evidence.oldDraftPreserved = true;
	evidence.pageSwitchPreserved = true;
	await pick(49);
	await page.getByRole("radio", { name: "错误", exact: true }).check();
	await page.getByLabel("本次刷题心得（选填）").fill("保存失败也应保留");
	const lock = new DatabaseSync(join(data, "picareer.sqlite"));
	lock.exec("BEGIN IMMEDIATE");
	try {
		await button("保存本次记录").click();
		await alert("保存失败，输入已保留").waitFor();
		assert.equal(
			await page.getByLabel("本次刷题心得（选填）").inputValue(),
			"保存失败也应保留",
		);
	} finally {
		lock.exec("ROLLBACK");
		lock.close();
	}
	await button("保存本次记录").click();
	await page
		.getByRole("heading", { name: "第 2 次刷题", exact: true })
		.waitFor();
	assert.equal(
		(await call("state")).codingAttempts.find((a) => a.problemId === 49).number,
		1,
	);
	await pick(1);
	const draftLock = new DatabaseSync(join(data, "picareer.sqlite"));
	draftLock.exec("BEGIN IMMEDIATE");
	try {
		await enterCode(code + "\n# retry saved");
		await page.getByRole("status").filter({ hasText: "保存失败" }).waitFor();
	} finally {
		draftLock.exec("ROLLBACK");
		draftLock.close();
	}
	await button("重试保存").click();
	await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
	assert.equal((await call("state")).drafts[1], code + "\n# retry saved");
	evidence.attemptSaveRecovery = true;
	evidence.draftSaveRecovery = true;
	evidence.independentAttemptsAndEdits = true;
	for (const p of official) {
		await pick(p.id);
		assert.ok(
			await page.locator(".official-description").evaluate((e, html) => {
				const expected = document.createElement("div");
				expected.innerHTML = html;
				return e.innerHTML === expected.innerHTML;
			}, p.descriptionHtml),
		);
		for (const image of await page.locator(".official-description img").all()) {
			await image.evaluate((img) => img.decode());
			assert.ok(await image.evaluate((img) => img.naturalWidth > 0));
		}
	}
	assert.equal(await page.locator("iframe").count(), 0);
	assert.ok(
		!(
			await page.evaluate(() =>
				performance.getEntriesByType("resource").map((r) => r.name),
			)
		).some((u) => /practice:|pyodide|\.wasm/.test(u)),
	);
	evidence.all100RenderedOffline = true;
	evidence.threeImagesRendered = true;
	evidence.noRunnerLoaded = true;
	await pick(1);
	await page.locator(".main").evaluate((e) => e.scrollTo(0, 0));
	await page.screenshot({ path: join(out, "coding-top.png") });
	await page.locator(".attempt-records").scrollIntoViewIfNeeded();
	await page.screenshot({ path: join(out, "coding-records.png") });
	const geometry = await page.locator(".coding-layout").evaluate((e) => {
		const r = e.getBoundingClientRect();
		return {
			width: r.width,
			viewport: innerWidth,
			scroll: document.documentElement.scrollWidth,
		};
	});
	assert.ok(geometry.scroll <= geometry.viewport + 1);
	evidence.geometry = geometry;
	const cardPadding = await page
		.locator(".problem-detail")
		.evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft));
	assert.ok(cardPadding >= 20);
	evidence.cardPadding = cardPadding;
	for (let i = 0; i < 20; i++)
		await call("saveCodingAttempt", {
			id: crypto.randomUUID(),
			problemId: 49,
			mode: "create",
			correct: false,
			notes: "横向滚动验收",
		});
	await page.reload();
	await button("Hot100 练习").click();
	await pick(49);
	const dotScroll = await page
		.locator(".problem-entry.selected .attempt-dots")
		.evaluate((e) => {
			e.scrollLeft = e.scrollWidth;
			return {
				count: e.children.length,
				overflow: e.scrollWidth > e.clientWidth,
				scrollLeft: e.scrollLeft,
			};
		});
	assert.equal(dotScroll.count, 21);
	assert.ok(dotScroll.overflow && dotScroll.scrollLeft > 0);
	evidence.manyDotsScrollable = true;
	state = await call("state");
	const drafts = { ...state.drafts },
		attempts = state.codingAttempts;
	await close();
	await launch();
	const restored = await call("state");
	assert.deepEqual(restored.codingAttempts, attempts);
	assert.deepEqual(restored.drafts, drafts);
	assert.ok(restored.solved.includes(1));
	assert.ok(restored.failed.includes(49));
	evidence.restartPreserved = true;
	if (process.env.PICAREER_REAL_OPEN === "1") {
		await button("Hot100 练习").click();
		await app.evaluate(({ shell }) => {
			shell.openExternal = globalThis.originalOpen;
		});
		await button("力扣原题 ↗").click();
		await alert("代码已复制").waitFor();
		assert.equal(
			await app.evaluate(({ clipboard }) => clipboard.readText()),
			drafts[1],
		);
		evidence.realSystemBrowserLaunch = true;
	}

	assert.deepEqual(errors, []);
	evidence.passed = true;
	evidence.errors = errors;
	console.log(JSON.stringify(evidence));
} catch (e) {
	if (page) {
		console.error((await page.locator("body").innerText()).slice(-2200));
		await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
	}
	throw e;
} finally {
	writeFileSync(
		join(out, "result.json"),
		JSON.stringify({ ...evidence, at: new Date().toISOString() }, null, 2),
	);
	await close();
}

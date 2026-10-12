import { _electron as electron } from "playwright";
import { resolve, join } from "node:path";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, ".test-data"), { recursive: true });
const data = mkdtempSync(join(root, ".test-data", "runner-"));
const problem = JSON.parse(
	readFileSync(join(root, "content/problems.json"), "utf8"),
)[0];
const app = await electron.launch({
	executablePath:
		process.env.PICAREER_EXE ??
		join(root, "node_modules/electron/dist/electron.exe"),
	args: process.env.PICAREER_EXE ? [] : [root],
	env: { ...process.env, PICAREER_TEST_DATA: data },
	timeout: 60000,
});
try {
	const page = await app.firstWindow();
	await page
		.getByRole("heading", { name: "PiCareer工作台" })
		.waitFor({ timeout: 60000 });
	await page.getByRole("button", { name: "Hot100 练习", exact: true }).click();
	const frame = page.frame({ url: "practice://runner/" });
	await frame.waitForLoadState();
	assert.equal(await frame.evaluate(() => typeof window.picareer), "undefined");
	const run = (code) =>
		page.evaluate(
			({ problem, code }) =>
				new Promise((resolve) => {
					const iframe = document.querySelector("iframe"),
						id = crypto.randomUUID();
					const handler = (e) => {
						if (
							e.source === iframe.contentWindow &&
							e.data?.type === "judge" &&
							e.data.id === id
						) {
							window.removeEventListener("message", handler);
							resolve(e.data);
						}
					};
					window.addEventListener("message", handler);
					iframe.contentWindow.postMessage(
						{ type: "run", id, problem, code, cases: problem.cases },
						"practice://runner",
					);
				}),
			{ problem, code },
		);
	let r = await run("while True: pass");
	assert.match(r.error, /超过8秒/);
	r = await run('print("x"*21000)');
	assert.ok(r.result.results.every((x) => /输出超过/.test(x.error)));
	r = await run('raise ValueError("test failure")');
	assert.match(r.result.results[0].error, /test failure/);
	r = await run(problem.solution);
	assert.equal(r.result.passed, true);
	assert.equal(await page.evaluate(() => typeof require), "undefined");
	const report = {
		passed: true,
		timeoutTermination: true,
		outputLimit: true,
		exception: true,
		recovery: true,
		noElectronBridgeInPractice: true,
	};
	writeFileSync(join(data, "result.json"), JSON.stringify(report, null, 2));
	console.log(report);
} finally {
	await app.close();
}

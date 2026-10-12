// Explicit opt-in. Uses existing account for evidence extraction, without creating learning/chat records.
import { _electron as electron } from "playwright";
import { join, resolve } from "node:path";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
if (!process.argv.includes("--real-account"))
	throw new Error("Requires --real-account");
const root = resolve(import.meta.dirname, ".."),
	version = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	).version;
const data = join(process.env.APPDATA, "PiCareer"),
	dbFile = join(data, "picareer.sqlite");
mkdirSync(join(data, "backups"), { recursive: true });
copyFileSync(
	dbFile,
	join(data, `backups/pre-${version}-jobs-${Date.now()}.sqlite`),
);
const rows = () => {
	const db = new DatabaseSync(dbFile, { readOnly: true });
	try {
		return db
			.prepare(
				"SELECT kind,id,value FROM records WHERE kind != 'secrets' ORDER BY kind,id",
			)
			.all();
	} finally {
		db.close();
	}
};
const before = rows();
const evidence = {
	version,
	packaged: !!process.env.PICAREER_EXE,
	realAccount: true,
	realNetwork: true,
	cases: [],
	passed: false,
};
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
	const call = (method, input = null) =>
		page.evaluate(({ method, input }) => window.picareer.call(method, input), {
			method,
			input,
		});
	assert.equal((await call("state")).settings.hasSearchKey, false);
	assert.match(await call("testModel"), /连接成功/);
	evidence.realModelConnection = true;
	page.on("console", (m) => {
		if (m.text().startsWith("JOB_CHECK")) console.log(m.text());
	});
	await page.evaluate(() =>
		window.picareer.onEvent((e) => {
			if (e.type === "jobProgress") console.log("JOB_CHECK " + e.stage);
		}),
	);
	for (const company of ["华为", "拓维信息"]) {
		const result = await call("jobs", {
			city: "长沙",
			company,
			role: "Agent 开发工程师",
			requestId: crypto.randomUUID(),
		});
		evidence.cases.push(result);
		console.log(
			JSON.stringify({
				company,
				matched: result.matched.length,
				related: result.related.length,
				status: result.status,
				warnings: result.warnings,
			}),
		);
		assert.ok(
			result.matched.every(
				(j) =>
					j.verification === "verified" &&
					Object.values(j.match).every(
						(s) => s === "matched" || s === "unused",
					),
			),
		);
		assert.ok(
			[...result.matched, ...result.related].every(
				(j) => !/百科|旅游攻略/.test(j.title),
			),
		);
		if (company === "拓维信息") {
			assert.ok(
				result.matched.length > 0,
				"Real positive recruitment result required",
			);
			const prepared = await call("prepareJobJD", { job: result.matched[0] });
			evidence.prepared = prepared;
			assert.equal(prepared.status, "ready");
			assert.match(prepared.text, /Agent|智能体/i);
		}
	}
	assert.deepEqual(rows(), before);
	evidence.userRecordsPreserved = true;
	evidence.passed = true;
} finally {
	writeFileSync(
		join(
			root,
			`docs/evidence/live-jobs-${version}-${process.env.PICAREER_EXE ? "packaged" : "dev"}.json`,
		),
		JSON.stringify(evidence, null, 2),
	);
	await app.close();
}

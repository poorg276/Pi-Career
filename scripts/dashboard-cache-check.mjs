import { _electron as electron } from "playwright";
import { resolve, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, ".."),
	version = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	).version;
const data = resolve(
	process.env.DASHBOARD_DATA ?? join(root, ".test-data/dashboard-dev-1.25"),
);
const prior = JSON.parse(readFileSync(join(data, "real-news.json"), "utf8"));
const app = await electron.launch({
	executablePath:
		process.env.PICAREER_EXE ??
		join(root, "node_modules/electron/dist/electron.exe"),
	args: process.env.PICAREER_EXE ? [] : [root],
	env: {
		...process.env,
		PICAREER_TEST_DATA: data,
		PICAREER_DASHBOARD_AUTOSTART: "0",
	},
	timeout: 60000,
});
try {
	const page = await app.firstWindow();
	await page
		.getByRole("heading", { name: "PiCareer工作台", exact: true })
		.waitFor({ timeout: 60000 });
	const state = await page.evaluate(() =>
		window.picareer.call("dashboard", null),
	);
	assert.equal(state.status, "ready");
	assert.deepEqual(
		state.news.map((n) => n.id),
		prior.news.map((n) => n.id),
	);
	assert.equal(state.requestId, undefined);
	assert.equal(await page.locator(".dashboard-news").count(), 3);
	const knowledge = state.knowledge.id;
	assert.equal(
		knowledge,
		(await page.evaluate(() => window.picareer.call("dashboard", null)))
			.knowledge.id,
	);
	await app.evaluate(({ session }) => {
		globalThis.__dashboardProxy = session.defaultSession.resolveProxy.bind(
			session.defaultSession,
		);
		session.defaultSession.resolveProxy = async () => "PROXY 127.0.0.1:1";
	});
	await page.getByRole("button", { name: "刷新", exact: true }).click();
	let failed;
	const end = Date.now() + 100000;
	do {
		failed = await page.evaluate(() => window.picareer.call("dashboard", null));
		if (failed.status !== "loading") break;
		await page.waitForTimeout(500);
	} while (Date.now() < end);
	assert.equal(failed.status, "failed");
	assert.deepEqual(
		failed.news.map((n) => n.id),
		state.news.map((n) => n.id),
	);
	assert.equal(failed.updatedAt, state.updatedAt);
	assert.ok(failed.warnings.some((w) => /网络|代理|联网/.test(w)));
	assert.equal(await page.locator(".dashboard-news").count(), 3);
	assert.ok(
		await page
			.getByText("本次更新失败，已保留上次缓存。", { exact: true })
			.count(),
	);
	await app.evaluate(({ session }) => {
		session.defaultSession.resolveProxy = globalThis.__dashboardProxy;
	});
	const retried = await page.evaluate(() =>
		window.picareer.call("refreshDashboard", null),
	);
	assert.equal(retried.status, "ready");
	assert.equal(retried.news.length, 3);
	assert.notEqual(retried.requestId, failed.requestId);
	writeFileSync(
		join(root, `docs/evidence/dashboard-cache-${version}.json`),
		JSON.stringify(
			{
				passed: true,
				restartCache: true,
				dailyStable: true,
				proxyFailurePreservesCache: true,
				doesNotBypassProxy: true,
				retryAfterCleanup: true,
				knowledgeId: knowledge,
				at: new Date().toISOString(),
			},
			null,
			2,
		),
	);
	console.log(
		"PASS: cache and daily knowledge restore, proxy failure keeps three prior news entries, retry succeeds.",
	);
} finally {
	await app.close();
}

import { _electron as electron } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, ".."),
	version = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	).version;
const scale = process.env.PICAREER_SCALE ?? "1.25",
	packaged = process.env.PICAREER_PACKAGED === "1";
const data = resolve(
	process.env.DASHBOARD_DATA ??
		join(
			root,
			`.test-data/dashboard-${packaged ? "packaged" : "dev"}-${scale}`,
		),
);
mkdirSync(data, { recursive: true });
const errors = [];
const app = await electron.launch({
	executablePath: packaged
		? join(root, "release/win-unpacked/PiCareer.exe")
		: join(root, "node_modules/electron/dist/electron.exe"),
	args: [...(packaged ? [] : [root]), `--force-device-scale-factor=${scale}`],
	env: {
		...process.env,
		PICAREER_TEST_DATA: data,
		PICAREER_DASHBOARD_AUTOSTART: "1",
	},
	timeout: 60000,
});
try {
	const page = await app.firstWindow();
	page.on("pageerror", (e) => errors.push(e.message));
	await app.evaluate(({ BrowserWindow }) => {
		const w = BrowserWindow.getAllWindows()[0];
		w.setSize(1060, 760);
		w.showInactive();
	});
	await page
		.getByRole("heading", { name: "PiCareer工作台", exact: true })
		.waitFor({ timeout: 60000 });
	assert.equal(await page.locator(".hero").count(), 0);
	assert.equal(await page.locator(".page-heading").count(), 0);
	assert.equal(await page.locator(".topbar").count(), 1);
	assert.equal(await page.locator(".recruitment-link").count(), 16);
	// Both state queries and page navigation must observe the same startup attempt.
	const initial = await page.evaluate(() =>
		window.picareer.call("dashboard", null),
	);
	await page.getByRole("button", { name: "企业岗位", exact: true }).click();
	await page.getByRole("button", { name: "工作台", exact: true }).click();
	assert.equal(
		(await page.evaluate(() => window.picareer.call("dashboard", null)))
			.requestId,
		initial.requestId,
	);
	let ready;
	const deadline = Date.now() + 100000;
	do {
		ready = await page.evaluate(() => window.picareer.call("dashboard", null));
		if (ready.status !== "loading") break;
		await page.waitForTimeout(1000);
	} while (Date.now() < deadline);
	writeFileSync(join(data, "real-news.json"), JSON.stringify(ready, null, 2));
	assert.equal(ready.news.length, 3, JSON.stringify(ready.warnings));
	assert.equal(new Set(ready.news.map((n) => n.url)).size, 3);
	assert.ok(
		ready.news.every(
			(n) =>
				n.evidence &&
				n.dateEvidence &&
				Date.now() - Date.parse(n.publishedAt) < 90 * 86400000,
		),
	);
	assert.equal(await page.locator(".dashboard-news").count(), 3);
	const id = ready.requestId;
	await page.getByRole("button", { name: "Hot100 练习", exact: true }).click();
	await page.getByRole("button", { name: "工作台", exact: true }).click();
	assert.equal(
		(await page.evaluate(() => window.picareer.call("dashboard", null)))
			.requestId,
		id,
	);
	const old = ready.knowledge.id;
	await page.getByRole("button", { name: "换一条", exact: true }).click();
	await page.waitForTimeout(250);
	const selected = (
		await page.evaluate(() => window.picareer.call("dashboard", null))
	).knowledge.id;
	const layout = await page.evaluate(() => ({
		overflow: document.documentElement.scrollWidth > innerWidth,
		columns: getComputedStyle(
			document.querySelector(".dashboard-content-grid"),
		).gridTemplateColumns.split(" ").length,
		minSize: Math.min(
			...[
				...document.querySelectorAll(
					".dashboard-panels p,.dashboard-panels a,.dashboard-panels span,.dashboard-panels button",
				),
			].map((e) => parseFloat(getComputedStyle(e).fontSize)),
		),
		small: [
			...document.querySelectorAll(
				".dashboard-panels p,.dashboard-panels a,.dashboard-panels span,.dashboard-panels button",
			),
		]
			.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 13)
			.map((e) => e.outerHTML.slice(0, 160)),
	}));
	assert.equal(layout.overflow, false);
	assert.equal(layout.columns, 1);
	assert.ok(layout.minSize >= 13, JSON.stringify(layout));
	const links = await page
		.locator(".recruitment-link a")
		.evaluateAll((as) => as.map((a) => a.href));
	assert.equal(new Set(links).size, 16);
	// Restricted external link bridge, with the OS opener replaced only for this assertion.
	await app.evaluate(({ shell }) => {
		globalThis.__opened = [];
		shell.openExternal = async (url) => {
			globalThis.__opened.push(url);
		};
	});
	await page.locator(".recruitment-link a").first().click();
	assert.equal(await app.evaluate(() => globalThis.__opened[0]), links[0]);
	await page.screenshot({
		path: join(root, `docs/screenshots/dashboard-${version}-${scale}.png`),
		fullPage: false,
	});
	const evidence = {
		version,
		packaged,
		scale,
		passed: true,
		news: ready.news,
		requestId: id,
		knowledgeChanged: true,
		knowledgeId: selected,
		layout,
		links,
		errors,
		at: new Date().toISOString(),
	};
	assert.deepEqual(errors, []);
	writeFileSync(
		join(
			root,
			`docs/evidence/dashboard-${packaged ? "packaged" : "dev"}-${version}-${scale}.json`,
		),
		JSON.stringify(evidence, null, 2),
	);
	console.log(
		JSON.stringify(
			{
				passed: true,
				news: ready.news.map((n) => ({
					title: n.title,
					url: n.url,
					published: n.publishedAt,
				})),
				warnings: ready.warnings,
				layout,
			},
			null,
			2,
		),
	);
} finally {
	await app.close();
}

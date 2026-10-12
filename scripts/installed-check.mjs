// Startup acceptance preserving all existing non-dashboard user records.
import { _electron as electron } from "playwright";
import { join, resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(
	readFileSync(join(root, "package.json"), "utf8"),
).version;
const executable = join(
	process.env.LOCALAPPDATA,
	"Programs/PiCareer/PiCareer.exe",
);
const data = join(process.env.APPDATA, "PiCareer");
const rows = () => {
	const db = new DatabaseSync(join(data, "picareer.sqlite"), {
		readOnly: true,
	});
	try {
		return db
			.prepare("SELECT kind,id,value FROM records WHERE kind!='dashboard' ORDER BY kind,id")
			.all();
	} finally {
		db.close();
	}
};
const before = rows(),
	errors = [];
const localDay = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const dashboardBefore = (() => {
	const db = new DatabaseSync(join(data,"picareer.sqlite"),{readOnly:true});
	try {
		const read = id => { const row=db.prepare("SELECT value FROM records WHERE kind='dashboard' AND id=?").get(id); return row?JSON.parse(row.value):undefined; };
		return {news:read("news"),day:read("refresh-day")};
	} finally {db.close();}
})();
const skipDaily = dashboardBefore.day?.date===localDay(new Date()) || (!dashboardBefore.day && dashboardBefore.news?.attemptedAt && Number.isFinite(Date.parse(dashboardBefore.news.attemptedAt)) && localDay(new Date(dashboardBefore.news.attemptedAt))===localDay(new Date()));
const launchEnv = { ...process.env };
delete launchEnv.PICAREER_TEST_DATA;
delete launchEnv.PICAREER_DASHBOARD_AUTOSTART;
const app = await electron.launch({
	executablePath: executable,
	args: [],
	env: launchEnv,
	timeout: 60000,
});
try {
	assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
	// A hidden installed window may suspend its compositor; make it drawable for capture.
	await app.evaluate(({ BrowserWindow }) => {
		const win = BrowserWindow.getAllWindows()[0];
		win.showInactive();
	});
	const page = await app.firstWindow();
	page.on("pageerror", (e) => errors.push(e.message));
	await page
		.getByRole("heading", { name: "PiCareer工作台" })
		.waitFor({ timeout: 60000 });
	if(["0.1.12","0.1.13"].includes(version)) {
		assert.equal(await page.title(),"PiCareer·辅助求职Agent");
		assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getTitle()),"PiCareer·辅助求职Agent");
		assert.deepEqual(await page.locator(".feature h3").allTextContents(),["模拟面试","企业岗位检索","LeetCode Hot100","八股知识背诵","简历优化"]);
	}
	let dashboard;
	const end = Date.now()+100000;
	do {
		dashboard = await page.evaluate(()=>window.picareer.call("dashboard",null));
		if(dashboard.status!=="loading") break;
		await page.waitForTimeout(500);
	} while(Date.now()<end);
	assert.equal(dashboard.news.length,3,JSON.stringify(dashboard.warnings));
	if(["0.1.12","0.1.13"].includes(version) && skipDaily) {
		assert.equal(dashboard.attemptedAt,dashboardBefore.news?.attemptedAt);
		assert.equal(dashboard.requestId,undefined);
	}
	await new Promise((done, reject) => {
		const second = spawn(executable, [], {env: launchEnv, windowsHide: true, stdio: "ignore"});
		const timer = setTimeout(()=>{ reject(new Error("Second instance did not exit")); },10000);
		second.once("error",error=>{clearTimeout(timer);reject(error);});
		second.once("exit",code=>{clearTimeout(timer);code===0?done():reject(new Error(`Second instance exit ${code}`));});
	});
	await page.waitForTimeout(500);
	const afterWake = await page.evaluate(()=>window.picareer.call("dashboard",null));
	assert.equal(afterWake.requestId,dashboard.requestId);
	assert.equal(afterWake.attemptedAt,dashboard.attemptedAt);
	assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
	assert.equal(await page.locator(".recruitment-link").count(),16);
	assert.equal(await page.locator(".hero").count(),0);
	await page.screenshot({path:join(root,`docs/screenshots/installed-dashboard-${version}.png`)});
	const state = await page.evaluate(() => window.picareer.call("state", null));
	const catalog = await page.evaluate(() =>
		window.picareer.call("models", null),
	);
	assert.equal(state.settings.provider, "openai-codex");
	assert.equal(
		catalog.providers.find((p) => p.id === state.settings.provider)
			?.credentialType,
		"oauth",
	);
	assert.ok(
		catalog.models.some(
			(m) =>
				m.id === state.settings.model && m.provider === state.settings.provider,
		),
	);
	const checkChat = state.chats.find((c) =>
		c.turns?.some((t) => t.status === "complete" && t.context?.tokens > 0),
	);
	await page
		.getByRole("button", { name: /通用 Agent/ })
		.first()
		.click();
	if (checkChat)
		await page
			.locator(".chat-history-row")
			.filter({ hasText: checkChat.title })
			.first()
			.click();
	assert.equal(await page.locator(".topbar").count(), 0);
	assert.equal(
		await page.locator(".composer-model").textContent(),
		state.settings.model,
	);
	if (checkChat)
		assert.ok(await page.locator(".chat-turn-end.complete").count());
	await page.screenshot({
		path: join(root, `docs/screenshots/installed-${version}.png`),
	});
	await page.getByRole("button", { name: "企业岗位", exact: true }).click();
	assert.equal(await page.locator(".topbar").count(), 0);
	assert.equal(
		await page.locator(".jobs-model").textContent(),
		state.settings.model,
	);
	await page.screenshot({
		path: join(root, `docs/screenshots/installed-jobs-${version}.png`),
	});
	if (["0.1.8", "0.1.9", "0.1.10", "0.1.11", "0.1.12", "0.1.13"].includes(version)) {
		await page
			.getByRole("button", { name: "＋ 手动录入目标岗位", exact: true })
			.first()
			.click();
		await page
			.getByRole("dialog", { name: "手动录入目标岗位", exact: true })
			.waitFor();
		await page.getByRole("button", { name: "取消", exact: true }).click();
	}
	await page.getByRole("button", { name: "Hot100 练习", exact: true }).click();
	assert.equal(await page.locator(".topbar").count(), 0);
	assert.equal(await page.locator("iframe").count(), 0);
	assert.ok(
		await page
			.locator(".problem-detail")
			.evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft) >= 20),
	);
	assert.ok(
		(await page.locator(".official-description").textContent()).includes(
			"整数数组",
		),
	);
	assert.ok(
		await page
			.getByRole("button", { name: "保存本次记录", exact: true })
			.count(),
	);
	await page.screenshot({
		path: join(root, `docs/screenshots/installed-coding-${version}.png`),
	});
	await page.getByRole("button",{name:"简历优化",exact:true}).click();
	await page.getByRole("heading",{name:"简历优化",exact:true}).waitFor();
	assert.equal(await page.locator(".side-note").count(),0);
	if(version==="0.1.13") {
		const resume=page.locator(".resume-page:visible");
		assert.equal(await resume.locator(".resume-content").count(),0);
		const draftsBefore=await page.evaluate(()=>window.picareer.call("resumeList",null));
		await resume.getByRole("button",{name:/^完整简历/}).click();
		await resume.getByText("该功能还在开发中......",{exact:true}).waitFor();
		assert.deepEqual(await page.evaluate(()=>window.picareer.call("resumeList",null)),draftsBefore);
		await resume.getByRole("button",{name:"← 返回简历优化",exact:true}).click();
	}
	await page.screenshot({path:join(root,`docs/screenshots/installed-resume-${version}.png`)});
	assert.deepEqual(errors, []);
	assert.deepEqual(rows(), before);
	const result = {
		version,
		passed: true,
		existingOAuthRestored: true,
		model: state.settings.model,
		chatCount: state.chats.length,
		contextRestored: checkChat ? true : "no_previous_context_record",
		officialHot100Loaded: true,
		allRecordsUnchanged: true,
		dashboardDailyPolicy: true,
		sameDayStartupSkipped: Boolean(skipDaily),
		secondInstanceDidNotRefresh: true,
		dashboardWarnings: dashboard.warnings,
		threeVerifiedNews: dashboard.news.map(({title,url,publishedAt,summary})=>({title,url,publishedAt,summary})),
		errors,
		at: new Date().toISOString(),
	};
	writeFileSync(
		join(root, `docs/evidence/installed-startup-${version}.json`),
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result));
} finally {
	await app.close();
}

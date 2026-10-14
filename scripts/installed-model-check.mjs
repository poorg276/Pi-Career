// Check the installed application with its existing account, without creating
// chats or modifying resume, study, coding, favorite or settings records.
import { _electron as electron } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, ".."), version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const rows = () => {
	const db = new DatabaseSync(join(process.env.APPDATA, "PiCareer/picareer.sqlite"), { readOnly: true });
	try { return db.prepare("SELECT kind,id,value FROM records WHERE kind NOT IN ('secrets','secret-index','auth-diagnostic','dashboard') ORDER BY kind,id").all(); }
	finally { db.close(); }
};
const before = rows(), env = { ...process.env, PICAREER_DASHBOARD_AUTOSTART: "0" };
delete env.PICAREER_TEST_DATA;
let app;
const result = { version, passed: false };
try {
	app = await electron.launch({ executablePath: join(process.env.LOCALAPPDATA, "Programs/PiCareer/PiCareer.exe"), args: [], env, timeout: 60000 });
	const page = await app.firstWindow();
	await page.getByRole("heading", { name: "PiCareer工作台", exact: true }).waitFor({ timeout: 60000 });
	assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
	const reply = await page.evaluate(() => window.picareer.call("testModel", null));
	assert.match(reply, /连接成功/);
	assert.deepEqual(rows(), before);
	Object.assign(result, { passed: true, existingAccountConnection: true, learningAndSettingsPreserved: true, at: new Date().toISOString() });
} catch (error) { result.error = error.message; throw error; }
finally {
	await app?.close().catch(() => {});
	writeFileSync(join(root, `docs/evidence/installed-model-${version}.json`), JSON.stringify(result, null, 2) + "\n");
	console.log(JSON.stringify(result));
}

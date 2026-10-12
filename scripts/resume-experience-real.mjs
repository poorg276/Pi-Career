import { _electron as electron } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
	copyFileSync,
	existsSync,
	unlinkSync,
	readdirSync,
} from "node:fs";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, ".."),
	version = JSON.parse(readFileSync(join(root, "package.json"))).version;
const out = join(
	root,
	`.test-data/resume-experience-real-${version}-${process.env.PICAREER_EXE ? "packaged" : "dev"}`,
);
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(out, "isolated-"));
const from = new DatabaseSync(
		join(process.env.APPDATA, "PiCareer/picareer.sqlite"),
		{ readOnly: true },
	),
	to = new DatabaseSync(join(data, "picareer.sqlite"));
to.exec(
	"CREATE TABLE records(kind TEXT,id TEXT,value TEXT,updated TEXT,PRIMARY KEY(kind,id));PRAGMA user_version=1",
);
for (const r of from
	.prepare(
		"SELECT * FROM records WHERE (kind='config' AND id='settings') OR (kind IN ('secrets','secret-index') AND id='openai-codex')",
	)
	.all())
	to.prepare("INSERT INTO records VALUES(?,?,?,?)").run(
		r.kind,
		r.id,
		r.value,
		r.updated,
	);
from.close();
to.close();
const localState = join(process.env.APPDATA, "PiCareer/Local State");
if (existsSync(localState)) copyFileSync(localState, join(data, "Local State"));
let app, page;
const result = { version, passed: false, stages: [] };
const edit = (d) => ({
	...d,
	selections: Object.fromEntries(
		d.materials.flatMap((m) => m.units.map((u) => [u.id, u.selected])),
	),
});
try {
	app = await electron.launch({
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
	page = await app.firstWindow();
	await page
		.getByRole("heading", { name: "PiCareer工作台" })
		.waitFor({ timeout: 60000 });
	const call = (method, input = null) =>
		page.evaluate(({ method, input }) => window.picareer.call(method, input), {
			method,
			input,
		});
	const generate = async (id) => {
		const before = (await call("resumeList")).find((d) => d.id === id);
		let value = await call("generateResumeExperience", { id });
		if (
			value.run.status === "failed" &&
			/AUTH_NETWORK_ERROR|网络|每项经历需|模型生成格式|模型经历结构|材料引用无法核对/.test(
				value.run.stage,
			)
		) {
			assert.deepEqual(value.experiences, before.experiences);
			result.stages.push(
				"guarded_failure_preserved_previous_then_manual_retry",
			);
			value = await call("generateResumeExperience", { id });
		}
		return value;
	};
	const state = await call("state"),
		catalog = await call("models"),
		model = catalog.models.find(
			(m) =>
				m.provider === state.settings.provider && m.id === state.settings.model,
		);
	result.model = state.settings.model;
	result.vision = !!model?.supportsImages;
	let d = await call("createResume", { mode: "experience" });
	let e = edit(d);
	e.overview =
		"这是合成测试项目。本人独立编写 Python 资料检索函数，实现按关键词筛选文档和空结果状态处理，编写单元测试检查 found/not_found 分支。没有团队其他贡献；项目时间未知，性能和准确率未测量，没有获奖或商业部署。";
	d = await call("saveResume", e);
	d = await generate(d.id);
	assert.equal(d.run.status, "complete", d.run.stage);
	assert.ok(d.experiences.every((x) => x.kind === "project"));
	assert.ok(
		d.experiences.every((x) => x.bullets.length >= 2 && x.bullets.length <= 4),
	);
	result.stages.push("pure_text_without_JD");
	writeFileSync(join(out, "text-review.json"), JSON.stringify(d, null, 2));
	const material = async (purpose, name) => {
		await app.evaluate(
			({ dialog }, path) => {
				dialog.showOpenDialog = async () => ({
					canceled: false,
					filePaths: [path],
				});
			},
			join(root, ".test-data/resume-fixtures", name),
		);
		d = await call("chooseResumeMaterials", {
			id: d.id,
			purpose,
			directory: name === "中文 Agent 项目",
		});
		assert.equal(d.run.status, "complete", d.run.stage);
	};
	await material("project", "中文 Agent 项目");
	await material("research", "研究记录.pdf");
	if (result.vision) await material("research", "扫描材料.pdf");
	e = edit(d);
	e.jd = "Agent 应用开发：Python 文档检索、工具流程设计、错误处理和单元测试。";
	e.overview =
		"这都是合成测试材料。中文 Agent 项目对应源码；本人独立编写 retrieve 和 agent 函数及 test_agent.py，负责关键词检索、found/not_found 状态包装与无结果测试，时间2026年6月至2026年8月。README 的工具路由指设计思路，当前代码没有外部工具执行，不宣称已有复杂 Agent 功能。研究记录.pdf及扫描材料.pdf是同一内部设计记录的两种版本；本人为记录撰写者/测试作者，负责检索与测试方法整理，该记录未投稿、未录用、未发表，不是专利，无专利申请或授权；不填写论文作者排序。全部没有实测性能增益和获奖。";
	d = await call("saveResume", e);
	d = await generate(d.id);
	if (
		d.run.status === "failed" &&
		d.inputIssues?.some((x) => /README|工具调用|工具路由|冲突/.test(x))
	) {
		assert.ok(d.experiences.length, "conflict must keep previous draft");
		result.stages.push("material_conflict_detected");
		e = edit(d);
		e.overview +=
			"针对材料差异补充：我明确确认 README 关于工具调用编排的描述不准确，是计划而非已实现内容；以实际源码为准，现阶段仅有关键词检索与结果状态包装。成稿不写外部工具执行、复杂编排或性能提升。";
		d = await call("saveResume", e);
		d = await generate(d.id);
	}
	if (
		d.run.status === "failed" &&
		/AUTH_NETWORK_ERROR|网络/.test(d.run.stage)
	) {
		result.stages.push("network_failure_kept_input_manual_retry");
		assert.ok(d.overview && d.materials.length);
		d = await generate(d.id);
	}
	assert.equal(d.run.status, "complete", d.run.stage);
	assert.ok(d.experiences.length);
	assert.ok(d.experienceSources.some((x) => x.origin === "material"));
	assert.ok(
		d.experiences.every((x) => x.bullets.length >= 2 && x.bullets.length <= 4),
	);
	assert.ok(!JSON.stringify(d.experiences).includes("%"));
	result.stages.push("mixed_project_research_with_JD");
	writeFileSync(join(out, "mixed-review.json"), JSON.stringify(d, null, 2));
	await call("copyResume", { id: d.id });
	const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
	assert.ok(!/factIds|unitId|证据说明/.test(clipboard));
	writeFileSync(join(out, "copy.txt"), clipboard);
	// A separate synthetic unpublished paper verifies the research category, without
	// turning the previous internal design record into a claimed publication.
	const paperPath = join(root, ".test-data/resume-fixtures/未投稿研究论文.txt");
	writeFileSync(
		paperPath,
		"未投稿论文草稿：检索证据约束下的智能体回答流程研究\n作者：测试作者（第一作者）、合作作者\n成果状态：论文草稿，未投稿、未录用、未发表；无专利\n第一作者工作：提出检索证据约束的回答流程，设计无证据时拒绝回答的策略，撰写方法与边界分析。合作作者仅参与讨论。\n方法：将检索、证据校验和回答阶段分开，分析关键词检索缺少语义匹配的问题。\n目前仅完成流程设计和理论分析，尚未开展性能实验，无已测量效果。\n",
	);
	d = await call("createResume", { mode: "experience" });
	await material("research", "未投稿研究论文.txt");
	e = edit(d);
	e.jd = "Agent/RAG 研究岗位：检索证据、可靠性与评测方法。";
	e.overview =
		"上传的未投稿研究论文.txt为合成测试论文草稿。本人为测试作者、第一作者，合作作者仅参与讨论。我提出检索证据约束的回答流程，设计无证据时拒答策略，完成方法和边界分析撰写；目前是理论设计，不宣称代码已实现该策略。论文未投稿、未录用、未发表，无专利申请或授权；项目时间未知，尚未进行实验，没有实测增益。";
	d = await call("saveResume", e);
	d = await generate(d.id);
	assert.equal(d.run.status, "complete", d.run.stage);
	assert.ok(d.experiences.some((x) => x.kind === "research"));
	assert.ok(
		d.experiences.every((x) => x.bullets.length >= 2 && x.bullets.length <= 4),
	);
	assert.match(JSON.stringify(d.experiences), /草稿|未投稿/);
	result.stages.push("unpublished_paper_research_category");
	writeFileSync(join(out, "paper-review.json"), JSON.stringify(d, null, 2));
	const previous = JSON.stringify(d.experiences);
	e = edit(d);
	e.overview =
		"上述源码和论文是团队材料，我个人参与情况、作者身份和成果状态还不明确。";
	d = await call("saveResume", e);
	d = await generate(d.id);
	assert.equal(d.run.status, "failed");
	assert.ok(d.inputIssues.length);
	assert.equal(JSON.stringify(d.experiences), previous);
	result.stages.push("missing_contribution_identity_gate");
	writeFileSync(
		join(out, "gate-review.json"),
		JSON.stringify(
			{ overview: d.overview, issues: d.inputIssues, run: d.run },
			null,
			2,
		),
	);
	result.passed = true;
} catch (e) {
	result.error = e.message;
	if (page)
		await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
	throw e;
} finally {
	await app?.close().catch(() => {});
	// Remove copied credentials from both the isolated store and automatic backups.
	for (const name of readdirSync(data).filter(
		(n) => n.endsWith(".sqlite") || n.endsWith(".backup"),
	)) {
		const path = join(data, name);
		try {
			const db = new DatabaseSync(path);
			db.exec(
				"DELETE FROM records WHERE kind IN ('secrets','secret-index');VACUUM",
			);
			db.close();
		} catch {}
	}
	if (existsSync(join(data, "Local State")))
		unlinkSync(join(data, "Local State"));
	writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	mkdtempSync,
	writeFileSync,
	mkdirSync,
	rmSync,
	readFileSync,
	existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/core/store.ts";
import {
	Resumes,
	assertGeneration,
	selectedUnits,
	normalizeTemplateProposal,
	originalQuote,
} from "../src/core/resume.ts";
import { resumeHTML, hasPlaceholders } from "../src/core/resume-export.ts";
import type { ResumeDraft, ResumeEdit } from "../src/shared/resume.ts";
import JSZip from "jszip";
function fixture(model: any = async () => "{}") {
	const root = mkdtempSync(join(tmpdir(), "picareer-resume-")),
		store = new Store(root),
		manager = new Resumes(store, root, model, () => {});
	return {
		root,
		store,
		manager,
		close: () => {
			store.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}
const edit = (d: ResumeDraft): ResumeEdit => ({
	...structuredClone(d),
	selections: Object.fromEntries(
		d.materials.flatMap((m) => m.units.map((u) => [u.id, u.selected])),
	),
});
const oneExperience = [
	{
		kind: "project",
		name: "检索项目",
		time: "",
		role: "开发者",
		bullets: [
			{ text: "实现检索函数并处理空结果。", factIds: ["overview"] },
			{ text: "编写单元测试验证检索结果。", factIds: ["overview"] },
		],
	},
];
test("writing defects get one bounded revision and independent recheck; missing personal facts do not", async () => {
	for (const needsInput of [false, true]) {
		let calls = 0;
		const s = fixture(async () => {
			calls++;
			return JSON.stringify(calls === 1 ? { issues: [], facts: [] } : calls === 2 || calls === 4 ? oneExperience : calls === 3 ? { valid: false, needsInput, issues: [needsInput ? "请说明本人贡献" : "合并重复表述"] } : { valid: true, needsInput: false, issues: [] });
		});
		try {
			let d = s.manager.create("experience");
			const e = edit(d); e.overview = "本人实现检索并编写单元测试";
			d = s.manager.save(e);
			d = await s.manager.generateExperience(d.id);
			assert.equal(calls, needsInput ? 3 : 5);
			assert.equal(d.run?.status, needsInput ? "failed" : "complete");
			assert.equal(d.inputIssues?.length, needsInput ? 1 : 0);
		} finally { s.close(); }
	}
});
test("citation whitespace normalization keeps the actual contiguous source span", () => {
	assert.equal(
		originalQuote("检索\n与工具   调用", "检索与工具调用"),
		"检索\n与工具   调用",
	);
	assert.equal(originalQuote("提升准确率", "提升召回率"), undefined);
	assert.equal(originalQuote("实际结果", "   "), undefined);
});
test("one bounded structural repair still requires evidence and independent review", async () => {
	let n = 0;
	const s = fixture(async () =>
		JSON.stringify(
			++n === 1
				? { issues: [], facts: [] }
				: n === 2
					? [{ ...oneExperience[0], bullets: [oneExperience[0].bullets[0]] }]
					: n === 3
						? oneExperience
						: { valid: true, issues: [] },
		),
	);
	try {
		let d = s.manager.create("experience");
		const e = edit(d);
		e.overview = "本人实现检索并编写单元测试";
		d = s.manager.save(e);
		d = await s.manager.generateExperience(d.id);
		assert.equal(d.run?.status, "complete");
		assert.equal(n, 4);
		assert.equal(d.experiences[0].bullets.length, 2);
	} finally {
		s.close();
	}
});
test("new experience pipeline ignores old unanswered questions and preserves versions, references and restart", async () => {
	let n = 0;
	const s = fixture(async () =>
		JSON.stringify(
			++n % 3 === 1
				? { issues: [], facts: [] }
				: n % 3 === 2
					? oneExperience
					: { valid: true, issues: [] },
		),
	);
	try {
		let d = s.manager.create("experience");
		let e = edit(d);
		e.overview =
			"本人独立实现检索函数及空结果处理，编写单元测试。时间未知，性能未测量。";
		d = s.manager.save(e);
		d.questions = [
			{ id: "old", question: "旧问题", answer: "", skipped: false },
		];
		s.manager.put(d);
		d = await s.manager.generateExperience(d.id);
		assert.equal(d.run?.status, "complete", d.run?.stage);
		assert.equal(d.experiences.length, 1);
		assert.equal(d.questions[0].answer, "");
		const previous = structuredClone(d.experiences);
		d = await s.manager.generateExperience(d.id);
		assert.equal(d.versions.length, 1);
		d = s.manager.restoreVersion(d.id, d.versions[0].at);
		assert.deepEqual(d.experiences, previous);
		assert.equal(d.experienceSources?.[0].origin, "overview");
		assert.equal(
			new Resumes(
				s.store,
				s.root,
				async () => "{}",
				() => {},
			).get(d.id).overview,
			e.overview,
		);
	} finally {
		s.close();
	}
});
test("legacy overview combines projects, research and answered supplements without altering full drafts", () => {
	const s = fixture();
	try {
		const d = s.manager.create("experience");
		delete d.overview;
		d.fields.projects = "项目原文";
		d.fields.research = "科研原文";
		d.questions = [
			{ id: "old", question: "本人贡献", answer: "负责测试", skipped: false },
		];
		s.store.put("resume", d.id, d);
		assert.match(
			s.manager.get(d.id).overview!,
			/项目原文[\s\S]*科研原文[\s\S]*负责测试/,
		);
		const full = s.manager.create("full");
		delete full.overview;
		s.store.put("resume", full.id, full);
		assert.equal(s.manager.get(full.id).overview, undefined);
	} finally {
		s.close();
	}
});
test("overview required; missing contribution, research identity/status and conflict pause before writing", async () => {
	for (const issue of [
		"请说明本人承担哪些工作及对应材料",
		"请说明论文作者身份和成果状态",
		"概述与材料的成果状态冲突，请核对",
	]) {
		let requests = 0;
		const s = fixture(async () => {
			requests++;
			return JSON.stringify({ issues: [issue], facts: [] });
		});
		try {
			let d = s.manager.create("experience");
			d = await s.manager.generateExperience(d.id);
			assert.equal(requests, 0);
			assert.equal(d.run?.status, "failed");
			let e = edit(d);
			e.overview = "介绍上传材料";
			d = s.manager.save(e);
			d.experiences = [{ ...oneExperience[0], id: "old", kind: "project" }];
			s.manager.put(d);
			d = await s.manager.generateExperience(d.id);
			assert.equal(requests, 1);
			assert.deepEqual(d.inputIssues, [issue]);
			assert.equal(d.experiences[0].id, "old");
		} finally {
			s.close();
		}
	}
});
test("invalid evidence, fabricated metrics and independent review failure retain last manuscript", async () => {
	for (const mode of ["quote", "metric", "review"]) {
		let n = 0;
		const s = fixture(async () => {
			n++;
			return JSON.stringify(
				n === 1
					? {
							issues: [],
							facts:
								mode === "quote"
									? [
											{
												text: "invented",
												evidence: [{ unitId: "unknown", quote: "invented" }],
											},
										]
									: [],
						}
					: n === 2
						? mode === "metric"
							? [
									{
										...oneExperience[0],
										bullets: [
											{ text: "效果提升99%", factIds: ["overview"] },
											oneExperience[0].bullets[1],
										],
									},
								]
							: oneExperience
						: { valid: false, issues: ["归属不清，请补充本人贡献"] },
			);
		});
		try {
			let d = s.manager.create("experience");
			let e = edit(d);
			e.overview = "本人实现检索和测试，时间未知，指标未测量。";
			d = s.manager.save(e);
			d.experiences = [{ ...oneExperience[0], id: "old", kind: "project" }];
			s.manager.put(d);
			d = await s.manager.generateExperience(d.id);
			assert.equal(d.run?.status, "failed");
			assert.equal(d.experiences[0].id, "old");
			assert.equal(d.versions.length, 0);
		} finally {
			s.close();
		}
	}
});
test("material summary cannot introduce metrics absent from quoted evidence", async () => {
	const s = fixture(async () =>
		JSON.stringify({
			issues: [],
			facts: [
				{
					text: "准确率99%",
					evidence: [{ unitId: "unit", quote: "实现检索函数" }],
				},
			],
		}),
	);
	try {
		let d = s.manager.create("experience");
		const e = edit(d);
		e.overview = "本人实现检索函数，未测量效果";
		d = s.manager.save(e);
		d.materials = [
			{
				id: "fixture",
				name: "代码",
				purpose: "project",
				units: [
					{
						id: "unit",
						text: "实现检索函数",
						location: "第1行",
						selected: true,
					},
				],
				skipped: [],
				createdAt: d.createdAt,
			},
		];
		s.manager.put(d);
		d = await s.manager.generateExperience(d.id);
		assert.equal(d.run?.status, "failed");
		assert.match(d.generationWarnings!.join("\n"), /原文引用未支持的数字/);
		assert.equal(d.experiences.length, 0);
	} finally {
		s.close();
	}
});
test("selected material citations remain located; template/photo excluded from new pipeline", async () => {
	let n = 0,
		input: any;
	const s = fixture(async (_sys: string, prompt: string) => {
		input = JSON.parse(prompt);
		n++;
		return JSON.stringify(
			n === 1
				? {
						issues: [],
						facts: [
							{
								text: "实现检索模块",
								evidence: [{ unitId: "unit", quote: "实现检索模块" }],
							},
						],
					}
				: n === 2
					? oneExperience
					: { valid: true, issues: [] },
		);
	});
	try {
		let d = s.manager.create("experience");
		let e = edit(d);
		e.overview = "本人实现检索模块并编写测试，未测量指标。";
		d = s.manager.save(e);
		d.materials = ["project", "template", "photo"].map((purpose: any) => ({
			id: purpose,
			name: purpose,
			purpose,
			units: [
				{
					id: purpose === "project" ? "unit" : purpose,
					location: "README.md 第1行",
					text: "实现检索模块",
					selected: true,
				},
			],
			skipped: [],
			createdAt: d.createdAt,
		}));
		s.manager.put(d);
		d = await s.manager.generateExperience(d.id);
		assert.equal(d.run?.status, "complete", d.run?.stage);
		assert.equal(d.experienceSources?.length, 2);
		assert.equal(d.experienceSources?.[1].evidence[0].unitId, "unit");
		assert.ok(!JSON.stringify(input.sources).includes('"origin":"template"'));
	} finally {
		s.close();
	}
});
test("mistyped citation IDs resolve only against selected verbatim text", async () => {
	let n = 0;
	const s = fixture(async () =>
		JSON.stringify(
			++n === 1
				? {
						issues: [],
						facts: [
							{
								text: "实现检索模块",
								evidence: [{ unitId: "mistyped", quote: "实现检索模块" }],
							},
						],
					}
				: n === 2
					? oneExperience
					: { valid: true, issues: [] },
		),
	);
	try {
		let d = s.manager.create("experience");
		let e = edit(d);
		e.overview = "本人实现检索模块并测试";
		d = s.manager.save(e);
		d.materials = [
			{
				id: "fixture",
				name: "项目",
				purpose: "project",
				units: [
					{
						id: "selected",
						location: "第1行",
						text: "实现\n检索模块",
						selected: true,
					},
					{
						id: "unselected",
						location: "第2行",
						text: "实现检索模块",
						selected: false,
					},
				],
				skipped: [],
				createdAt: d.createdAt,
			},
		];
		s.manager.put(d);
		d = await s.manager.generateExperience(d.id);
		assert.equal(d.run?.status, "complete", d.run?.stage);
		assert.deepEqual(d.experienceSources?.[1].evidence, [
			{ unitId: "selected", quote: "实现\n检索模块" },
		]);
	} finally {
		s.close();
	}
});
test("canceling unified task retains overview and prevents late commit; concurrent generation refused", async () => {
	let started!: () => void;
	const ready = new Promise<void>((r) => (started = r));
	const s = fixture(async (_sys: string, _p: string, signal: AbortSignal) => {
		started();
		await new Promise((_, reject) =>
			signal.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			}),
		);
		return "{}";
	});
	try {
		let d = s.manager.create("experience");
		let e = edit(d);
		e.overview = "本人实现检索和测试";
		d = s.manager.save(e);
		const task = s.manager.generateExperience(d.id);
		await ready;
		await assert.rejects(s.manager.generateExperience(d.id), /先停止/);
		s.manager.cancel(d.id);
		d = await task;
		assert.equal(d.run?.status, "cancelled");
		assert.equal(d.overview, e.overview);
		assert.equal(d.experiences.length, 0);
	} finally {
		s.close();
	}
});
test("resume fields, local placeholders, step, layout and old records survive restart", () => {
	const s = fixture();
	try {
		s.store.put("favorite", "keep", { value: 1 });
		let d = s.manager.create("full");
		const e = edit(d);
		e.fields.education = "某大学\n计算机硕士";
		e.step = 6;
		d = s.manager.save(e);
		assert.equal(d.step, 6);
		assert.ok(hasPlaceholders(d));
		assert.throws(() => s.manager.save(e), /已更新/);
		const re = new Resumes(
			s.store,
			s.root,
			async () => "{}",
			() => {},
		);
		assert.equal(re.get(d.id).fields.education, "某大学\n计算机硕士");
		assert.deepEqual(s.store.get("favorite", "keep"), { value: 1 });
	} finally {
		s.close();
	}
});
test("project import handles Chinese paths, excludes credentials/dependencies and preserves original files on delete", async () => {
	const s = fixture();
	try {
		const project = join(s.root, "中文 项目");
		mkdirSync(project);
		writeFileSync(
			join(project, "README.md"),
			"构建RAG Agent，使用检索和工具调用。\n",
		);
		writeFileSync(join(project, "main.py"), "def retrieve():\n    return []\n");
		writeFileSync(join(project, ".env"), "API_KEY=private");
		mkdirSync(join(project, "node_modules"));
		writeFileSync(
			join(project, "node_modules", "dep.js"),
			"private dependency",
		);
		let d = s.manager.create("experience");
		d = await s.manager.import(d.id, [project], "project");
		assert.equal(d.run?.status, "complete");
		assert.ok(
			d.materials[0].units.some((u) => u.location.includes("main.py:L1")),
		);
		assert.ok(!selectedUnits(d).some((u) => u.text.includes("private")));
		assert.ok(d.materials[0].skipped.some((s) => s.includes(".env")));
		await s.manager.remove(d.id);
		assert.ok(existsSync(join(project, "main.py")));
		assert.equal(s.manager.list().length, 0);
	} finally {
		s.close();
	}
});
test("ZIP path escape and symlink sources are rejected without extracting", async () => {
	const s = fixture();
	try {
		for (const [name, file, opts] of [
			["escape", "../escape.py", {}],
			["link", "link.py", { unixPermissions: 0o120777 }],
		] as const) {
			const z = new JSZip();
			z.file(file, "out", opts);
			const path = join(s.root, name + ".zip");
			writeFileSync(
				path,
				await z.generateAsync({ type: "nodebuffer", platform: "UNIX" }),
			);
			const d = await s.manager.import(
				s.manager.create("experience").id,
				[path],
				"project",
			);
			assert.equal(d.run?.status, "failed");
			assert.equal(d.materials.length, 0);
		}
		assert.ok(!existsSync(join(s.root, "..", "escape.py")));
	} finally {
		s.close();
	}
});
test("analysis retains only verbatim evidence and never trusts template or invented quotations", async () => {
	const s = fixture(async (_system: string, prompt: string) => {
		const data = JSON.parse(prompt),
			u = data.units[0];
		return JSON.stringify({
			facts: [
				{ text: "工具调用", evidence: [{ unitId: u.id, quote: "工具调用" }] },
				{ text: "虚构指标", evidence: [{ unitId: u.id, quote: "准确率99%" }] },
			],
			questions: [],
			templateSuggestion: "单栏",
		});
	});
	try {
		const p = join(s.root, "project.md");
		writeFileSync(p, "项目使用工具调用和检索。");
		let d = await s.manager.import(
			s.manager.create("experience").id,
			[p],
			"project",
		);
		d = await s.manager.analyze(d.id);
		assert.equal(d.facts.length, 1);
		assert.equal(d.facts[0].confirmed, false);
		assert.ok(d.questions.length >= 3);
		const e = edit(d);
		e.facts[0].confirmed = true;
		e.questions.forEach((q) => (q.skipped = true));
		d = s.manager.save(e);
		assert.ok(d.facts[0].confirmed);
		d = await s.manager.analyze(d.id, true);
		assert.equal(d.facts.length, 1);
		assert.equal(d.run?.status, "failed");
		assert.match(d.run!.stage, /参考模板/);
	} finally {
		s.close();
	}
});
test("generation rejects missing references, fabricated metrics and research status", () => {
	const s = fixture();
	try {
		const d = s.manager.create("experience");
		d.facts = [
			{
				id: "f",
				text: "本人实现检索模块，编写测试",
				confirmed: true,
				evidence: [],
			},
		];
		const row = {
			kind: "project",
			name: "检索项目",
			time: "",
			role: "",
			bullets: [{ text: "实现检索模块", factIds: ["f"] }],
		};
		assert.equal(assertGeneration(d, [row]).length, 1);
		for (const text of [
			"准确率99%",
			"论文已录用",
			"作为第一作者完成论文",
			"降低系统延迟",
		]) {
			assert.throws(() =>
				assertGeneration(d, [{ ...row, bullets: [{ text, factIds: ["f"] }] }]),
			);
		}
		assert.throws(() =>
			assertGeneration(d, [
				{ ...row, bullets: [{ text: "实现检索", factIds: ["bad"] }] },
			]),
		);
	} finally {
		s.close();
	}
});
test("questions can be skipped; generated full resume uses confirmed sections; history and manual edits persist", async () => {
	const s = fixture(async (_system: string, prompt: string) => {
		const data = JSON.parse(prompt);
		return JSON.stringify([
			{
				kind: "project",
				name: "检索项目",
				time: "",
				role: "",
				bullets: [
					{
						text: "实现检索模块",
						factIds: [
							data.facts.find((f: any) => f.id === "input:projects").id,
						],
					},
				],
			},
		]);
	});
	try {
		let d = s.manager.create("full");
		let e = edit(d);
		e.fields.projects = "本人实现检索模块";
		d = s.manager.save(e);
		d = await s.manager.generate(d.id);
		assert.equal(d.run?.status, "complete");
		assert.ok(d.fields.projects.includes("实现检索模块"));
		d = await s.manager.generate(d.id);
		assert.equal(d.versions.length, 1);
		for (let i = 0; i < 10; i++) d = s.manager.save(edit(d));
		assert.equal(d.experiences[0].bullets[0].factIds.length, 1);
		e = edit(d);
		e.experiences[0].bullets[0].text = "本人设计检索模块";
		d = s.manager.save(e);
		assert.equal(d.experiences[0].bullets[0].text, "本人设计检索模块");
		assert.equal(d.experiences[0].bullets[0].factIds.length, 0);
		d = s.manager.restoreVersion(d.id, d.versions[0].at);
		assert.equal(d.experiences[0].bullets[0].text, "实现检索模块");
		assert.ok(d.fields.projects.includes("实现检索模块"));
	} finally {
		s.close();
	}
});
test("stop and restart mark interruption; late model results never save content", async () => {
	const s = fixture(
		async (_s: string, _p: string, signal: AbortSignal) =>
			new Promise((_r, no) => {
				if (signal.aborted) no(new Error("stopped"));
				else
					signal.addEventListener("abort", () => no(new Error("stopped")), {
						once: true,
					});
			}),
	);
	try {
		let d = s.manager.create("experience");
		const e = edit(d);
		e.fields.projects = "检索项目";
		d = s.manager.save(e);
		const pending = s.manager.generate(d.id);
		assert.throws(() => s.manager.save(edit(d)), /请先停止/);
		s.manager.cancel(d.id);
		d = await pending;
		assert.equal(d.run?.status, "cancelled");
		assert.equal(d.experiences.length, 0);
		d.run!.status = "running";
		s.store.put("resume", d.id, d);
		const restarted = new Resumes(
			s.store,
			s.root,
			async () => "{}",
			() => {},
		);
		assert.equal(restarted.get(d.id).run?.status, "failed");
	} finally {
		s.close();
	}
});
test("safe HTML escapes user content, honors section visibility/order and includes no external resources", () => {
	const s = fixture();
	try {
		const d = s.manager.create("full");
		d.fields.education = "<script>alert(1)</script>";
		d.fields.skills = "Python";
		d.layout.order = [
			"skills",
			"education",
			"work",
			"projects",
			"research",
			"awards",
		];
		let html = resumeHTML(d);
		assert.ok(!html.includes("<script>"));
		assert.ok(html.indexOf("专业技能") < html.indexOf("教育背景"));
		d.layout.hidden = ["education"];
		html = resumeHTML(d);
		assert.ok(!html.includes("alert(1)"));
	} finally {
		s.close();
	}
});

test("partial template orders are normalized without accepting unknown or duplicate sections", () => {
	const proposal = normalizeTemplateProposal(
		{
			template: "research",
			order: ["教育背景", "科研成果", "项目经历", "专业技能"],
		},
		2,
	);
	assert.equal(proposal?.pages, 2);
	assert.deepEqual(proposal?.order, [
		"education",
		"research",
		"projects",
		"skills",
		"work",
		"awards",
	]);
	assert.equal(
		normalizeTemplateProposal(
			{ template: "research", order: ["projects", "projects"] },
			1,
		),
		undefined,
	);
	assert.equal(
		normalizeTemplateProposal(
			{ template: "research", order: ["run_command"] },
			1,
		),
		undefined,
	);
});
test("encrypted and excessive ZIP declarations, oversized materials and corrupt PDFs fail cleanly", async () => {
	const s = fixture();
	try {
		const z = new JSZip();
		z.file("main.py", "print(1)");
		const raw = await z.generateAsync({
			type: "nodebuffer",
			compression: "STORE",
		});
		const central = raw.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
		for (const kind of ["encrypted", "oversize"]) {
			const value = Buffer.from(raw);
			if (kind === "encrypted") {
				value.writeUInt16LE(value.readUInt16LE(6) | 1, 6);
				value.writeUInt16LE(value.readUInt16LE(central + 8) | 1, central + 8);
			} else value.writeUInt32LE(101 * 1024 * 1024, central + 24);
			const path = join(s.root, kind + ".zip");
			writeFileSync(path, value);
			const d = await s.manager.import(
				s.manager.create("experience").id,
				[path],
				"project",
			);
			assert.equal(d.run?.status, "failed");
			assert.equal(d.materials.length, 0);
		}
		for (const [name, bytes] of [
			["large.txt", Buffer.alloc(31 * 1024 * 1024)],
			["corrupt.pdf", Buffer.from("not a PDF")],
		] as const) {
			const p = join(s.root, name);
			writeFileSync(p, bytes);
			const d = await s.manager.import(
				s.manager.create("experience").id,
				[p],
				"research",
			);
			assert.equal(d.run?.status, "failed");
		}
	} finally {
		s.close();
	}
});

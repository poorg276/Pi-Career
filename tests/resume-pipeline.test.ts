import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { Store } from "../src/core/store.ts";
import { Resumes } from "../src/core/resume.ts";
import { materialBatches, unsupportedNumbers, validateMaterialFact, validateOwnership, type SelectedUnit } from "../src/core/resume-evidence.ts";
import { reduceSources, recheckContributionIssues } from "../src/core/resume-analysis.ts";
import type { ResumeDraft, ResumeEdit, ResumeExperienceSource } from "../src/shared/resume.ts";

const manuscript = [{ kind: "project", name: "六维传感项目", time: "", role: "开发者", bullets: [
	{ text: "设计六维传感与采集流程。", factIds: ["overview"] },
	{ text: "编写采集源码并完成验证。", factIds: ["overview"] },
] }];
const overview = "六维传感项目由我一人全部完成，包括传感设计、采集源码和验证；没有成员分工。不宣称未测量的性能增益。";
function fixture(model: any) {
	const root = mkdtempSync(join(tmpdir(), "picareer-resume-v15-")), store = new Store(root);
	return { root, store, manager: new Resumes(store, root, model, () => {}), close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const edit = (d: ResumeDraft): ResumeEdit => ({ ...structuredClone(d), selections: Object.fromEntries(d.materials.flatMap((m) => m.units.map((u) => [u.id, u.selected]))) });
function units(count: number, text = "设计六维传感器，编写采集程序。".repeat(400)): SelectedUnit[] {
	return Array.from({ length: count }, (_, i) => ({ id: `u${i}`, location: `main.py:L${i + 1}`, text, selected: true, material: "源码", purpose: "project" }));
}
function addMaterial(s: ReturnType<typeof fixture>, d: ResumeDraft, rows: SelectedUnit[]) {
	d.materials = [{ id: "material", name: "源码", purpose: "project", units: rows, skipped: [], createdAt: d.createdAt }]; s.manager.put(d); return d;
}
test("number evidence uses equivalent spelling and contextual units, without substring or unrelated-number support", () => {
	assert.deepEqual(unsupportedNumbers("6维传感器误差0.50%", "六维传感器误差０．５％"), []);
	assert.deepEqual(unsupportedNumbers("6轴传感", "六维传感"), []);
	assert.ok(unsupportedNumbers("准确率99%", "编号99，202699年").length);
	assert.ok(unsupportedNumbers("6维", "6个文件").length);
	assert.ok(unsupportedNumbers("Python3", "3个测试").length);
	assert.ok(unsupportedNumbers("2026108622021", "2026108622022").length);
	assert.throws(() => validateMaterialFact({ text: "提升99%", evidence: [{ unitId: "u0", quote: "实现采集" }] }, units(1, "实现采集；其他项目99%")), /未支持的数字/);
});
test("material batches include all selected spans, preserve original IDs and honor serialized/vision limits", () => {
	const input = [...units(21), ...units(8, "图片").map((u, i) => ({ ...u, id: `image${i}`, image: "fixture", mimeType: "image/png" }))];
	const batches = materialBatches(input, { overview });
	assert.ok(batches.length > 1);
	assert.deepEqual(batches.flat().map((u) => u.id), input.map((u) => u.id));
	for (const batch of batches) { assert.ok(batch.filter((u) => u.image).length <= 6); assert.ok(JSON.stringify({ overview, units: batch.map(({ image, ...u }) => ({ ...u, image: !!image })) }).length <= 90000); }
	const long = materialBatches(units(1, "原文".repeat(50000)), { overview });
	assert.equal(long.flat().map((u) => u.text).join(""), "原文".repeat(50000));
	assert.ok(long.flat().every((u) => u.id === "u0" && u.location.includes("字符")));
});
test("three documents followed by >1500 irrelevant entries and >800 source fragments import successfully", async () => {
	const s = fixture(async () => "{}");
	try {
		const project = join(s.root, "源码"); mkdirSync(project); mkdirSync(join(project, "node_modules")); mkdirSync(join(project, ".test-data"));
		for (let i = 0; i < 1600; i++) writeFileSync(join(project, `asset${i}.png`), "binary");
		for (let i = 0; i < 810; i++) writeFileSync(join(project, `file${i}.py`), "# 采集程序\n");
		writeFileSync(join(project, "node_modules/dep.js"), "excluded"); writeFileSync(join(project, ".test-data/material.txt"), "excluded");
		const docs = [1, 2, 3].map((i) => { const p = join(s.root, `${i}.txt`); writeFileSync(p, "科研文本"); return p; });
		let d = await s.manager.import(s.manager.create("experience").id, docs, "research");
		d = await s.manager.import(d.id, [project], "project");
		assert.equal(d.run?.status, "complete", d.run?.stage); assert.equal(d.materials.length, 4);
		assert.equal(d.materials[3].units.length, 810); assert.ok(d.materials[3].units.every((u) => u.selected));
		assert.ok(!JSON.stringify(d.materials[3].units).includes("excluded"));
	} finally { s.close(); }
});
test("ZIP source quota excludes dependencies; genuine 10000-file overflow lists unread sources", async () => {
	const s = fixture(async () => "{}");
	try {
		const z = new JSZip(); for (let i = 0; i < 10002; i++) z.file(`source${i}.py`, "# collect\n");
		for (let i = 0; i < 1600; i++) z.file(`node_modules/dep${i}.js`, "excluded");
		const path = join(s.root, "源码.zip"); writeFileSync(path, await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
		const d = await s.manager.import(s.manager.create("experience").id, [path], "project");
		assert.equal(d.run?.status, "complete", d.run?.stage); assert.equal(d.materials[0].units.length, 10000);
		assert.equal(d.materials[0].skipped.filter((v) => v.includes("10000份")).length, 2);
	} finally { s.close(); }
});
test("invalid numeric summary is repaired once or excluded while supported manuscript can proceed", async () => {
	for (const repaired of [true, false]) {
		let repairs = 0;
		const s = fixture(async (system: string, prompt: string) => {
			const input = JSON.parse(prompt);
			if (system.startsWith("仅修复本批")) { repairs++; return JSON.stringify({ facts: repaired ? [{ text: "6维传感器", evidence: [{ unitId: "u0", quote: "六维传感器" }] }] : [] }); }
			if (input.units) return JSON.stringify({ issues: [], facts: [{ text: "6维传感器准确率99%", evidence: [{ unitId: "u0", quote: "六维传感器" }] }] });
			return JSON.stringify(input.experiences ? { valid: true, issues: [], needsInput: false } : manuscript);
		});
		try {
			let d = s.manager.create("experience"); const e = edit(d); e.overview = overview; d = s.manager.save(e); addMaterial(s, d, units(1, "六维传感器"));
			d = await s.manager.generateExperience(d.id);
			assert.equal(d.run?.status, "complete", d.run?.stage); assert.equal(repairs, 1);
			assert.equal(d.experienceSources?.length, repaired ? 2 : 1);
			assert.match(d.generationWarnings!.join("\n"), /99%/); assert.ok(!JSON.stringify(d.experiences).includes("99"));
		} finally { s.close(); }
	}
});
test("duplicate contribution questions are rechecked at both stages without hiding a real conflict", async () => {
	for (const conflict of [false, true]) {
		let rechecks = 0;
		const statement = "六维传感项目由我一人全部完成，包括传感设计、采集源码和验证";
		const s = fixture(async (system: string, prompt: string) => {
			const input = JSON.parse(prompt);
			if (system.startsWith("复核简历审核")) { rechecks++; return JSON.stringify({ resolutions: input.issues.map((_: unknown, index: number) => ({ index, kind: "contribution", duplicate: true, project: "六维传感项目", overviewQuote: statement, reason: "原文已经说明独立完成同一项目" })) }); }
			if (input.units) return JSON.stringify({ ownership: [{ project: "六维传感项目", mode: "solo", quote: statement }], issues: [{ kind: conflict ? "conflict" : "contribution", project: "六维传感项目", message: conflict ? "材料成果状态冲突" : "请提供成员分工" }], facts: [] });
			return JSON.stringify(input.experiences ? { valid: false, needsInput: true, issues: ["请说明成员贡献"] } : manuscript);
		});
		try {
			let d = s.manager.create("experience"); const e = edit(d); e.overview = overview; d = s.manager.save(e);
			d = await s.manager.generateExperience(d.id);
			assert.equal(d.run?.status, conflict ? "failed" : "complete", d.run?.stage); assert.equal(rechecks, conflict ? 1 : 2);
			if (conflict) assert.match(d.inputIssues!.join(""), /冲突/); else assert.equal(d.inputIssues?.length, 0);
		} finally { s.close(); }
	}
});
test("ownership cannot come from materials or resolve a different project's question", async () => {
	assert.deepEqual(validateOwnership([{ project: "甲", mode: "solo", quote: "独立完成所有项目" }], "甲由我负责测试"), []);
	const remaining = await recheckContributionIssues(["乙项目本人工作不明"], [{ project: "甲", mode: "solo", quote: "甲由我独立完成" }], "甲由我独立完成；乙项目是团队资料", async () => JSON.stringify({ resolutions: [{ index: 0, kind: "contribution", duplicate: true, project: "乙", overviewQuote: "甲由我独立完成", reason: "不能跨项目" }] }), new AbortController().signal);
	assert.equal(remaining.length, 1);
});
test("mistyped generation source IDs get one repair and a fresh independent audit", async () => {
	let calls = 0;
	const s = fixture(async () => {
		calls++;
		if (calls === 1) return '{"issues":[],"facts":[]}';
		if (calls === 2) return JSON.stringify([{ ...manuscript[0], bullets: manuscript[0].bullets.map((b) => ({ ...b, factIds: ["invented"] })) }]);
		return JSON.stringify(calls === 3 ? manuscript : { valid: true, issues: [], needsInput: false });
	});
	try {
		let d = s.manager.create("experience"); const e = edit(d); e.overview = overview; d = s.manager.save(e);
		d = await s.manager.generateExperience(d.id); assert.equal(d.run?.status, "complete", d.run?.stage); assert.equal(calls, 4);
		assert.ok(d.experiences.every((x) => x.bullets.every((b) => b.factIds.includes("overview"))));
	} finally { s.close(); }
});
test("large pipeline analyzes every batch and reducer accepts only original source IDs", async () => {
	let batches = 0; const seen = new Set<string>();
	const s = fixture(async (_system: string, prompt: string) => {
		assert.ok(prompt.length <= 90000); const input = JSON.parse(prompt);
		if (input.units) { batches++; for (const u of input.units) seen.add(u.id); return JSON.stringify({ issues: [], facts: [{ text: "设计六维传感器", evidence: [{ unitId: input.units[0].id, quote: "设计六维传感器" }] }] }); }
		return JSON.stringify(input.experiences ? { valid: true, issues: [] } : manuscript);
	});
	try {
		let d = s.manager.create("experience"); const e = edit(d); e.overview = overview; d = s.manager.save(e); addMaterial(s, d, units(25));
		d = await s.manager.generateExperience(d.id); assert.equal(d.run?.status, "complete", d.run?.stage); assert.ok(batches > 1); assert.equal(seen.size, 25); assert.equal(d.run?.batch?.total, batches);
		const all: ResumeExperienceSource[] = [{ id: "overview", text: overview, origin: "overview", evidence: [] }, ...Array.from({ length: 120 }, (_, i) => ({ id: `f${i}`, text: `事实${i}：` + "方法".repeat(1000), origin: "material" as const, evidence: [{ unitId: `u${i}`, quote: "方法" }] }))];
		let reductions = 0;
		const reduced = await reduceSources(all, { overview }, async (_sys, prompt) => { reductions++; assert.ok(prompt.length <= 90000); const p = JSON.parse(prompt); return JSON.stringify({ ids: p.candidates.slice(0, p.max).map((v: any) => v.id) }); }, new AbortController().signal, () => {});
		assert.ok(reductions > 1); assert.ok(reduced.length < all.length); assert.ok(reduced.every((r) => all.includes(r)));
		await assert.rejects(reduceSources(all, { overview }, async () => '{"ids":["invented"]}', new AbortController().signal, () => {}), /汇总格式无效/);
	} finally { s.close(); }
});
test("cancel during a later batch rejects its late result and retains the previous manuscript", async () => {
	let calls = 0, release!: (value: string) => void, reached!: () => void;
	const entered = new Promise<void>((ok) => { reached = ok; });
	const s = fixture(async (_system: string, prompt: string) => {
		calls++; const input = JSON.parse(prompt);
		if (calls === 2) { reached(); return await new Promise<string>((ok) => { release = ok; }); }
		return JSON.stringify({ issues: [], facts: [{ text: "设计六维传感器", evidence: [{ unitId: input.units[0].id, quote: "设计六维传感器" }] }] });
	});
	try {
		let d = s.manager.create("experience"); const e = edit(d); e.overview = overview; d = s.manager.save(e); addMaterial(s, d, units(25));
		d.experiences = [{ ...manuscript[0], id: "previous", kind: "project" }]; s.manager.put(d);
		const pending = s.manager.generateExperience(d.id); await entered; s.manager.cancel(d.id); release('{"issues":[],"facts":[]}'); d = await pending;
		assert.equal(d.run?.status, "cancelled"); assert.equal(calls, 2); assert.equal(d.experiences[0].id, "previous"); assert.equal(d.versions.length, 0); assert.equal(d.overview, overview);
	} finally { s.close(); }
});

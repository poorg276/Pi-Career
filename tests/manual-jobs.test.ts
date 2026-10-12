import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { ManualJobs, validateManualJob } from "../src/core/manual-jobs.ts";
import type { Job, ManualJobInput } from "../src/shared/types.ts";
const input = (): ManualJobInput => ({
	id: randomUUID(),
	mode: "create",
	company: "星河科技",
	city: "长沙",
	role: "Agent 研发实习生",
	jobType: "实习",
	responsibilities: "1. 开发 Agent 应用\n2. 调用工具",
	requirements: "Python 基础\n熟悉 RAG",
	education: "本科",
	experience: "不限",
	graduationYear: "2027",
	salary: "200 元/天",
	sourceUrl: "",
	notes: "线下宣讲会",
});
function setup() {
	const dir = mkdtempSync(join(tmpdir(), "picareer-manual-")),
		store = new Store(dir);
	return {
		dir,
		store,
		manual: new ManualJobs(store),
		close() {
			this.store.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
test("manual jobs are saved once by stable ID, updated in place, and retain original creation time", () => {
	const f = setup();
	try {
		const i = input();
		const j = f.manual.save(i)[0];
		assert.equal(j.origin, "manual");
		assert.equal(j.url, "");
		assert.equal(j.manual?.responsibilities, i.responsibilities);
		assert.equal(j.verification, undefined);
		assert.equal(f.manual.save(i).length, 1);
		const edited = f.manual.save({
			...i,
			mode: "update",
			company: "更新企业",
			sourceUrl: "https://example.com/job",
		})[0];
		assert.equal(edited.id, j.id);
		assert.equal(edited.createdAt, j.createdAt);
		assert.equal(edited.company, "更新企业");
		assert.equal(edited.url, "https://example.com/job");
		assert.equal(f.manual.save(i).length, 1);
	} finally {
		f.close();
	}
});
test("backend validates required fields, type, lengths, IDs and HTTP sources before writing", () => {
	const f = setup();
	try {
		for (const key of [
			"company",
			"city",
			"role",
			"responsibilities",
			"requirements",
		]) {
			assert.throws(
				() => f.manual.save({ ...input(), [key]: "   " }),
				/请填写/,
			);
		}
		for (const change of [
			{ jobType: "不存在" },
			{ sourceUrl: "javascript:alert(1)" },
			{ sourceUrl: "not-a-url" },
			{ sourceUrl: "https://secret:password@example.com" },
			{ responsibilities: "x".repeat(10001) },
			{ id: "unsafe" },
			{ mode: "other" },
		])
			assert.throws(() => f.manual.save({ ...input(), ...change }));
		assert.equal(f.store.list("favorite").length, 0);
		for (const jobType of ["实习", "校招", "社招", "未注明"])
			assert.equal(validateManualJob({ ...input(), jobType }).jobType, jobType);
	} finally {
		f.close();
	}
});
test("manual JD includes complete multiline fields and source without inferred verification", () => {
	const f = setup();
	try {
		const i = input();
		f.manual.save(i);
		const jd = f.manual.prepare(i.id);
		assert.equal(jd.status, "ready");
		assert.equal(jd.url, "");
		assert.match(jd.text, /来源：用户手动录入/);
		for (const key of [
			"company",
			"city",
			"role",
			"jobType",
			"responsibilities",
			"requirements",
			"education",
			"experience",
			"graduationYear",
			"salary",
			"notes",
		] as const)
			assert.ok(jd.text.includes(i[key]));
		f.manual.save({ ...i, mode: "update", requirements: "已更新要求" });
		assert.match(f.manual.prepare(i.id).text, /已更新要求/);
	} finally {
		f.close();
	}
});
test("manual APIs protect online favorites, reject missing updates, and deletion preserves dependent plans", () => {
	const f = setup();
	try {
		const i = input();
		const online = {
			id: i.id,
			title: "原收藏",
			url: "https://example.com",
			role: "岗位",
			company: "企业",
		} as Job;
		f.store.put("favorite", i.id, online);
		assert.throws(() => f.manual.save(i), /仅可编辑/);
		assert.throws(() => f.manual.remove(i.id), /只可删除/);
		assert.throws(() => f.manual.prepare(i.id), /不存在/);
		assert.deepEqual(f.store.get("favorite", i.id), online);
		const j = input();
		assert.throws(() => f.manual.save({ ...j, mode: "update" }), /已被删除/);
		f.manual.save(j);
		const plan = { id: "plan", jd: "manual copy" };
		f.store.put("plan", "plan", plan);
		f.store.put("interview", "session", plan);
		f.manual.remove(j.id);
		f.manual.remove(j.id);
		assert.throws(() => f.manual.prepare(j.id), /不存在/);
		assert.deepEqual(f.store.get("plan", "plan"), plan);
		assert.deepEqual(f.store.get("interview", "session"), plan);
	} finally {
		f.close();
	}
});
test("manual favorites restore after database restart alongside legacy records", () => {
	const f = setup();
	const i = input(),
		legacy = { id: "legacy", title: "旧收藏", url: "https://example.com" };
	try {
		f.manual.save(i);
		f.store.put("favorite", "legacy", legacy);
		f.store.close();
		f.store = new Store(f.dir);
		f.manual = new ManualJobs(f.store);
		assert.equal(f.store.list("favorite").length, 2);
		assert.deepEqual(f.store.get("favorite", "legacy"), legacy);
		assert.match(
			f.manual.prepare(i.id).text,
			/岗位要求：Python 基础\n熟悉 RAG/,
		);
	} finally {
		f.close();
	}
});

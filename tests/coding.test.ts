import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { CodingRecords } from "../src/core/coding.ts";
import { descriptionOnly } from "../src/core/official-html.ts";
import official from "../content/official-problems.json" with { type: "json" };
import source from "../content/official-source.json" with { type: "json" };
import problems from "../content/problems.json" with { type: "json" };
const hash = (s: string | Buffer) =>
	createHash("sha256").update(s).digest("hex");
function setup() {
	const dir = mkdtempSync(join(tmpdir(), "pi-coding-"));
	const store = new Store(dir);
	return {
		dir,
		store,
		coding: new CodingRecords(store),
		close() {
			this.store.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
test("100 official identities, description cuts, templates and local image fingerprints match source snapshots", () => {
	assert.equal(official.length, 100);
	assert.equal(source.length, 100);
	assert.equal(new Set(official.map((p) => p.id)).size, 100);
	for (const p of problems) {
		const snapshot = official.find((s) => s.id === p.id)!,
			raw = source.find((s) => Number(s.question.questionFrontendId) === p.id)!;
		assert.equal(snapshot.slug, p.slug);
		assert.equal(raw.question.titleSlug, p.slug);
		assert.equal(snapshot.title, raw.question.translatedTitle);
		assert.equal(snapshot.template, raw.template);
		assert.match(
			snapshot.template,
			/class (?:Solution|LRUCache|MinStack|Trie|MedianFinder)/,
		);
		assert.equal(snapshot.sourceHash, hash(raw.question.translatedContent));
		const d = descriptionOnly(raw.question.translatedContent);
		let html = d.html;
		for (const image of snapshot.images) {
			html = html.replaceAll(image.source, image.path);
			assert.equal(
				hash(readFileSync(join(import.meta.dirname, "../content", image.path))),
				image.sha256,
			);
		}
		assert.equal(html, snapshot.descriptionHtml);
		assert.equal(hash(html), snapshot.descriptionHash);
		assert.ok(!/<(?:script|iframe)|\son\w+=/i.test(html));
		assert.ok(
			!/(?:示例\s*\d+\s*[:：]|<strong>提示[:：]|<strong>进阶[:：])/.test(html),
		);
		assert.match(snapshot.source, /^https:\/\/leetcode.cn\/problems\//);
		assert.ok(!Number.isNaN(Date.parse(snapshot.fetchedAt)));
	}
	assert.equal(official.flatMap((s) => s.images).length, 3);
});
test("official description rendering removes active HTML while keeping lists, inline code, superscripts and safe links", () => {
	const r = descriptionOnly(
		'<p onclick="alert(1)">题意 <code>x</code> <sup>2</sup><script>bad()</script><a href="javascript:bad()">链接</a></p><ul><li>必要条件</li></ul><iframe src="https://x"></iframe><p>示例 1：</p><pre>不要显示</pre>',
	);
	assert.match(r.html, /<sup>2<\/sup>/);
	assert.match(r.html, /<ul>/);
	assert.ok(!/script|onclick|iframe|javascript|不要显示/.test(r.html));
	assert.throws(() => descriptionOnly("<p>无法确认截取边界</p>"));
	assert.throws(() =>
		descriptionOnly('<p><img src="http://localhost/x"></p><p>示例 1：</p>'),
	);
});
test("wrapped descriptions preserve all intent before the first example and stop nested following sections", () => {
	assert.equal(
		descriptionOnly(
			"<p>第一段</p><div><p>第二段</p><div><p>示例 1：</p><p>案例</p></div></div><p>提示：</p>",
		).html,
		"<p>第一段</p><div><p>第二段</p></div>",
	);
});
test("attempt ordinals are per problem, retry IDs are idempotent, edits never change number, and latest manual result overrides legacy", () => {
	const f = setup();
	try {
		f.store.put("result", "1", { id: 1, passed: true });
		f.store.put("draft", "1", { id: 1, code: "old code" });
		const a = {
			id: randomUUID(),
			problemId: 1,
			mode: "create" as const,
			correct: false,
			notes: "中文\n心得",
		};
		const first = f.coding.save(a)[0];
		assert.equal(first.number, 1);
		f.coding.save({ ...a, correct: true });
		assert.equal(f.coding.list().length, 1);
		assert.equal(f.coding.list()[0].correct, false);
		assert.deepEqual(f.coding.progress().failed, [1]);
		f.coding.save({ ...a, id: randomUUID(), correct: true });
		f.coding.save({ ...a, id: randomUUID(), problemId: 49 });
		assert.deepEqual(
			f.coding.list().map((a) => [a.problemId, a.number]),
			[
				[1, 1],
				[1, 2],
				[49, 1],
			],
		);
		f.coding.save({ ...a, mode: "update", notes: "修改", correct: true });
		assert.equal(f.coding.list()[0].created, first.created);
		assert.equal(f.coding.list()[0].number, 1);
		assert.deepEqual(f.coding.progress().solved, [1]);
		assert.equal(f.store.get<{ code: string }>("draft", "1")?.code, "old code");
		assert.equal(f.coding.progress().legacyResults[0].passed, true);
		f.store.close();
		const resumed = new Store(f.dir);
		assert.equal(new CodingRecords(resumed).list().length, 3);
		resumed.close();
		f.store = new Store(f.dir);
	} finally {
		f.close();
	}
});
test("invalid attempts do not allocate numbers or mutate existing records", () => {
	const f = setup();
	try {
		const a = {
			id: randomUUID(),
			problemId: 1,
			mode: "create" as const,
			correct: false,
			notes: "",
		};
		assert.throws(() =>
			f.coding.save({ ...a, correct: undefined as unknown as boolean }),
		);
		assert.throws(() => f.coding.save({ ...a, problemId: 999999 }));
		assert.throws(() => f.coding.save({ ...a, mode: "update" }));
		f.coding.save(a);
		assert.throws(() => f.coding.save({ ...a, problemId: 49, mode: "update" }));
		assert.equal(f.coding.list()[0].number, 1);
		assert.equal(f.coding.list().length, 1);
	} finally {
		f.close();
	}
});

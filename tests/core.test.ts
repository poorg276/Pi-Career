import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createPlan,
	advance,
	finishQuiz,
	rankKnowledge,
} from "../src/core/study.ts";
import { Store } from "../src/core/store.ts";
import { publicUrl, queryForJobs, Search } from "../src/core/search.ts";
import type { Knowledge } from "../src/shared/types.ts";
const knowledge = JSON.parse(
	readFileSync(new URL("../content/knowledge.json", import.meta.url), "utf8"),
) as Knowledge[];
test("knowledge catalogue has stable unique IDs, substantive fields and references", () => {
	assert.ok(knowledge.length >= 200);
	assert.equal(new Set(knowledge.map((k) => k.id)).size, knowledge.length);
	assert.equal(
		new Set(knowledge.map((k) => k.question)).size,
		knowledge.length,
	);
	for (const k of knowledge) {
		assert.ok(k.answer.length >= 20);
		assert.ok(k.explanation.length >= 15);
		assert.ok(k.tags.length > 0);
		assert.equal(new URL(k.source).protocol, "https:");
	}
});
test("plan snapshots are independent from mutable knowledge data", () => {
	const source = structuredClone(knowledge.slice(0, 11));
	const p = createPlan("Python", source, "matched");
	source[0].answer = "mutated";
	assert.notEqual(p.items[0].answer, "mutated");
});
test("batch completion is idempotent and stale tokens cannot skip a batch", () => {
	let p = createPlan("Python", knowledge.slice(0, 70), "");
	const token = p.batchToken;
	p = advance(p, token);
	assert.equal(p.completed, 10);
	assert.deepEqual(advance(p, token), p);
});
test("50 and 100 trigger tests; last partial block also has final test", () => {
	let p = createPlan("Agent", knowledge.slice(0, 113), "");
	for (let n = 0; n < 5; n++) p = advance(p, p.batchToken);
	assert.equal(p.completed, 50);
	assert.equal(p.status, "quiz");
	assert.equal(p.quizzes[0].itemIds.length, 10);
	assert.equal(advance(p, p.batchToken).completed, 50);
	p = finishQuiz(
		p,
		p.quizzes[0].id,
		Object.fromEntries(p.quizzes[0].itemIds.map((id) => [id, "不会"])),
		"feedback",
	);
	for (let n = 0; n < 5; n++) p = advance(p, p.batchToken);
	assert.equal(p.completed, 100);
	assert.equal(p.status, "quiz");
	assert.equal(p.quizzes[1].from, 50);
	p = finishQuiz(
		p,
		p.quizzes[1].id,
		Object.fromEntries(p.quizzes[1].itemIds.map((id) => [id, "answer"])),
		"feedback",
	);
	p = advance(p, p.batchToken);
	assert.equal(p.completed, 110);
	assert.equal(p.status, "learning");
	p = advance(p, p.batchToken);
	assert.equal(p.completed, 113);
	assert.equal(p.status, "quiz");
	assert.equal(p.quizzes[2].from, 100);
	p = finishQuiz(
		p,
		p.quizzes[2].id,
		Object.fromEntries(p.quizzes[2].itemIds.map((id) => [id, "answer"])),
		"feedback",
	);
	assert.equal(p.status, "complete");
});
test("exactly 100 items do not create duplicate final test", () => {
	let p = createPlan("Agent", knowledge.slice(0, 100), "");
	while (p.status !== "complete") {
		if (p.status === "learning") p = advance(p, p.batchToken);
		else {
			const q = p.quizzes.at(-1)!;
			p = finishQuiz(
				p,
				q.id,
				Object.fromEntries(q.itemIds.map((id) => [id, "answer"])),
				"",
			);
		}
	}
	assert.equal(p.quizzes.length, 2);
});
test("plans smaller than 10 finish actual count and quiz all available items", () => {
	const p = advance(createPlan("Python", knowledge.slice(0, 3), ""), "invalid");
	const next = advance(p, p.batchToken);
	assert.equal(next.completed, 3);
	assert.equal(next.quizzes[0].itemIds.length, 3);
});
test("quiz submission validates answers and is idempotent", () => {
	let p = createPlan("Python", knowledge.slice(0, 5), "");
	p = advance(p, p.batchToken);
	const q = p.quizzes[0];
	assert.throws(() => finishQuiz(p, q.id, {}, ""));
	const done = finishQuiz(
		p,
		q.id,
		Object.fromEntries(q.itemIds.map((id) => [id, "不会"])),
		"self review",
	);
	assert.deepEqual(finishQuiz(done, q.id, {}, ""), done);
});
test("JD ranking matches relevant tags without duplicate IDs", () => {
	const r = rankKnowledge("Python asyncio 高并发", knowledge);
	assert.ok(r.some((k) => k.question.includes("协程")));
	assert.equal(new Set(r.map((k) => k.id)).size, r.length);
});
test("all single job filters and combinations produce queries", () => {
	assert.equal(
		queryForJobs({ city: "深圳", company: "", role: "" }),
		"深圳 招聘 岗位 JD",
	);
	assert.equal(
		queryForJobs({ city: "", company: "华为", role: "" }),
		"华为 招聘 岗位 JD",
	);
	assert.equal(
		queryForJobs({ city: "", company: "", role: "Agent" }),
		"Agent 招聘 岗位 JD",
	);
	assert.equal(
		queryForJobs({ city: "深圳", company: "华为", role: "Agent" }),
		"深圳 华为 Agent 招聘 岗位 JD",
	);
	assert.throws(() => queryForJobs({ city: " ", company: "", role: "" }));
});
test("URL scheme and local targets are rejected", () => {
	for (const url of [
		"file:///a",
		"javascript:alert(1)",
		"http://localhost/a",
		"http://127.0.0.1",
		"http://10.0.1.1",
		"http://192.168.1.1",
		"http://[::1]",
		"https://user:secret@example.com",
	])
		assert.throws(() => publicUrl(url));
	assert.equal(
		publicUrl("https://career.huawei.com/").hostname,
		"career.huawei.com",
	);
});
test("SQLite restores a pending test after closing and opening database", () => {
	const dir = mkdtempSync(join(tmpdir(), "picareer-test-"));
	const db = new Store(dir);
	let p = createPlan("Python", knowledge.slice(0, 50), "");
	for (let n = 0; n < 5; n++) p = advance(p, p.batchToken);
	db.put("plan", p.id, p);
	db.close();
	const restored = new Store(dir);
	assert.deepEqual(restored.get("plan", p.id), p);
	assert.equal(restored.list("plan").length, 1);
	restored.close();
});
test("search strips tracking duplicates and preserves actual content provenance", async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response(
			JSON.stringify({
				results: [
					{
						title: "A",
						url: "https://example.com/jobs/1?utm_source=a",
						content: "岗位摘要",
					},
					{
						title: "duplicate",
						url: "https://example.com/jobs/1?utm_source=b",
						content: "duplicate",
					},
					{ title: "invalid", url: "file:///secret", content: "ignore" },
				],
			}),
		);
	try {
		const results = await new Search(async () => "test-key").tavilySearch(
			"深圳 招聘",
		);
		assert.equal(results.length, 1);
		assert.equal(results[0].fullText, false);
		assert.equal(results[0].content, "岗位摘要");
	} finally {
		globalThis.fetch = original;
	}
});
test("search reports rate limiting and unavailable fallback without invented results", async () => {
	const original = globalThis.fetch;
	try {
		await assert.rejects(
			() => new Search(async () => "").search("x"),
			/内置联网服务未启动/,
		);
		globalThis.fetch = async () => new Response("", { status: 429 });
		await assert.rejects(
			() => new Search(async () => "fake").search("x"),
			/429/,
		);
	} finally {
		globalThis.fetch = original;
	}
});

test("full text recall finds answer terms even without matching tags", () => {
	const entry = {
		...knowledge[0],
		id: "custom",
		category: "基础",
		tags: ["absent"],
		question: "What happens?",
		answer: "The serialization strategy preserves state.",
	};
	assert.equal(rankKnowledge("serialization", [entry])[0].id, "custom");
});
test("review IDs are restricted to the submitted quiz and deduplicated", () => {
	let p = createPlan("Python", knowledge.slice(0, 3), "");
	p = advance(p, p.batchToken);
	const q = p.quizzes[0],
		id = q.itemIds[0];
	p = finishQuiz(
		p,
		q.id,
		Object.fromEntries(q.itemIds.map((i) => [i, "answer"])),
		"feedback",
		[id, id, "unknown"],
	);
	assert.deepEqual(p.quizzes[0].reviewIds, [id]);
});
test("newer database versions are not silently downgraded", () => {
	const dir = mkdtempSync(join(tmpdir(), "picareer-future-"));
	const db = new Store(dir);
	db.db.exec("PRAGMA user_version=2");
	db.close();
	assert.throws(() => new Store(dir), /更高版本/);
});

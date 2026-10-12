import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { descriptionOnly } from "../src/core/official-html.ts";
import official from "../content/official-problems.json" with { type: "json" };
import source from "../content/official-source.json" with { type: "json" };
import catalog from "../content/problems.json" with { type: "json" };
const hash = (s: string | Buffer) =>
	createHash("sha256").update(s).digest("hex");
assert.equal(official.length, 100);
assert.equal(source.length, 100);
assert.equal(new Set(official.map((p) => p.id)).size, 100);
for (const p of catalog) {
	const s = official.find((s) => s.id === p.id)!,
		raw = source.find((s) => Number(s.question.questionFrontendId) === p.id)!;
	assert.equal(s.slug, p.slug);
	assert.equal(raw.question.titleSlug, p.slug);
	assert.equal(s.title, raw.question.translatedTitle);
	assert.equal(s.template, raw.template);
	assert.ok(s.template);
	assert.equal(hash(raw.question.translatedContent), s.sourceHash);
	let html = descriptionOnly(raw.question.translatedContent).html;
	for (const image of s.images) {
		assert.match(
			image.path,
			/^leetcode-assets\/[a-f0-9]{24}\.(png|gif|jpg|jpeg|webp)$/,
		);
		assert.equal(
			hash(readFileSync(join(import.meta.dirname, "../content", image.path))),
			image.sha256,
		);
		html = html.replaceAll(image.source, image.path);
	}
	assert.equal(html, s.descriptionHtml);
	assert.equal(hash(html), s.descriptionHash);
	assert.ok(!/<img[^>]+src="https?:/i.test(html));
}
console.log(
	`Official snapshots verified: ${official.length} problems, ${official.flatMap((s) => s.images).length} offline images.`,
);

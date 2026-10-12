import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { descriptionOnly } from "../src/core/official-html.ts";
import problems from "../content/problems.json" with { type: "json" };
const root = join(import.meta.dirname, ".."),
	raw = join(root, ".test-data/leetcode-raw"),
	assetRoot = join(root, "content/leetcode-assets");
mkdirSync(assetRoot, { recursive: true });
const hash = (value: string | Buffer) =>
	createHash("sha256").update(value).digest("hex");
mkdirSync(raw, { recursive: true });
const cached = JSON.parse(
	readFileSync(join(root, "content/official-source.json"), "utf8"),
);
const result = [],
	missing = [],
	assets = [],
	sources = [];
for (const p of problems) {
	const path = join(raw, `${p.id}.json`);
	const data = existsSync(path)
		? JSON.parse(readFileSync(path, "utf8"))
		: cached.find(
				(s: { question: { questionFrontendId: string } }) =>
					Number(s.question.questionFrontendId) === p.id,
			);
	if (!data) {
		missing.push(p.id);
		continue;
	}
	const q = data.question;
	if (
		Number(q.questionFrontendId) !== p.id ||
		q.titleSlug !== p.slug ||
		!q.translatedTitle
	)
		throw Error(`Official identity: ${p.id}`);
	const template =
		q.codeSnippets?.find((s: { langSlug: string }) => s.langSlug === "python3")
			?.code ?? data.template;
	if (!template) throw Error(`Official Python3 template missing: ${p.id}`);
	sources.push({
		source: data.source,
		fetchedAt: data.fetchedAt,
		question: {
			questionFrontendId: q.questionFrontendId,
			titleSlug: q.titleSlug,
			translatedTitle: q.translatedTitle,
			translatedContent: q.translatedContent,
		},
		template,
	});
	const desc = descriptionOnly(q.translatedContent),
		images = [];
	let html = desc.html;
	for (const source of desc.imageSources) {
		const file = hash(source).slice(0, 24) + extname(new URL(source).pathname),
			local = join(assetRoot, file);
		assets.push({ source, file });
		const path = `leetcode-assets/${file}`;
		if (!existsSync(local)) continue;
		images.push({ source, path, sha256: hash(readFileSync(local)) });
		html = html.replaceAll(source, path);
	}
	result.push({
		id: p.id,
		slug: p.slug,
		title: q.translatedTitle,
		category: p.category,
		difficulty: p.difficulty,
		descriptionHtml: html,
		template,
		source: data.source,
		fetchedAt: data.fetchedAt,
		sourceHash: hash(q.translatedContent),
		descriptionHash: hash(html),
		images,
	});
}
writeFileSync(join(raw, "assets.json"), JSON.stringify(assets, null, 2));
if (missing.length && !process.argv.includes("--partial"))
	throw Error(`Missing official statements: ${missing.join(",")}`);
if (
	assets.some((a) => !existsSync(join(assetRoot, a.file))) &&
	!process.argv.includes("--partial")
)
	throw Error("Download official description assets first.");
writeFileSync(
	join(root, "content/official-problems.json"),
	JSON.stringify(result, null, 2) + "\n",
);
if (!missing.length)
	writeFileSync(
		join(root, "content/official-source.json"),
		JSON.stringify(sources, null, 2) + "\n",
	);
console.log({ count: result.length, missing, images: assets.length });

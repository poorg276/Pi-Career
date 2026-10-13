import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import type { Source } from "../shared/types.ts";
import { publicUrl, WebError, type WebPage } from "./public-web.ts";

const clean = (text: string | null | undefined) =>
	(text ?? "").replace(/\s+/g, " ").trim();
export function hasQueryOverlap(rows: Source[], query: string): boolean {
	const words =
		query
			.normalize("NFKC")
			.toLowerCase()
			.match(/[a-z][a-z0-9_-]+|[\u3400-\u9fff]{2,}/g) ?? [];
	const terms = words
		.filter(
			(word) =>
				![
					"the",
					"and",
					"for",
					"with",
					"what",
					"who",
					"where",
					"site",
					"https",
					"http",
					"com",
				].includes(word),
		)
		.flatMap((word) =>
			/^[\u3400-\u9fff]/.test(word)
				? Array.from({ length: word.length - 1 }, (_, i) =>
						word.slice(i, i + 2),
					)
				: [word],
		);
	if (!terms.length) return true;
	return rows.some((row) => {
		const text = `${row.title} ${row.content} ${row.url}`
			.normalize("NFKC")
			.toLowerCase();
		return terms.some((term) => text.includes(term));
	});
}
function documentFor(page: WebPage) {
	const { document } = parseHTML(page.body);
	const title = clean(document.title);
	if (
		document.querySelector(
			"#challenge-form, .anomaly-modal, #b_captcha, #cf-challenge-running, form[action*='captcha']",
		) ||
		/^(just a moment|access denied|verify you are human|安全验证|访问验证|人机验证)/i.test(
			title,
		)
	)
		throw new WebError(
			"VERIFICATION",
			"网站要求验证，未能读取搜索结果或正文。可在系统浏览器打开原文。",
		);
	return document;
}
export function searchPage(
	page: WebPage,
	engine: "Bing" | "DuckDuckGo",
): Source[] {
	const document = documentFor(page),
		seen = new Set<string>(),
		rows: Source[] = [];
	const nodes = document.querySelectorAll(
		engine === "Bing" ? "#b_results .b_algo" : ".result:not(.result--ad)",
	);
	for (const node of nodes) {
		const anchor = node.querySelector(
			engine === "Bing" ? "h2 a" : "a.result__a",
		);
		if (!anchor) continue;
		try {
			let u = new URL(anchor.getAttribute("href") ?? "", page.url);
			if (/(^|\.)bing\.com$/.test(u.hostname) && u.pathname === "/ck/a") {
				const encoded = u.searchParams.get("u");
				if (!encoded?.startsWith("a1")) continue;
				u = new URL(
					Buffer.from(encoded.slice(2), "base64url").toString("utf8"),
				);
			}
			if (
				/(^|\.)duckduckgo\.com$/.test(u.hostname) &&
				u.searchParams.has("uddg")
			)
				u = new URL(u.searchParams.get("uddg")!);
			u = publicUrl(u.href);
			if (
				/(^|\.)(bing\.com|duckduckgo\.com|microsoft\.com)$/.test(u.hostname) &&
				/\/(search|aclick|y\.js|advertising)/.test(u.pathname)
			)
				continue;
			for (const key of [...u.searchParams.keys()])
				if (/^utm_|^(gclid|fbclid)$/.test(key)) u.searchParams.delete(key);
			const title = clean(anchor.textContent);
			if (!title || seen.has(u.href)) continue;
			seen.add(u.href);
			rows.push({
				title,
				url: u.href,
				content: clean(
					node.querySelector(
						engine === "Bing"
							? ".b_caption p, .b_snippet, p"
							: ".result__snippet",
					)?.textContent,
				).slice(0, 4000),
				retrievedAt: new Date().toISOString(),
				kind: "web",
				fullText: false,
				searchEngine: engine,
			});
			if (rows.length >= 10) break;
		} catch {
			/* A malformed or non-public result is not a source. */
		}
	}
	if (
		!rows.length &&
		!document.querySelector(".b_no, .no-results, .result--no-result")
	)
		throw new WebError(
			"PARSE",
			`${engine} 页面未返回可识别的搜索结果，可能受验证限制或页面格式已变化。`,
		);
	return rows;
}
export function extractPage(page: WebPage): Source {
	const url = publicUrl(page.url).href;
	if (/^text\/plain\b/i.test(page.contentType)) {
		if (!page.body.trim()) throw new WebError("EMPTY", "网页没有正文内容。");
		return {
			title: new URL(url).hostname,
			url,
			content: page.body.slice(0, 30000),
			kind: "web",
			retrievedAt: new Date().toISOString(),
			fullText: true,
			searchEngine: "直接读取",
		};
	}
	const document = documentFor(page),
		title = clean(document.title);
	const requiresScripts = document.querySelectorAll("script[src]").length > 0;
	if (document.querySelectorAll("*").length > 25000)
		throw new WebError("SIZE", "网页结构过大，无法提取正文。");
	for (const node of document.querySelectorAll(
		"script, style, noscript, iframe, form, template, svg, base",
	))
		node.remove();
	const base = document.createElement("base");
	base.setAttribute("href", url);
	document.head.prepend(base);
	Object.defineProperty(document, "documentURI", { value: url });
	const article = new Readability(document, {
		charThreshold: 100,
		maxElemsToParse: 25000,
	}).parse();
	const content = article?.textContent
		?.replace(/[\t ]+/g, " ")
		.replace(/\n\s*\n\s*\n/g, "\n\n")
		.trim();
	if (!article || !content || content.length < 100)
		throw new WebError(
			requiresScripts ? "DYNAMIC" : "EXTRACT",
			"网页正文不足或无法提取，可能需要登录或加载脚本；未将导航或搜索摘要当作正文。",
		);
	return {
		title: clean(article.title) || title || new URL(url).hostname,
		url,
		content: content.slice(0, 30000),
		publishedAt: article.publishedTime ?? undefined,
		retrievedAt: new Date().toISOString(),
		kind: "web",
		fullText: true,
		searchEngine: "直接读取",
	};
}

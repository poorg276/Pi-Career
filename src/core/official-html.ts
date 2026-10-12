import { parseHTML } from "linkedom";
const tags = new Set([
	"P",
	"DIV",
	"SPAN",
	"STRONG",
	"B",
	"EM",
	"I",
	"U",
	"CODE",
	"PRE",
	"UL",
	"OL",
	"LI",
	"BR",
	"SUP",
	"SUB",
	"IMG",
	"A",
	"BLOCKQUOTE",
	"TABLE",
	"THEAD",
	"TBODY",
	"TR",
	"TH",
	"TD",
	"H2",
	"H3",
	"H4",
]);
const discard = new Set([
	"SCRIPT",
	"STYLE",
	"IFRAME",
	"OBJECT",
	"EMBED",
	"SVG",
	"FORM",
	"INPUT",
	"BUTTON",
	"META",
	"LINK",
]);
export function descriptionOnly(raw: string): {
	html: string;
	imageSources: string[];
} {
	const { document } = parseHTML(
		`<html><body><section>${raw}</section></body></html>`,
	);
	const root = document.querySelector("section")!;
	let cutoff = false;
	function trim(parent: typeof root) {
		for (const node of [...parent.childNodes]) {
			if (cutoff) {
				node.remove();
				continue;
			}
			if (node.nodeType !== 1) continue;
			if (
				/^(?:示例|提示|进阶|约束|Examples?|Constraints|Follow.?up)(?:\s*\d+)?\s*[:：]/i.test(
					(node.textContent ?? "").trim(),
				)
			) {
				cutoff = true;
				node.remove();
			} else trim(node as typeof root);
		}
	}
	trim(root);
	if (!cutoff || !root.textContent.trim())
		throw new Error("无法可靠识别官方描述边界。");
	const imageSources: string[] = [];
	for (const node of [...root.querySelectorAll("*")]) {
		if (discard.has(node.tagName)) {
			node.remove();
			continue;
		}
		if (!tags.has(node.tagName)) {
			node.replaceWith(...node.childNodes);
			continue;
		}
		const href = node.getAttribute("href"),
			src = node.getAttribute("src"),
			alt = node.getAttribute("alt");
		for (const attribute of [...node.attributes])
			node.removeAttribute(attribute.name);
		if (node.tagName === "A" && href) {
			try {
				const u = new URL(href);
				if (
					["http:", "https:"].includes(u.protocol) &&
					!u.username &&
					!u.password
				)
					node.setAttribute("href", u.href);
			} catch {}
		}
		if (node.tagName === "IMG") {
			const u = new URL(src ?? "");
			if (
				u.protocol !== "https:" ||
				![
					"assets.leetcode.com",
					"assets.leetcode.cn",
					"pic.leetcode.cn",
				].includes(u.hostname)
			)
				throw new Error("题面图片来源不受支持。");
			node.setAttribute("src", u.href);
			node.setAttribute("alt", alt ?? "题意图示");
			imageSources.push(u.href);
		}
	}
	while (
		root.lastChild &&
		!root.lastChild.textContent?.trim() &&
		!(root.lastChild as HTMLElement).querySelector?.("img")
	)
		root.lastChild.remove();
	return {
		html: root.innerHTML.trim(),
		imageSources: [...new Set(imageSources)],
	};
}

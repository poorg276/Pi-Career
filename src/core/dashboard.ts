import { createHash, randomUUID } from "node:crypto";
import { parseHTML } from "linkedom";
import { Store } from "./store.ts";
import { Search } from "./search.ts";
import { extractPage } from "./web-content.ts";
import { publicUrl, type WebPage, type WebReader } from "./public-web.ts";
import type {
	DashboardNews,
	DashboardState,
	Knowledge,
	RecruitmentPortal,
} from "../shared/types.ts";
import portals from "../../content/recruitment-portals.json" with {
	type: "json",
};
import knowledge from "../../content/knowledge.json" with { type: "json" };

const DAY = 86400000;
export const NEWS_LISTS = [
	"https://www.anthropic.com/news",
	"https://blog.langchain.com/",
	"https://www.langchain.com/blog",
	"https://openai.com/news/",
	"https://github.com/langchain-ai/langgraph/releases",
	"https://github.com/microsoft/autogen/releases",
];
const hosts = new Set([
	"openai.com",
	"www.openai.com",
	"anthropic.com",
	"www.anthropic.com",
	"blog.langchain.com",
	"www.langchain.com",
	"langchain.com",
]);
const repos = [
	"/langchain-ai/langgraph/releases/tag/",
	"/microsoft/autogen/releases/tag/",
	"/huggingface/smolagents/releases/tag/",
	"/modelcontextprotocol/typescript-sdk/releases/tag/",
];
const topic =
	/agent|claude|gpt|codex|llm|langgraph|langchain|langsmith|mcp|memory|tool.call|evaluation|reasoning|模型|智能体|评测|工具调用|记忆/i;
const technical =
	/introduc|releas|launch|updat|new |model|agent|tool|mcp|memory|evaluat|reason|context|framework|deploy|发布|更新|推出|模型|智能体|评测|部署/i;
const unwanted =
	/招聘|培训|人才|融资|投资|会议报名|教程|入门指南|hiring|train.*engineer|invest[s ]|funding|academy|webinar|tutorial|usage.policy|verification.program|partnership|how.to|how .*turned|building restock|building prod|novel enzyme/i;
const clean = (s: string | null | undefined) =>
	(s ?? "").replace(/\s+/g, " ").trim();
export function officialNewsUrl(raw: string): string | undefined {
	try {
		const u = publicUrl(raw);
		u.hash = "";
		if (u.protocol !== "https:") return;
		for (const k of [...u.searchParams.keys()])
			if (/^utm_|^(ref|source)$/.test(k)) u.searchParams.delete(k);
		if (u.hostname === "github.com") {
			if (!repos.some((p) => u.pathname.startsWith(p))) return;
		} else if (
			!hosts.has(u.hostname) ||
			(u.hostname === "blog.langchain.com"
				? !/^\/[^/]+\/$/.test(u.pathname) ||
					/^\/(blog|news|tag|author)\//.test(u.pathname)
				: !/^\/(news|index|blog)\/[^/]+/.test(u.pathname))
		)
			return;
		return u.href;
	} catch {
		return;
	}
}
function asDate(raw: string, now: Date): string | undefined {
	// Exact calendar dates only: do not interpret "today" or retrieval times as publication dates.
	if (
		!/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/.test(
			raw,
		)
	)
		return;
	const time = Date.parse(raw.replace(/年|月/g, "-").replace(/日/g, ""));
	if (
		!Number.isFinite(time) ||
		time > now.getTime() ||
		now.getTime() - time > 90 * DAY
	)
		return;
	return new Date(time).toISOString();
}
type Candidate = { url: string; title: string; date?: string };
export function newsCandidates(page: WebPage, now: Date): Candidate[] {
	const { document } = parseHTML(page.body),
		out: Candidate[] = [],
		seen = new Set<string>();
	for (const a of document.querySelectorAll("a[href]")) {
		let address: string;
		try {
			address = new URL(a.getAttribute("href")!, page.url).href;
		} catch {
			continue;
		}
		const url = officialNewsUrl(address);
		const card = a.closest("article, li, .blog-item, section") ?? a;
		const title =
			clean(a.textContent) || clean(card.querySelector("h2, h3")?.textContent);
		if (
			!url ||
			title.length < 8 ||
			title.length > 400 ||
			unwanted.test(title) ||
			seen.has(url)
		)
			continue;
		if (!topic.test(title) && !url.includes("/releases/tag/")) continue;
		seen.add(url);
		const date =
			card.querySelector("time, relative-time")?.getAttribute("datetime") ??
			clean(card.textContent).match(
				/[A-Z][a-z]+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2}/,
			)?.[0];
		out.push({ url, title, date: date ? asDate(date, now) : undefined });
	}
	return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
export function parseNews(page: WebPage, now: Date): DashboardNews {
	const url = officialNewsUrl(page.url);
	if (!url) throw new Error("非官方技术发布来源");
	const { document } = parseHTML(page.body);
	if (
		document.querySelector("#challenge-form, #cf-challenge-running") ||
		/just a moment|access denied/i.test(document.title)
	)
		throw new Error("来源要求验证");
	const github = new URL(url).hostname === "github.com";
	const title =
		clean(
			document.querySelector(
				github ? ".release-header h1, .release-header h2, h1" : "h1",
			)?.textContent,
		) ||
		clean(
			document
				.querySelector('meta[property="og:title"]')
				?.getAttribute("content"),
		) ||
		clean(document.title);
	let dateRaw = document
		.querySelector(
			'meta[property="article:published_time"], meta[name="date"], meta[itemprop="datePublished"]',
		)
		?.getAttribute("content");
	for (const s of document.querySelectorAll(
		'script[type="application/ld+json"]',
	)) {
		try {
			const visit = (v: unknown): void => {
				if (!v || typeof v !== "object") return;
				const r = v as Record<string, unknown>;
				if (
					/Article|BlogPosting|NewsArticle/.test(String(r["@type"])) &&
					typeof r.datePublished === "string"
				)
					dateRaw ??= r.datePublished;
				for (const child of Object.values(r))
					if (typeof child === "object") {
						if (Array.isArray(child)) child.forEach(visit);
						else visit(child);
					}
			};
			visit(JSON.parse(s.textContent ?? ""));
		} catch {
			/* Malformed metadata is not evidence. */
		}
	}
	dateRaw ??= document
		.querySelector("article time, main time, relative-time")
		?.getAttribute("datetime");
	let content = "";
	if (github)
		content = (
			document.querySelector(".markdown-body")?.textContent ?? ""
		).trim();
	else {
		const article = extractPage(page);
		content = article.content;
		dateRaw ??= article.publishedAt;
	}
	if (!dateRaw) {
		const main = document.querySelector("article, main")?.textContent ?? "";
		dateRaw = main.match(/[A-Z][a-z]+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2}/)?.[0];
	}
	const publishedAt = dateRaw ? asDate(dateRaw, now) : undefined;
	if (!publishedAt) throw new Error("未核实近90天内的发布日期");
	if (
		unwanted.test(title + " " + document.title) ||
		(!github && !topic.test(title)) ||
		!topic.test(title + " " + content.slice(0, 2000)) ||
		!technical.test(title + " " + content.slice(0, 1500))
	)
		throw new Error("不是相关技术更新");
	if (content.length < 100) throw new Error("技术正文不足");
	const sentences = content
		.replace(/\s+/g, " ")
		.split(/(?<=[。.!?])\s+/)
		.filter(
			(s) =>
				s.length > 35 &&
				/releas|new |improv|introduc|support|add|now |capabilit|更新|新增|发布/i.test(
					s,
				),
		);
	const change =
		/We've revamped|Today we're releasing|We are releasing|We're introducing|We are introducing|本次更新|今日发布/i.exec(
			content,
		);
	const changes = github
		? content
				.split(/\n/)
				.filter((line) => /^\s*(feat|fix|perf)[(:]/i.test(line))
				.slice(0, 3)
				.join(" ")
		: undefined;
	const evidence = (
		changes ||
		(change ? content.slice(change.index) : sentences.slice(0, 3).join(" ")) ||
		clean(content)
	).slice(0, 650);
	const category =
		github || /langgraph|langchain|framework|deep agents/i.test(title)
			? "Agent 框架更新"
			: /memory|记忆/i.test(title)
				? "Agent 记忆进展"
				: /evaluat|评测/i.test(title)
					? "Agent 评测进展"
					: /mcp|tool/i.test(title)
						? "工具调用技术进展"
						: "AI 模型与 Agent 进展";
	const headline = github
		? `${title.replace(/==/g, " ")}：版本更新`
		: /skills.*deep agents/i.test(title)
			? "Deep Agents：技能机制更新"
			: /schedules.*configuration/i.test(title)
				? "Managed Deep Agents：任务调度与配置更新"
				: `${category}｜${title}`;
	return {
		id: createHash("sha256").update(url).digest("hex").slice(0, 24),
		title: headline,
		originalTitle: title,
		summary: `官方发布涉及${category.replace(/进展|更新/g, "")}。原文摘录：${evidence.slice(0, 240)}`,
		url,
		source: new URL(url).hostname,
		publishedAt,
		retrievedAt: now.toISOString(),
		evidence,
		dateEvidence: dateRaw!,
	};
}
export function selectNews(rows: DashboardNews[]): DashboardNews[] {
	const seen = new Set<string>();
	return [...rows]
		.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
		.filter((n) => {
			const event = n.originalTitle
				.toLowerCase()
				.replace(/[^a-z0-9\u3400-\u9fff]/g, "");
			if (seen.has(event) || seen.has(n.url)) return false;
			seen.add(event);
			seen.add(n.url);
			return true;
		})
		.slice(0, 3);
}
export function translatedNews(
	rows: DashboardNews[],
	input: unknown,
): DashboardNews[] {
	if (!Array.isArray(input) || input.length !== rows.length)
		throw new Error("中文整理格式无效");
	return rows.map((row) => {
		const value = input.find((v) => v?.id === row.id);
		if (
			!value ||
			typeof value.title !== "string" ||
			typeof value.summary !== "string" ||
			value.title.length > 180 ||
			value.summary.length > 350 ||
			!/[\u3400-\u9fff]/.test(value.title) ||
			value.quote !== row.evidence ||
			/https?:|<|>/.test(value.title + value.summary)
		)
			throw new Error("中文整理缺少原文依据");
		const original = row.originalTitle + row.evidence;
		for (const n of (value.title + value.summary).match(/\d+(?:\.\d+)*/g) ?? [])
			if (!original.includes(n)) throw new Error("中文整理引入未知数字");
		return { ...row, title: value.title, summary: value.summary };
	});
}
type Cache = Pick<
	DashboardState,
	"news" | "updatedAt" | "attemptedAt" | "warnings" | "status"
>;
export class Dashboard {
	private active?: Promise<DashboardState>;
	private controller?: AbortController;
	private requestId?: string;
	private stage?: string;
	private startedAt?: string;
	private store: Store;
	private search: Search;
	private read?: WebReader;
	private emit: (state: DashboardState) => void;
	private now: () => Date;
	private translate?: (
		rows: DashboardNews[],
		signal: AbortSignal,
	) => Promise<DashboardNews[]>;
	constructor(
		store: Store,
		search: Search,
		read: WebReader | undefined,
		emit: (state: DashboardState) => void,
		now = () => new Date(),
		translate?: (
			rows: DashboardNews[],
			signal: AbortSignal,
		) => Promise<DashboardNews[]>,
	) {
		this.store = store;
		this.search = search;
		this.read = read;
		this.emit = emit;
		this.now = now;
		this.translate = translate;
		const cached = store.get<Cache>("dashboard", "news");
		if (cached?.status === "loading")
			store.put<Cache>("dashboard", "news", {
				...cached,
				status: "failed",
				warnings: ["上次资讯更新已中断，可点击刷新重试。"],
			});
	}
	private localDate(date: Date) {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	}
	private daily(next = false) {
		const now = this.now(),
			date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
		const pool = (knowledge as Knowledge[]).filter((k) =>
			["LLM", "RAG", "Agent", "框架", "评测", "部署"].includes(k.category),
		);
		let saved = this.store.get<{ date: string; knowledge: Knowledge }>(
			"dashboard",
			"knowledge",
		);
		if (!saved || saved.date !== date || next) {
			const index = saved
				? (pool.findIndex((k) => k.id === saved!.knowledge.id) + 1) %
					pool.length
				: parseInt(
						createHash("sha256").update(date).digest("hex").slice(0, 8),
						16,
					) % pool.length;
			saved = this.store.put("dashboard", "knowledge", {
				date,
				knowledge: pool[index],
			});
		}
		return saved;
	}
	state(): DashboardState {
		const daily = this.daily(),
			cached = this.store.get<Cache>("dashboard", "news");
		return {
			portals: portals as RecruitmentPortal[],
			news: cached?.news ?? [],
			knowledge: daily.knowledge,
			knowledgeDate: daily.date,
			status: this.active ? "loading" : (cached?.status ?? "idle"),
			updatedAt: cached?.updatedAt,
			attemptedAt: this.active ? this.startedAt : cached?.attemptedAt,
			warnings: cached?.warnings ?? [],
			requestId: this.requestId,
			stage: this.stage,
		};
	}
	nextKnowledge() {
		this.daily(true);
		const value = this.state();
		this.emit(value);
		return value;
	}
	start() {
		void this.ensureUpdated().catch(() => {});
	}
	ensureUpdated(): Promise<DashboardState> {
		if (this.active) return this.active;
		let saved = this.store.get<{ date: string }>("dashboard", "refresh-day");
		if (!saved) {
			const attempted = this.store.get<Cache>("dashboard", "news")?.attemptedAt;
			if (attempted && Number.isFinite(Date.parse(attempted)))
				saved = this.store.put("dashboard", "refresh-day", {
					date: this.localDate(new Date(attempted)),
				});
		}
		return saved?.date === this.localDate(this.now())
			? Promise.resolve(this.state())
			: this.refresh();
	}
	close() {
		this.controller?.abort(new Error("应用已关闭"));
	}
	refresh(): Promise<DashboardState> {
		if (this.active) return this.active;
		const now = this.now();
		// Commit the daily attempt before any asynchronous work, including manual refresh.
		this.store.put("dashboard", "refresh-day", { date: this.localDate(now) });
		const old = this.store.get<Cache>("dashboard", "news");
		this.store.put<Cache>("dashboard", "news", {
			news: old?.news ?? [],
			updatedAt: old?.updatedAt,
			attemptedAt: now.toISOString(),
			warnings: old?.warnings ?? [],
			status: "loading",
		});
		this.controller = new AbortController();
		this.requestId = randomUUID();
		this.startedAt = now.toISOString();
		this.stage = "正在检索官方技术发布";
		this.active = this.update(
			AbortSignal.any([this.controller.signal, AbortSignal.timeout(90000)]),
		);
		this.emit(this.state());
		return this.active;
	}
	private async update(signal: AbortSignal): Promise<DashboardState> {
		// Defer to ensure refresh() installs the active promise before any progress event.
		await Promise.resolve();
		const rows: DashboardNews[] = [],
			warnings: string[] = [],
			candidates: Candidate[] = [],
			seen = new Set<string>();
		let reads = 0;
		const map = async <T>(items: T[], fn: (item: T) => Promise<void>) => {
			let cursor = 0;
			await Promise.all(
				Array.from({ length: Math.min(3, items.length) }, async () => {
					while (cursor < items.length && !signal.aborted)
						await fn(items[cursor++]);
				}),
			);
		};
		const read = async (url: string) => {
			if (!this.read) throw new Error("内置联网服务未启动");
			return this.read(
				url,
				AbortSignal.any([signal, AbortSignal.timeout(12000)]),
			);
		};
		const enqueue = (c: Candidate) => {
			if (!seen.has(c.url)) {
				seen.add(c.url);
				candidates.push(c);
			}
		};
		const verify = async () => {
			const batch = candidates.splice(0, 12 - reads);
			reads += batch.length;
			await map(batch, async (c) => {
				try {
					rows.push(parseNews(await read(c.url), this.now()));
				} catch (e) {
					if (!signal.aborted)
						warnings.push(
							`${new URL(c.url).hostname}：${e instanceof Error ? e.message : "正文读取失败"}`,
						);
				}
			});
		};
		try {
			await map(NEWS_LISTS, async (url) => {
				try {
					newsCandidates(await read(url), this.now())
						.slice(0, 8)
						.forEach(enqueue);
				} catch (e) {
					warnings.push(
						`${new URL(url).hostname}：${e instanceof Error ? e.message : "官方发布列表读取失败"}`,
					);
				}
			});
			candidates.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
			this.stage = "正在核实正文与发布日期";
			this.emit(this.state());
			await verify();
			const queries = [
				"site:openai.com/index/ new model agent",
				"site:anthropic.com/news Claude agent new",
				"site:blog.langchain.com agent release",
				"site:langchain.com/blog agent memory evaluation",
				"site:github.com/langchain-ai/langgraph/releases agent",
				"site:github.com/microsoft/autogen/releases agent",
			];
			for (const query of queries) {
				if (selectNews(rows).length >= 3 || reads >= 12 || signal.aborted)
					break;
				try {
					const results = await this.search.search(
						query,
						AbortSignal.any([signal, AbortSignal.timeout(8000)]),
					);
					results.forEach((r) => {
						const url = officialNewsUrl(r.url);
						if (url) enqueue({ url, title: r.title });
					});
					await verify();
				} catch (e) {
					if (!signal.aborted)
						warnings.push(e instanceof Error ? e.message : "搜索失败");
				}
			}
			let selected = selectNews(rows);
			if (this.translate && selected.length && !signal.aborted) {
				try {
					selected = await this.translate(
						selected,
						AbortSignal.any([signal, AbortSignal.timeout(12000)]),
					);
				} catch {
					warnings.push("中文整理暂不可用，已保留官方摘录。");
				}
			}
			const old = this.store.get<Cache>("dashboard", "news"),
				now = this.now().toISOString();
			if (signal.aborted) warnings.push("本次更新已超时或取消。");
			if (selected.length < 3)
				warnings.unshift(
					`近90天核实到 ${selected.length} 条相关技术进展，未用无依据内容补齐。`,
				);
			this.store.put<Cache>("dashboard", "news", {
				news: selected.length ? selected : (old?.news ?? []),
				updatedAt: selected.length ? now : old?.updatedAt,
				attemptedAt: now,
				status:
					selected.length === 3
						? "ready"
						: selected.length
							? "partial"
							: "failed",
				warnings: [...new Set(warnings)].slice(0, 12),
			});
		} catch (e) {
			const old = this.store.get<Cache>("dashboard", "news");
			this.store.put<Cache>("dashboard", "news", {
				...old,
				news: old?.news ?? [],
				attemptedAt: this.now().toISOString(),
				status: "failed",
				warnings: [e instanceof Error ? e.message : "本次更新失败"],
			});
		} finally {
			this.active = undefined;
			this.controller = undefined;
			this.stage = undefined;
		}
		const result = this.state();
		this.emit(result);
		return result;
	}
}

import type { Source } from "../shared/types.ts";
import { publicUrl, type WebReader } from "./public-web.ts";
import { searchPage, extractPage, hasQueryOverlap } from "./web-content.ts";
export { publicUrl } from "./public-web.ts";
export function queryForJobs(filters: {
	city: string;
	company: string;
	role: string;
}) {
	const parts = [filters.city, filters.company, filters.role]
		.map((s) => s.trim())
		.filter(Boolean);
	if (!parts.length) throw new Error("城市、企业、岗位至少填写一项。");
	return `${parts.join(" ")} 招聘 岗位 JD`;
}
export class Search {
	key: () => Promise<string>;
	readWeb?: WebReader;
	constructor(key: () => Promise<string>, readWeb?: WebReader) {
		this.key = key;
		this.readWeb = readWeb;
	}
	async request(
		endpoint: string,
		body: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		const key = await this.key();
		if (!key) throw new Error("未配置可选的 Tavily 搜索密钥。");
		const res = await fetch(`https://api.tavily.com/${endpoint}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: AbortSignal.any([
				...(signal ? [signal] : []),
				AbortSignal.timeout(30000),
			]),
		});
		if (!res.ok)
			throw new Error(
				`搜索服务请求失败（${res.status}），请检查密钥、额度或网络。`,
			);
		return (await res.json()) as Record<string, unknown>;
	}
	async search(query: string, signal?: AbortSignal): Promise<Source[]> {
		if (!query.trim() || query.length > 1000)
			throw new Error("搜索词须为 1～1000 字。");
		const reasons: string[] = [];
		if (await this.key()) {
			try {
				return await this.tavilySearch(query, signal);
			} catch (error) {
				signal?.throwIfAborted();
				reasons.push(
					`Tavily：${error instanceof Error ? error.message : "请求失败"}`,
				);
			}
		}
		if (!this.readWeb)
			throw new Error(
				`内置联网服务未启动，请重新打开应用。${reasons.join("；")}`,
			);
		let empty = false;
		for (const [engine, address] of [
			[
				"Bing",
				`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`,
			],
			[
				"DuckDuckGo",
				`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
			],
		] as const) {
			signal?.throwIfAborted();
			try {
				const rows = searchPage(await this.readWeb(address, signal), engine);
				if (rows.length && !hasQueryOverlap(rows, query))
					throw new Error("返回内容与查询词不匹配，正在尝试其他搜索引擎。");
				if (rows.length)
					return rows.map((row) => ({
						...row,
						...(reasons.length ? { fallbackReasons: reasons } : {}),
					}));
				empty = true;
				reasons.push(`${engine}：没有匹配结果`);
			} catch (error) {
				signal?.throwIfAborted();
				reasons.push(
					`${engine}：${error instanceof Error ? error.message : "请求失败"}`,
				);
			}
		}
		if (empty && reasons.every((reason) => reason.endsWith("没有匹配结果")))
			return [];
		throw new Error(`联网搜索未取得可用结果。${reasons.join("；")}`);
	}
	async tavilySearch(query: string, signal?: AbortSignal): Promise<Source[]> {
		const data = await this.request(
			"search",
			{
				query,
				search_depth: "advanced",
				max_results: 12,
				include_raw_content: false,
			},
			signal,
		);
		const seen = new Set<string>(),
			out: Source[] = [];
		for (const raw of Array.isArray(data.results) ? data.results : []) {
			const r = raw as Record<string, unknown>;
			try {
				const u = publicUrl(String(r.url));
				u.hash = "";
				for (const k of [...u.searchParams.keys()])
					if (k.startsWith("utm_")) u.searchParams.delete(k);
				if (seen.has(u.href)) continue;
				seen.add(u.href);
				out.push({
					title: String(r.title ?? u.hostname),
					url: u.href,
					content: String(r.content ?? "").slice(0, 12000),
					retrievedAt: new Date().toISOString(),
					publishedAt:
						typeof r.published_date === "string" ? r.published_date : undefined,
					kind: /nowcoder|zhihu|csdn|juejin|segmentfault/.test(u.hostname)
						? "community"
						: "web",
					fullText: false,
					searchEngine: "Tavily",
				});
			} catch {
				continue;
			}
		}
		return out;
	}
	async engineSearch(
		engine: "Tavily" | "Bing" | "DuckDuckGo",
		query: string,
		signal?: AbortSignal,
	): Promise<Source[]> {
		if (engine === "Tavily") return this.tavilySearch(query, signal);
		if (!this.readWeb) throw new Error("内置联网服务未启动。");
		const url =
			engine === "Bing"
				? `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`
				: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
		return searchPage(await this.readWeb(url, signal), engine);
	}
	async extract(input: string, signal?: AbortSignal): Promise<Source> {
		const url = publicUrl(input.trim()).href;
		const reasons: string[] = [];
		if (await this.key()) {
			try {
				return await this.tavilyExtract(url, signal);
			} catch (error) {
				signal?.throwIfAborted();
				reasons.push(
					`Tavily：${error instanceof Error ? error.message : "请求失败"}`,
				);
			}
		}
		if (!this.readWeb)
			throw new Error(
				`内置联网服务未启动，请重新打开应用。${reasons.join("；")}`,
			);
		const source = extractPage(await this.readWeb(url, signal));
		return {
			...source,
			...(reasons.length ? { fallbackReasons: reasons } : {}),
		};
	}
	async tavilyExtract(url: string, signal?: AbortSignal): Promise<Source> {
		const data = await this.request(
			"extract",
			{ urls: [url], format: "text" },
			signal,
		);
		const row = (data.results as { raw_content?: string }[] | undefined)?.[0];
		if (!row?.raw_content)
			throw new Error(
				"未能读取网页正文，可能有登录限制或页面不可用。请提供正文。",
			);
		return {
			title: new URL(url).hostname,
			url,
			content: row.raw_content.slice(0, 30000),
			retrievedAt: new Date().toISOString(),
			kind: "web",
			fullText: true,
			searchEngine: "Tavily",
		};
	}
	async jd(input: string): Promise<string> {
		if (!/^https?:\/\//i.test(input.trim())) return input.trim();
		return (await this.extract(input)).content;
	}
}

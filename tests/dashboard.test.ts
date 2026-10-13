import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { Search } from "../src/core/search.ts";
import {
	Dashboard,
	newsCandidates,
	parseNews,
	officialNewsUrl,
	selectNews,
	translatedNews,
	NEWS_LISTS,
} from "../src/core/dashboard.ts";
import type { DashboardState } from "../src/shared/types.ts";
import type { WebReader } from "../src/core/public-web.ts";
const now = new Date("2026-10-11T04:00:00Z");
const html = (
	slug: string,
	date = "2026-10-09",
	title = "New Agent memory model",
) => ({
	url: `https://www.langchain.com/blog/${slug}`,
	contentType: "text/html",
	body: `<html><head><title>${title}</title><meta property="article:published_time" content="${date}"></head><body><main><article><h1>${title}</h1><p>We are releasing new Agent memory and evaluation capabilities. The framework update introduces tool calling improvements for reliable agents. ${"Agent memory supports reliable workflows. ".repeat(8)}</p></article></main></body></html>`,
});
function setup(
	read?: WebReader,
	search = new Search(async () => ""),
	clock = () => now,
) {
	const dir = mkdtempSync(join(tmpdir(), "pi-dashboard-")),
		store = new Store(dir),
		events: DashboardState[] = [];
	const dashboard = new Dashboard(
		store,
		search,
		read,
		(state) => events.push(state),
		clock,
	);
	return {
		dir,
		store,
		events,
		dashboard,
		close() {
			dashboard.close();
			store.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
test("dashboard only trusts exact official hosts and repository release paths", () => {
	assert.ok(officialNewsUrl("https://openai.com/index/new-agent"));
	assert.ok(
		officialNewsUrl(
			"https://github.com/langchain-ai/langgraph/releases/tag/1.2",
		),
	);
	for (const u of [
		"https://openai.com.evil.org/index/model",
		"https://github.com/evil/repo/releases/tag/1",
		"http://openai.com/index/model",
		"https://127.0.0.1/news/x",
		"https://openai.com@evil.com/news/a",
		"https://www.langchain.com/careers",
		"https://www.langchain.com/blog/",
	])
		assert.equal(officialNewsUrl(u), undefined);
});
test("publication date is backed by metadata; unknown, old and future dates are excluded", () => {
	const good = parseNews(html("memory"), now);
	assert.equal(good.publishedAt.slice(0, 10), "2026-10-09");
	assert.equal(good.dateEvidence, "2026-10-09");
	assert.ok(good.evidence.includes("Agent"));
	for (const date of ["2026-01-01", "2027-01-01", "today", "invalid"]) {
		assert.throws(() => parseNews(html("bad", date), now));
	}
	assert.throws(() =>
		parseNews(
			{
				...html("bad"),
				body: html("bad").body.replace(
					'<meta property="article:published_time" content="2026-10-09">',
					"",
				),
			},
			now,
		),
	);
});
test("filter marketing, tutorials, hiring, unrelated pages, verification and empty bodies", () => {
	for (const title of [
		"Agent hiring and funding",
		"How to build an Agent tutorial",
		"New academy training engineers",
		"City tourism guide",
	]) {
		assert.throws(() => parseNews(html("bad", "2026-10-09", title), now));
	}
	assert.throws(() =>
		parseNews(
			{
				...html("a"),
				body: '<title>Just a moment</title><div id="challenge-form"></div>',
			},
			now,
		),
	);
	assert.throws(() =>
		parseNews(
			{
				...html("a"),
				body: '<h1>New Agent</h1><meta name="date" content="2026-10-09"><p>short</p>',
			},
			now,
		),
	);
});
test("overlay links use their own card title and date; malformed links cannot break discovery", () => {
	const candidates = newsCandidates(
		{
			url: "https://www.langchain.com/blog",
			contentType: "text/html",
			body: '<a href="http://[">broken</a><div class="blog-item"><h2>New Agent SDK release</h2><div>October 9, 2026</div><a href="/blog/sdk"></a></div><a href="/blog/how-to-agent">How to Agent tutorial</a>',
		},
		now,
	);
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].title, "New Agent SDK release");
	assert.ok(candidates[0].date);
});
test("three newest distinct events; supplementary 90-day item allowed without invented news", () => {
	const a = parseNews(html("a", "2026-10-09", "New Agent memory"), now),
		b = parseNews(html("b", "2026-09-01", "New Agent evaluation"), now),
		c = parseNews(html("c", "2026-10-07", "New Agent tools"), now);
	assert.deepEqual(
		selectNews([
			b,
			a,
			c,
			{ ...a, url: "https://www.langchain.com/blog/duplicate" },
		]).map((x) => x.id),
		[a.id, c.id, b.id],
	);
});
test("translation keeps source/date/evidence and rejects invented numbers or replaced quotes", () => {
	const rows = [parseNews(html("a"), now)];
	const input = [
		{
			id: rows[0].id,
			title: "Agent 记忆更新",
			summary: "框架新增记忆与评测能力。",
			quote: rows[0].evidence,
		},
	];
	assert.equal(translatedNews(rows, input)[0].url, rows[0].url);
	assert.equal(translatedNews(rows, input)[0].publishedAt, rows[0].publishedAt);
	assert.throws(() =>
		translatedNews(rows, [{ ...input[0], summary: "性能提高999倍" }]),
	);
	assert.throws(() => translatedNews(rows, [{ ...input[0], quote: "fake" }]));
	assert.throws(() =>
		translatedNews(rows, [{ ...input[0], title: "<script>坏</script>" }]),
	);
});
test("daily knowledge is offline, version-locked, same-day stable, rotates without modifying learning", () => {
	let date = now;
	const s = setup(undefined, undefined, () => date);
	try {
		s.store.put("plan", "test", { completed: 50 });
		s.store.put("chat", "test", { title: "existing" });
		const first = s.dashboard.state();
		assert.equal(first.portals.length, 17);
		assert.ok(
			["LLM", "RAG", "Agent", "框架", "评测", "部署"].includes(
				first.knowledge.category,
			),
		);
		assert.equal(s.dashboard.state().knowledge.id, first.knowledge.id);
		assert.notEqual(
			s.dashboard.nextKnowledge().knowledge.id,
			first.knowledge.id,
		);
		const selected = s.dashboard.state().knowledge.id;
		const restored = new Store(s.dir);
		const d = new Dashboard(
			restored,
			new Search(async () => ""),
			undefined,
			() => {},
			() => date,
		);
		assert.equal(d.state().knowledge.id, selected);
		restored.close();
		date = new Date("2026-10-12T04:00:00Z");
		assert.notEqual(s.dashboard.state().knowledge.id, selected);
		assert.deepEqual(s.store.get("plan", "test"), { completed: 50 });
		assert.deepEqual(s.store.get("chat", "test"), { title: "existing" });
	} finally {
		s.close();
	}
});
test("startup runs once, refresh calls merge, concurrency is bounded and results persist", async () => {
	let inFlight = 0,
		max = 0,
		calls = 0;
	const read: WebReader = async (url) => {
		calls++;
		inFlight++;
		max = Math.max(max, inFlight);
		await new Promise((r) => setTimeout(r, 5));
		inFlight--;
		if (NEWS_LISTS.includes(url))
			return {
				url,
				contentType: "text/html",
				body: [1, 2, 3]
					.map(
						(i) =>
							`<a href="https://www.langchain.com/blog/n${i}">New Agent tool ${i}</a>`,
					)
					.join(""),
			};
		return html(
			new URL(url).pathname.split("/").pop()!,
			"2026-10-09",
			`New Agent tool ${url.slice(-1)}`,
		);
	};
	const s = setup(read);
	try {
		s.dashboard.start();
		s.dashboard.start();
		const first = s.dashboard.refresh();
		assert.equal(first, s.dashboard.refresh());
		const result = await first;
		assert.equal(result.news.length, 3);
		assert.equal(result.status, "ready");
		assert.ok(max <= 3);
		assert.equal(calls, 9);
		assert.equal(s.events[0].status, "loading");
		assert.equal(s.events.at(-1)?.status, "ready");
		assert.equal(
			s.store.get<{ news: unknown[] }>("dashboard", "news")?.news.length,
			3,
		);
	} finally {
		s.close();
	}
});
test("daily updates persist before network work, survive restart and advance by local calendar date", async () => {
	let clock = new Date(2026, 9, 11, 23, 55), calls = 0;
	const read: WebReader = async () => { calls++; throw new Error("offline"); };
	const s = setup(read, undefined, () => clock);
	try {
		const first = s.dashboard.ensureUpdated();
		assert.equal(s.store.get<{ date: string }>("dashboard", "refresh-day")?.date, "2026-10-11");
		assert.equal(first, s.dashboard.ensureUpdated());
		await first;
		const count = calls;
		assert.ok(count > 0);
		await s.dashboard.ensureUpdated();
		s.dashboard.start();
		assert.equal(calls, count);
		// A separate database connection represents a backend restart after failure.
		const restored = new Store(s.dir);
		const restarted = new Dashboard(restored, new Search(async () => ""), read, () => {}, () => clock);
		try {
			await restarted.ensureUpdated();
			assert.equal(calls, count);
			clock = new Date(2026, 9, 12, 0, 1);
			await restarted.ensureUpdated();
			assert.ok(calls > count, "six minutes later is a new local day, not a 24-hour interval");
			const nextCount = calls;
			await restarted.ensureUpdated();
			assert.equal(calls, nextCount);
			await restarted.refresh();
			assert.ok(calls > nextCount, "manual retries remain available");
			const manualCount = calls;
			await restarted.ensureUpdated();
			assert.equal(calls, manualCount);
		} finally { restarted.close(); restored.close(); }
	} finally { s.close(); }
});

test("manual refresh satisfies today's automatic update and legacy cache uses local attempted date", async () => {
	let calls = 0;
	const clock = () => new Date(2026, 9, 11, 0, 30);
	const s = setup(async () => { calls++; throw new Error("offline"); }, undefined, clock);
	try {
		s.store.put("dashboard", "news", { news: [], status: "failed", attemptedAt: clock().toISOString(), warnings: [] });
		await s.dashboard.ensureUpdated();
		assert.equal(calls, 0);
		assert.equal(s.store.get<{ date: string }>("dashboard", "refresh-day")?.date, "2026-10-11");
		await s.dashboard.refresh();
		const manual = calls;
		await s.dashboard.ensureUpdated();
		assert.equal(calls, manual);
		s.store.remove("dashboard", "refresh-day");
		s.store.put("dashboard", "news", { news: [], status: "failed", attemptedAt: "not-a-date", warnings: [] });
		await s.dashboard.ensureUpdated();
		assert.ok(calls > manual, "invalid legacy timestamps cannot suppress updates");
	} finally { s.close(); }
});

test("interrupted update retains cache and daily marker without an automatic retry", async () => {
	const s = setup();
	try {
		const old = parseNews(html("old"), now);
		s.store.put("dashboard", "news", { news: [old], status: "loading", attemptedAt: now.toISOString(), updatedAt: now.toISOString(), warnings: [] });
		let calls = 0;
		const restored = new Dashboard(s.store, new Search(async () => ""), async () => { calls++; throw new Error("offline"); }, () => {}, () => now);
		const state = await restored.ensureUpdated();
		assert.equal(calls, 0);
		assert.equal(state.status, "failed");
		assert.deepEqual(state.news, [old]);
		assert.match(state.warnings[0], /中断/);
	} finally { s.close(); }
});

test("cross-midnight active calls merge and do not consume the next day's attempt", async () => {
	let clock = new Date(2026, 9, 11, 23, 59), release: () => void = () => {}, calls = 0;
	const gate = new Promise<void>(done => { release = done; });
	const s = setup(async () => { calls++; await gate; throw new Error("offline"); }, undefined, () => clock);
	try {
		const first = s.dashboard.ensureUpdated();
		clock = new Date(2026, 9, 12, 0, 1);
		assert.equal(first, s.dashboard.ensureUpdated());
		assert.equal(s.store.get<{ date: string }>("dashboard", "refresh-day")?.date, "2026-10-11");
		release();
		await first;
		const previous = calls;
		await s.dashboard.ensureUpdated();
		assert.ok(calls > previous);
		assert.equal(s.store.get<{ date: string }>("dashboard", "refresh-day")?.date, "2026-10-12");
	} finally { release(); s.close(); }
});

test("failed sources preserve last cache with actual failures and no fabricated placeholders", async () => {
	const s = setup(async () => {
		throw new Error("HTTP 429 / proxy unavailable");
	});
	try {
		const old = parseNews(html("old"), now);
		s.store.put("dashboard", "news", {
			news: [old],
			status: "ready",
			updatedAt: "2026-10-10T00:00:00Z",
			warnings: [],
		});
		const state = await s.dashboard.refresh();
		assert.equal(state.status, "failed");
		assert.deepEqual(state.news, [old]);
		assert.equal(state.updatedAt, "2026-10-10T00:00:00Z");
		assert.ok(state.warnings.some((w) => w.includes("429")));
		assert.ok(!s.events.some((s) => s.status === "ready"));
	} finally {
		s.close();
	}
});
test("search fallback supplies candidates only; snippets never become verified news", async () => {
	const search = new Search(async () => "");
	search.search = async () => [
		{
			title: "New Agent tools",
			url: "https://www.langchain.com/blog/search-result",
			content: "Invented search snippet",
			kind: "web",
			retrievedAt: now.toISOString(),
		},
	];
	let reads = 0;
	const s = setup(async (url) => {
		if (NEWS_LISTS.includes(url))
			return { url, body: "<html></html>", contentType: "text/html" };
		reads++;
		return html("search-result");
	}, search);
	try {
		const state = await s.dashboard.refresh();
		assert.equal(state.news.length, 1);
		assert.ok(!state.news[0].evidence.includes("Invented"));
		assert.equal(reads, 1);
		assert.equal(state.status, "partial");
	} finally {
		s.close();
	}
});
test("shutdown cancels pending network reads and can retry after cleanup", async () => {
	let aborted = 0;
	const s = setup(
		(url, signal) =>
			new Promise((_r, reject) => {
				const abort = () => {
					aborted++;
					reject(new Error("cancelled"));
				};
				if (signal?.aborted) abort();
				else signal?.addEventListener("abort", abort, { once: true });
			}),
	);
	try {
		const pending = s.dashboard.refresh();
		await new Promise((r) => setTimeout(r, 2));
		s.dashboard.close();
		const result = await pending;
		assert.equal(result.status, "failed");
		assert.ok(aborted > 0);
		assert.notEqual(result.status, "loading");
	} finally {
		s.close();
	}
});

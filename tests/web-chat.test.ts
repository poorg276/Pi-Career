import test from "node:test";
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	existsSync,
	readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	readPublicPage,
	publicUrl,
	publicIP,
	type WebPage,
} from "../src/core/public-web.ts";
import { searchPage, extractPage } from "../src/core/web-content.ts";
import { Search } from "../src/core/search.ts";
import { Chats, finishTurn } from "../src/core/chats.ts";
import { Store } from "../src/core/store.ts";
import type { AppEvent } from "../src/shared/types.ts";

const html = (
	body: string,
	url = "https://www.bing.com/search?q=test",
): WebPage => ({
	url,
	body: `<html><head><title>测试页面</title></head><body>${body}</body></html>`,
	contentType: "text/html; charset=utf-8",
});
const bing = `<ol id="b_results"><li class="b_ad"><h2><a href="https://ads.example.com">广告</a></h2></li><li class="b_algo"><h2><a href="https://example.com/article?utm_source=bing">真实标题 &amp; 来源</a></h2><div class="b_caption"><p>正文摘要，日期未提供。</p></div></li><li class="b_algo"><h2><a href="https://example.com/article">重复项</a></h2></li><li class="b_algo"><h2><a href="http://127.0.0.1">本机</a></h2></li></ol>`;
const duck = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fnews">Agent 备用结果</a><a class="result__snippet">真实摘要</a></div>`;
const article = `<article><h1>可读正文</h1>${Array.from({ length: 8 }, (_, i) => `<p>第 ${i + 1} 段。这里是用于验证网页正文提取的独立测试资料，包含足够的文字，使其与菜单、广告和登录页面区别开来。</p>`).join("")}</article><script>globalThis.secret='NEVER_EXECUTED'</script>`;

test("public search parses organic results, deduplicates, unwraps links and never invents dates", () => {
	const rows = searchPage(html(bing), "Bing");
	assert.equal(rows.length, 1);
	assert.equal(rows[0].url, "https://example.com/article");
	assert.equal(rows[0].title, "真实标题 & 来源");
	assert.equal(rows[0].publishedAt, undefined);
	assert.equal(rows[0].fullText, false);
	assert.equal(rows[0].searchEngine, "Bing");
	const url = "https://example.org/中文";
	const redirect = `https://www.bing.com/ck/a?u=a1${Buffer.from(url).toString("base64url")}`;
	assert.equal(
		searchPage(
			html(
				`<ol id="b_results"><li class="b_algo"><h2><a href="${redirect}">转跳</a></h2></li></ol>`,
			),
			"Bing",
		)[0].url,
		new URL(url).href,
	);
	assert.equal(
		searchPage(html(duck), "DuckDuckGo")[0].url,
		"https://example.org/news",
	);
	assert.deepEqual(
		searchPage(html('<li class="b_no">没有找到匹配结果</li>'), "Bing"),
		[],
	);
	assert.throws(
		() => searchPage(html('<form id="challenge-form">验证</form>'), "Bing"),
		/验证/,
	);
	assert.throws(
		() => searchPage(html("<div>Changed layout</div>"), "Bing"),
		/格式/,
	);
});
test("keyless search falls back and reports actual engine; cancellation does not start another engine", async () => {
	const calls: string[] = [];
	const search = new Search(
		async () => "",
		async (url) => {
			calls.push(url);
			if (url.includes("bing")) throw new Error("HTTP 429");
			return html(duck, url);
		},
	);
	const rows = await search.search("中文 Agent");
	assert.equal(calls.length, 2);
	assert.equal(rows[0].searchEngine, "DuckDuckGo");
	assert.match(rows[0].fallbackReasons![0], /429/);
	const controller = new AbortController();
	let count = 0;
	const cancelled = new Search(
		async () => "",
		async () => {
			count++;
			controller.abort();
			throw controller.signal.reason;
		},
	);
	await assert.rejects(cancelled.search("test", controller.signal), /abort/i);
	assert.equal(count, 1);
});
test("Tavily failure can use built-in search and direct extraction without leaking API credentials", async () => {
	const search = new Search(
		async () => "test-secret",
		async (url) => html(url.includes("bing") ? bing : article, url),
	);
	search.request = async () => {
		throw new Error("HTTP 401");
	};
	const rows = await search.search("真实");
	assert.equal(rows[0].searchEngine, "Bing");
	assert.ok(!JSON.stringify(rows).includes("test-secret"));
	const page = await search.extract("https://example.com/article");
	assert.equal(page.fullText, true);
	assert.match(page.content, /第 1 段/);
	assert.equal(page.searchEngine, "直接读取");
});
test("extracts readable content with no execution and distinguishes empty/unsupported pages", () => {
	const source = extractPage(html(article, "https://example.com/article"));
	assert.ok(source.content.length > 100);
	assert.ok(!source.content.includes("NEVER_EXECUTED"));
	assert.equal(source.publishedAt, undefined);
	assert.throws(
		() => extractPage(html("<nav>菜单</nav><div id='app'></div>")),
		/正文不足/,
	);
	assert.throws(
		() => extractPage(html("<form id='challenge-form'>验证</form>")),
		/验证/,
	);
	assert.equal(
		extractPage({
			url: "https://example.org/doc",
			body: "纯文本",
			contentType: "text/plain",
		}).content,
		"纯文本",
	);
});
test("unrelated result pages trigger a second engine instead of reporting search success", async () => {
	const search = new Search(
		async () => "",
		async (url) => html(url.includes("bing") ? bing : duck, url),
	);
	const rows = await search.search("Agent");
	assert.equal(rows[0].searchEngine, "DuckDuckGo");
	assert.match(rows[0].fallbackReasons![0], /不匹配/);
});
test("rejects private hosts, encoded addresses, credentials, IPv6 tunnels and non-web protocols", () => {
	for (const url of [
		"http://127.1",
		"http://2130706433",
		"http://0x7f000001",
		"http://[::1]",
		"http://[::ffff:127.0.0.1]",
		"http://192.168.0.1",
		"http://100.64.1.1",
		"http://169.254.169.254",
		"http://localhost./",
		"http://box.local",
		"file:///secret",
		"https://u:p@example.com",
		"https://example.com:8080",
	])
		assert.throws(() => publicUrl(url), /公开网页/, url);
	assert.ok(publicIP("8.8.8.8"));
	assert.ok(publicIP("2606:4700:4700::1111"));
	assert.ok(!publicIP("2001:db8::1"));
});
test("checks DNS and each redirect before sending; caps response sizes and content types", async () => {
	let sent = 0;
	await assert.rejects(
		readPublicPage(
			"https://public.example.org",
			async () => {
				sent++;
				return new Response("ok");
			},
			async () => ["127.0.0.1"],
		),
		/非公开/,
	);
	assert.equal(sent, 0);
	await assert.rejects(
		readPublicPage(
			"https://example.org",
			async () => {
				sent++;
				return new Response(null, {
					status: 302,
					headers: { location: "http://127.0.0.1/private" },
				});
			},
			async () => ["8.8.8.8"],
		),
		/公开网页/,
	);
	assert.equal(sent, 1);
	for (const [response, pattern] of [
		[
			new Response("PDF", { headers: { "content-type": "application/pdf" } }),
			/文件类型/,
		],
		[new Response("x", { status: 429 }), /限流/],
		[new Response("x", { status: 403 }), /403/],
		[
			new Response("x", {
				headers: { "content-type": "text/html", "content-length": "9999999" },
			}),
			/过大/,
		],
	] as const)
		await assert.rejects(
			readPublicPage(
				"https://example.org",
				async () => response,
				async () => ["8.8.8.8"],
			),
			pattern,
		);
	const result = await readPublicPage(
		"https://example.org",
		async () =>
			new Response("实际正文", {
				headers: { "content-type": "text/plain; charset=utf-8" },
			}),
		async () => ["8.8.8.8"],
	);
	assert.equal(result.body, "实际正文");
});
test("timeout and cancellation settle hung requests and DNS", async () => {
	const hold = setTimeout(() => {}, 1000);
	try {
		await assert.rejects(
			readPublicPage(
				"https://example.org",
				() => new Promise(() => {}),
				async () => ["8.8.8.8"],
				undefined,
				15,
			),
			/超时/,
		);
		const controller = new AbortController();
		const task = readPublicPage(
			"https://example.org",
			async () => new Response("x"),
			() => new Promise(() => {}),
			controller.signal,
		);
		controller.abort();
		await assert.rejects(task, /abort/i);
	} finally {
		clearTimeout(hold);
	}
});
test("deleted chats cannot be resurrected by streaming saves, and only their private session file is removed", () => {
	const dir = mkdtempSync(join(tmpdir(), "picareer-delete-")),
		root = join(dir, "sessions"),
		project = join(dir, "project");
	mkdirSync(root);
	mkdirSync(project);
	const events: AppEvent[] = [],
		store = new Store(dir),
		chats = new Chats(store, (e) => events.push(e), root);
	const c = chats.create(project);
	const file = join(root, "one.jsonl"),
		work = join(project, "important.txt");
	writeFileSync(file, "session");
	writeFileSync(work, "keep");
	c.sessionFile = file;
	c.run = { turnId: "turn", status: "running" };
	chats.save(c);
	chats.beginDelete(c.id);
	c.messages.push({ role: "assistant", text: "late output" });
	chats.save(c, true);
	assert.throws(() => chats.get(c.id), /删除/);
	chats.remove(c.id);
	chats.remove(c.id);
	chats.save(c, true);
	assert.equal(chats.list().length, 0);
	assert.equal(existsSync(file), false);
	assert.equal(readFileSync(work, "utf8"), "keep");
	store.close();
	const reopened = new Store(dir);
	assert.equal(new Chats(reopened, () => {}, root).list().length, 0);
	reopened.close();
	assert.ok(events.some((e) => e.type === "chatDeleted"));
});
test("interrupted deletion completes after restart; shared or outside session files are preserved", () => {
	const dir = mkdtempSync(join(tmpdir(), "picareer-delete-recovery-")),
		root = join(dir, "sessions");
	mkdirSync(root);
	let store = new Store(dir),
		chats = new Chats(store, () => {}, root);
	const a = chats.create(),
		b = chats.create();
	const shared = join(root, "shared.jsonl");
	writeFileSync(shared, "shared");
	a.sessionFile = b.sessionFile = shared;
	chats.save(a);
	chats.save(b);
	chats.beginDelete(a.id);
	store.close();
	store = new Store(dir);
	chats = new Chats(store, () => {}, root);
	assert.equal(chats.list().length, 1);
	assert.ok(existsSync(shared));
	const outside = join(dir, "protected.jsonl");
	writeFileSync(outside, "keep");
	b.sessionFile = outside;
	chats.save(b);
	assert.throws(() => chats.beginDelete(b.id), /路径异常/);
	assert.ok(existsSync(outside));
	store.close();
});
test("end records persist once per turn with unknown usage and recovered interruption", () => {
	const dir = mkdtempSync(join(tmpdir(), "picareer-turn-")),
		store = new Store(dir),
		chats = new Chats(store, () => {}),
		c = chats.create();
	c.run = { turnId: "t1", status: "complete" };
	finishTurn(c, "catalog-model", {
		tokens: 1000,
		contextWindow: 10000,
		percent: 10,
	});
	finishTurn(c);
	assert.equal(c.turns!.length, 1);
	c.run = { turnId: "t2", status: "complete" };
	finishTurn(c, "catalog-model", {
		tokens: null,
		contextWindow: 10000,
		percent: null,
	});
	c.run = { turnId: "t3", status: "running" };
	chats.save(c);
	store.close();
	const reopened = new Store(dir),
		recovered = new Chats(reopened, () => {}).get(c.id);
	assert.deepEqual(
		recovered.turns!.map((t) => t.status),
		["complete", "complete", "interrupted"],
	);
	assert.equal(recovered.turns![1].context!.tokens, null);
	reopened.close();
});
test("an unsafe pending cleanup cannot delete outside files or prevent other chats from opening", () => {
	const dir = mkdtempSync(join(tmpdir(), "picareer-cleanup-")),
		root = join(dir, "sessions");
	mkdirSync(root);
	const store = new Store(dir),
		chats = new Chats(store, () => {}, root),
		kept = chats.create();
	const outside = join(dir, "outside.jsonl");
	writeFileSync(outside, "keep");
	store.put("deleted-chat", "pending", {
		id: "pending",
		pending: true,
		sessionFile: outside,
	});
	const events: AppEvent[] = [],
		recovered = new Chats(store, (e) => events.push(e), root);
	assert.equal(recovered.get(kept.id).id, kept.id);
	assert.ok(existsSync(outside));
	assert.ok(events.some((e) => e.type === "notice"));
	store.close();
});

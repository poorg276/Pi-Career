import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chats, normalizeChat } from "../src/core/chats.ts";
import { Store } from "../src/core/store.ts";
import { currentTime, weather } from "../src/core/general-tools.ts";
import { Search } from "../src/core/search.ts";
import { createServiceFetch } from "../src/core/service-network.ts";
import type { AppEvent } from "../src/shared/types.ts";

test("chat metadata survives streaming writes, legacy messages and restart interruption", () => {
	const dir = mkdtempSync(join(tmpdir(), "picareer-chat-")),
		events: AppEvent[] = [];
	const store = new Store(dir),
		chats = new Chats(store, (e) => events.push(e));
	const c = chats.create();
	c.messages.push({ role: "user", text: "hello" });
	c.run = { turnId: "turn", status: "running" };
	chats.save(c);
	assert.throws(() => chats.directory(c.id, dir), /停止/);
	chats.rename(c.id, " 已重命名 ");
	c.title = "old title";
	chats.save(c, true);
	assert.equal(chats.get(c.id).title, "已重命名");
	for (const name of [" ", "a\nb", "字".repeat(81)])
		assert.throws(() => chats.rename(c.id, name));
	const legacy = normalizeChat({
		id: "legacy",
		title: "old",
		updatedAt: "old",
		messages: [{ role: "user", text: "历史消息" }],
	});
	assert.equal(legacy.entries![0].text, "历史消息");
	assert.equal(normalizeChat(legacy).entries![0].id, "legacy-0");
	store.close();
	const restored = new Store(dir),
		again = new Chats(restored, () => {});
	assert.equal(again.get(c.id).run?.status, "interrupted");
	assert.equal(again.get(c.id).messages[0].text, "hello");
	const project = join(dir, "中文 项目");
	mkdirSync(project);
	assert.equal(again.directory(c.id, project).cwd, project);
	assert.ok(events.every((event) => event.type === "chatUpdate"));
	restored.close();
});

test("time comes from system clock and includes a timezone and weekday", () => {
	const value = currentTime(new Date("2026-10-10T00:00:00Z"));
	assert.equal(value.utc, "2026-10-10T00:00:00.000Z");
	assert.ok(value.timeZone);
	assert.match(value.weekday, /星期/);
});
test("weather geocodes locations, reports ambiguity and preserves dates, units and sources", async (t) => {
	const location = {
		id: 1,
		name: "长沙",
		latitude: 28.2,
		longitude: 112.9,
		feature_code: "PPLA",
		country: "中国",
	};
	const calls: string[] = [];
	let ambiguous = false;
	t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
		const url = new URL(String(input));
		calls.push(url.href);
		if (url.pathname === "/v1/search")
			return Response.json({
				results: ambiguous ? [location, { ...location, id: 2 }] : [location],
			});
		if (url.pathname === "/v1/get") return Response.json(location);
		return Response.json({
			current: { time: "2026-10-10T10:00", temperature_2m: 21 },
			current_units: { temperature_2m: "°C" },
			daily: { time: ["2026-10-10"] },
			timezone: "Asia/Shanghai",
		});
	});
	const value = (await weather("长沙")) as Record<string, unknown>;
	assert.equal(new URL(calls[0]).searchParams.get("name"), "长沙市");
	assert.match(String(value.source), /模型/);
	assert.match(String(value.url), /^https:\/\/api.open-meteo.com/);
	assert.deepEqual(value.current_units, { temperature_2m: "°C" });
	ambiguous = true;
	const count = calls.length;
	const candidates = (await weather("长沙")) as Record<string, unknown>;
	assert.equal(candidates.needsClarification, true);
	assert.equal(calls.length, count + 1);
	assert.ok(((await weather("长沙", 1)) as Record<string, unknown>).current);
});
test("weather failure and cancellation never return invented results", async (t) => {
	t.mock.method(
		globalThis,
		"fetch",
		async () => new Response("", { status: 429 }),
	);
	await assert.rejects(weather("长沙"), /429/);
});
test("search and extraction preserve cancellation and report an unavailable desktop transport", async (t) => {
	await assert.rejects(
		new Search(async () => "").search("query"),
		/内置联网服务未启动/,
	);
	const controller = new AbortController();
	t.mock.method(
		globalThis,
		"fetch",
		async (_input: unknown, init: RequestInit) => {
			assert.ok(init.signal);
			controller.abort();
			init.signal!.throwIfAborted();
			return Response.json({});
		},
	);
	await assert.rejects(
		new Search(async () => "fixture").extract(
			"https://example.com",
			controller.signal,
		),
		/abort/i,
	);
});
test("new service traffic uses selected proxy and fails closed without affecting other domains", async () => {
	const origins: string[] = [];
	let calls = 0;
	const network = createServiceFetch(
		async (origin) => {
			origins.push(origin);
			return "SOCKS 127.0.0.1:1";
		},
		(async () => {
			calls++;
			return new Response("unrelated");
		}) as typeof fetch,
	);
	try {
		await assert.rejects(
			network.fetch("https://api.open-meteo.com/v1/forecast"),
			/代理/,
		);
		assert.equal(calls, 0);
		assert.deepEqual(origins, ["https://api.open-meteo.com"]);
		assert.equal(
			await (await network.fetch("https://example.com")).text(),
			"unrelated",
		);
		assert.equal(calls, 1);
	} finally {
		await network.close();
	}
});

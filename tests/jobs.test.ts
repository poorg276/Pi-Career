import { test } from "node:test";
import assert from "node:assert/strict";
import {
	JobSearch,
	classifyPosting,
	jobDocument,
	jobQueries,
} from "../src/core/jobs.ts";
import { Search } from "../src/core/search.ts";
import type { JobFilters, Source } from "../src/shared/types.ts";
const filters = { company: "华为", city: "长沙", role: "Agent 开发工程师" };
const make = (
	overrides: Partial<{
		company: string;
		city: string;
		role: string;
		description: string;
	}> = {},
) => {
	const fields = {
		company: "华为技术有限公司",
		city: "长沙市",
		role: "Agent 开发工程师",
		description:
			"负责智能体研发、工具调用与状态管理，开发可靠的大模型应用与自动化工作流，要求熟练掌握 Python。",
		...overrides,
	};
	const labels = {
		company: "招聘企业",
		city: "工作地点",
		role: "职位名称",
		description: "岗位职责",
	};
	const p: any = { block: "" };
	for (const k of Object.keys(fields) as (keyof typeof fields)[]) {
		p[k] = { value: fields[k], quote: `${labels[k]}：${fields[k]}` };
		p.block += p[k].quote + "\n";
	}
	const source: Source = {
		url: "https://example.com/job/1",
		title: fields.role + " 招聘",
		content: p.block,
		fullText: true,
		kind: "web",
		retrievedAt: new Date().toISOString(),
	};
	return { p, source };
};
test("job query variants preserve independent constraints and limit six groups", () => {
	for (const f of [
		filters,
		{ city: "长沙", company: "", role: "" },
		{ city: "", company: "华为", role: "" },
		{ city: "", company: "", role: "Agent" },
	]) {
		const q = jobQueries(f);
		assert.ok(q.length <= 6);
		for (const row of q)
			for (const key of ["city", "company"] as const)
				if (f[key]) assert.ok(row.includes(f[key]));
	}
	assert.throws(() => jobQueries({ city: " ", company: "", role: "" }));
});
test("job matching requires all evidence; city-only and company-only remain usable", () => {
	const { p, source } = make();
	assert.equal(classifyPosting(source, p, filters)?.score! >= 100, true);
	for (const f of [
		{ city: "长沙", company: "", role: "" },
		{ city: "", company: "华为", role: "" },
		{ city: "", company: "", role: "Agent" },
	])
		assert.ok(classifyPosting(source, p, f)?.score! >= 100);
	const other = make({ city: "深圳" });
	assert.equal(
		classifyPosting(other.source, other.p, filters)?.match?.city,
		"different",
	);
});
test("encyclopedias, travel and unsubstantiated fields never become strict jobs", () => {
	const { p, source } = make();
	for (const title of ["长沙市 百度百科", "2025长沙旅游攻略"])
		assert.equal(classifyPosting({ ...source, title }, p, filters), undefined);
	const forged = {
		...p,
		city: { value: "长沙", quote: "工作地点：长沙（编造）" },
	};
	assert.equal(
		classifyPosting(source, forged, filters)?.match?.city,
		"unknown",
	);
	assert.equal(
		classifyPosting(source, { ...p, block: p.block + "invented" }, filters),
		undefined,
	);
});
test("partner references and navigation locations cannot identify employer or job city", () => {
	const other = make({ company: "拓维信息系统股份有限公司" });
	const job = classifyPosting(other.source, other.p, filters)!;
	assert.equal(job.company, "拓维信息系统股份有限公司");
	assert.equal(job.match?.company, "different");
	const { p, source } = make();
	p.company.quote = "华为生态伙伴";
	p.company.value = "华为";
	p.city.quote = "筛选城市：长沙";
	p.city.value = "长沙";
	p.block += "华为生态伙伴\n筛选城市：长沙";
	source.content = p.block;
	const j = classifyPosting(source, p, filters)!;
	assert.equal(j.match?.company, "unknown");
	assert.equal(j.match?.city, "unknown");
	p.block += "职位搜索 不限";
	source.content = p.block;
	assert.equal(classifyPosting(source, p, filters), undefined);
});
test("Agent role can match explicit responsibilities but not generic AI", () => {
	let f = make({ role: "AI 应用工程师" });
	assert.equal(classifyPosting(f.source, f.p, filters)?.match?.role, "matched");
	f = make({
		role: "AI 应用工程师",
		description:
			"负责大模型服务的运行维护以及后端应用开发，熟悉 Python 编程和基本数据库管理，需要优秀的沟通能力。",
	});
	assert.equal(classifyPosting(f.source, f.p, filters), undefined);
	f = make({role: "全栈开发工程师", description: "负责业务前后端开发、微服务维护和常规接口设计，保障业务系统稳定运行。任职要求：有相关Agent开发经验者优先。"});
	assert.equal(classifyPosting(f.source, f.p, filters), undefined);
});
test("summary evidence stays related; unknown fields are not silently filled", () => {
	const { p, source } = make();
	const job = classifyPosting({ ...source, fullText: false }, p, filters)!;
	assert.ok(job.score < 100);
	assert.equal(job.jd, undefined);
	delete p.city;
	assert.equal(classifyPosting(source, p, filters)?.city, "未提供");
});
test("structured postings remain separate and missing location cannot leak from a menu", () => {
	const page = {
		url: "https://example.com/jobs",
		contentType: "text/html",
		body: `<html><head><title>招聘列表</title><script type="application/ld+json">${JSON.stringify(
			{
				"@graph": [
					{
						"@type": "JobPosting",
						title: "Agent 开发工程师",
						description:
							"负责智能体研发与应用开发，熟悉多步工具调用、上下文管理、评测和可靠性工程，有 Python 实战经验。",
						hiringOrganization: { name: "华为技术有限公司" },
						jobLocation: { address: { addressLocality: "深圳" } },
					},
					{
						"@type": "JobPosting",
						title: "旅游顾问",
						description: "负责旅游业务",
					},
				],
			},
		)}</script></head><body>长沙城市导航</body></html>`,
	};
	const doc = jobDocument(page);
	assert.equal(doc.structured.length, 2);
	assert.equal(
		classifyPosting(doc.source, doc.structured[0], filters, true)?.match?.city,
		"different",
	);
});
function fixture(extract?: any) {
	const search = new Search(async () => "");
	const { p, source } = make();
	let calls: string[] = [];
	search.engineSearch = async (engine) => {
		calls.push(engine);
		return engine === "Bing"
			? [{ ...source, title: "长沙市 百度百科" }]
			: [source, source];
	};
	const flow = new JobSearch(search, extract);
	flow.document = async () => ({ source, structured: [p] });
	return { flow, search, calls, p, source };
}
test("irrelevant primary engine falls through and repeated job URLs deduplicate", async () => {
	const f = fixture();
	const r = await f.flow.run(
		filters,
		"x",
		new AbortController().signal,
		() => {},
	);
	assert.equal(r.matched.length, 1);
	assert.ok(f.calls.includes("DuckDuckGo"));
	assert.ok(r.portals.length);
	assert.equal(r.related.length, 0);
});
test("unreadable pages and unavailable model do not turn guesses into jobs", async () => {
	const f = fixture();
	f.flow.document = async () => {
		throw new Error("blocked");
	};
	const r = await f.flow.run(
		filters,
		"x",
		new AbortController().signal,
		() => {},
	);
	assert.equal(r.matched.length, 0);
	assert.ok(r.warnings.length);
});
test("job deadline and cancellation settle and keep only already verified results", async () => {
	for (const cancel of [true, false]) {
		const f = fixture(),
			c = new AbortController();
		f.search.engineSearch = async (_e, _q, s) =>
			new Promise((_resolve, reject) => {
				s!.addEventListener("abort", () => reject(s!.reason), { once: true });
			});
		const timer = setTimeout(() => {
			if (cancel) c.abort();
		}, 20);
		// Keep node alive while AbortSignal.timeout uses its unref'ed timer.
		const hold = setInterval(() => {}, 100);
		try {
			const r = await f.flow.run(filters, "x", c.signal, () => {}, 40);
			assert.equal(r.status, cancel ? "cancelled" : "timeout");
			assert.equal(r.matched.length, 0);
		} finally {
			clearTimeout(timer);
			clearInterval(hold);
		}
	}
});
test("job handoff revalidates a specific posting and rejects a generic article", async () => {
	const f = fixture(),
		job = classifyPosting(f.source, f.p, filters)!;
	assert.equal(
		(await f.flow.prepare(job, new AbortController().signal)).status,
		"ready",
	);
	f.flow.document = async () => ({
		source: { ...f.source, content: "这是长沙城市介绍，与招聘无关。" },
		structured: [],
	});
	const r = await f.flow.prepare(
		{ ...job, pageType: undefined },
		new AbortController().signal,
	);
	assert.equal(r.status, "needs_input");
	assert.equal(r.text, "");
});

test("multi-posting text cannot join one employer with another role or city", () => {
	const a = make({ city: "深圳" }),
		b = make({ company: "其他科技有限公司" });
	const block = a.p.block + b.p.block;
	const source = { ...a.source, content: block };
	const fake = { ...a.p, block, city: b.p.city };
	assert.equal(classifyPosting(source, fake, filters), undefined);
});
test("structured partner employer is not a Huawei strict match", () => {
	const { p, source } = make({ company: "华为生态伙伴招聘" });
	assert.equal(
		classifyPosting(source, p, filters, true)?.match?.company,
		"different",
	);
});
test("six query groups, twenty-four documents and concurrency three bound a search", async () => {
	const f = fixture();
	let active = 0,
		peak = 0,
		reads = 0;
	const queries = new Set<string>();
	f.search.key = async () => "optional-key";
	f.search.engineSearch = async (engine, q) => {
		queries.add(q);
		return Array.from({ length: 20 }, (_, i) => ({
			...f.source,
			url: `https://example.com/${engine}/job/${i}`,
		}));
	};
	f.flow.document = async (url) => {
		reads++;
		peak = Math.max(peak, ++active);
		await new Promise((r) => setTimeout(r, 2));
		active--;
		return { source: { ...f.source, url }, structured: [] };
	};
	f.flow.postings = async () => ({ pageType: "irrelevant", postings: [] });
	const r = await f.flow.run(
		filters,
		"limits",
		new AbortController().signal,
		() => {},
	);
	assert.equal(reads, 24);
	assert.ok(peak <= 3);
	assert.ok(queries.size <= 6);
	assert.equal(r.matched.length, 0);
});
test("model inventions and model unavailability cannot create a matched result", async () => {
	for (const unavailable of [true, false]) {
		const f = fixture(async () => {
			if (unavailable) throw new Error("model unavailable");
			return JSON.stringify({ pageType: "posting", postings: [f.p] });
		});
		f.flow.document = async () => ({
			source: {
				...f.source,
				content: "公开招聘：实际正文没有对应职位、工作地点和企业证据。",
			},
			structured: [],
		});
		const r = await f.flow.run(
			filters,
			"model",
			new AbortController().signal,
			() => {},
		);
		assert.equal(r.matched.length, 0);
		assert.equal(r.related.length, 0);
	}
});

test("identical postings on different URLs collapse without joining evidence", async () => {
	const f = fixture();
	f.search.engineSearch = async () => [
		f.source,
		{ ...f.source, url: "https://example.com/job/mirror" },
	];
	f.flow.document = async (url) => ({
		source: { ...f.source, url },
		structured: [f.p],
	});
	const r = await f.flow.run(
		filters,
		"dupe",
		new AbortController().signal,
		() => {},
	);
	assert.equal(r.matched.length, 1);
});

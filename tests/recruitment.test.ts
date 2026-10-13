import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Search } from "../src/core/search.ts";
import { JobSearch, classifyPosting } from "../src/core/jobs.ts";
import { zhiyeDocuments } from "../src/core/zhiye-jobs.ts";
import { companyIdentity, knownPortals, officialEmployer } from "../src/core/recruitment.ts";
import { validateRecruitmentRequest, WebError } from "../src/core/public-web.ts";
import { Store } from "../src/core/store.ts";

const portal = "https://wondersharecampus.zhiye.com/campus/jobs";
const fields = { city: "", company: "万兴科技", role: "" };
const row = (i: number, override: Record<string, unknown> = {}) => ({
	Id: `00000000-0000-4000-8000-${String(i).padStart(12,"0")}`,
	JobAdId: 100+i, Status: 1, CategoryId: "2", JobAdName: `Agent开发工程师${i}`,
	LocNames: ["湖南省·长沙市"], PostDate: `2026-10-${String(i+1).padStart(2,"0")}T10:00:00`,
	Duty: "负责AI Agent应用架构设计和核心开发，构建工具调用、任务规划、记忆管理以及可靠的RAG检索系统。",
	Require: "掌握Python与软件工程，熟悉多步工作流编排、测试和大模型应用工程。", ...override,
});
const data = (rows: unknown[], count=rows.length) => ({ Code: 200, Data: rows, Count: count });
const search = (rows: unknown[]) => {
	const calls: unknown[] = [];
	const s = new Search(async () => "", async (url, signal, request) => {
		signal?.throwIfAborted(); calls.push({url,request});
		return { url, contentType: "application/json", body: JSON.stringify(data(rows)) };
	});
	s.engineSearch = async () => []; return { s, calls };
};

test("official identity includes aliases but never grants generic ATS host trust", () => {
	assert.equal(companyIdentity("Wondershare"), "万兴科技");
	assert.equal(companyIdentity("万兴"), "万兴科技");
	assert.equal(officialEmployer(portal), "万兴科技");
	assert.equal(officialEmployer("https://other.zhiye.com/"), undefined);
	assert.ok(knownPortals("万兴").every(p => p.verificationSource && p.associationEvidence));
	for (const url of ["https://other.zhiye.com/api/Jobad/GetJobAdPageList", "https://wondersharecampus.zhiye.com/api/delete", "http://127.0.0.1/api/Jobad/GetJobAdPageList"])
		assert.throws(() => validateRecruitmentRequest(url, {pageIndex:0,category:"2"}));
	assert.throws(() => validateRecruitmentRequest("https://wondersharecampus.zhiye.com/api/Jobad/GetJobAdPageList", {pageIndex:5,category:"2"}));
});
test("public job rows carry independent, complete JD evidence and do not invent missing fields", () => {
	const parsed = zhiyeDocuments(portal,data([row(0), row(1,{Duty:""}), row(2,{Status:0}), row(3,{LocNames:[],PostDate:"unknown"})]));
	assert.equal(parsed.documents.length,2);
	const doc=parsed.documents[0];
	const j=classifyPosting(doc.source,doc.structured[0],{...fields,city:"长沙",role:"Agent开发"},true)!;
	assert.ok(j.score>=100); assert.match(j.jd!,/任职要求/); assert.equal(j.publishedAt,"2026-10-01");
	assert.ok(j.url.endsWith("jobAdId=00000000-0000-4000-8000-000000000000"));
	assert.equal(classifyPosting(parsed.documents[1].source,parsed.documents[1].structured[0],{...fields,city:"长沙"},true)?.match?.city,"unknown");
	assert.throws(() => zhiyeDocuments(portal,{Code:200,Data:{}}),/格式已变化/);
});
test("company-only collects strongest ten from a full official page without a model or search key", async () => {
	const {s,calls}=search(Array.from({length:20},(_,i)=>row(i)));
	const flow=new JobSearch(s,async()=>{throw new Error("Model must not be needed");});
	let early=false; const result=await flow.run(fields,"company",new AbortController().signal,(_stage,portals)=>{if(portals?.length && calls.length===0)early=true;});
	assert.equal(result.matched.length,10); assert.equal(result.matched[0].publishedAt,"2026-10-20");
	assert.equal(calls.length,1); assert.ok(early); assert.ok(result.matched.every(j=>j.company==="万兴科技" && j.verification==="verified"));
	assert.equal((await flow.prepare(result.matched[0],new AbortController().signal)).status,"ready");
});
test("official rows preserve city and role constraints, fall through search and never pad", async () => {
	const {s}=search([row(0),row(1,{JobAdName:"产品经理",Duty:"负责用户研究、市场分析和产品需求整理，为业务团队制定产品计划并协调项目进度。"}),row(2,{LocNames:["深圳"]})]);
	const engines:string[]=[];s.engineSearch=async engine=>{engines.push(engine);return [];};
	const result=await new JobSearch(s).run({...fields,city:"长沙",role:"Agent开发"},"filtered",new AbortController().signal,()=>{});
	assert.equal(result.matched.length,1); assert.equal(result.related.length,1); assert.deepEqual(engines.includes("DuckDuckGo"),true);
});
test("official failure retains portal evidence and diagnostics across a restart", async () => {
	const dir=mkdtempSync(join(tmpdir(),"picareer-portal-test-"));let store=new Store(dir);
	const s=new Search(async()=>"",async()=>{throw new WebError("PROXY","系统代理连接失败；未绕过代理。");});s.engineSearch=async()=>[];
	let result=await new JobSearch(s,undefined,store).run(fields,"offline",new AbortController().signal,()=>{});
	assert.equal(result.matched.length,0); assert.ok(result.diagnostics?.some(d=>d.code==="PROXY"));
	assert.ok(result.portals.some(p=>p.readStatus==="failed"));store.close();store=new Store(dir);
	try {result=await new JobSearch(s,undefined,store).run(fields,"restart",new AbortController().signal,()=>{});assert.ok(result.portals.length===2);}finally{store.close();}
});
test("a partial official page survives cancellation and its portal is still returned", async () => {
	const controller=new AbortController();const {s}=search([row(0)]);
	s.engineSearch=async()=>{controller.abort();controller.signal.throwIfAborted();return [];};
	const result=await new JobSearch(s).run(fields,"stop",controller.signal,()=>{});
	assert.equal(result.status,"cancelled");assert.equal(result.matched.length,1);assert.ok(result.portals.length);
});

test("mirrored jobs normalize legal names and title prefixes, preferring official evidence", async () => {
	const doc=zhiyeDocuments(portal,data([row(0)])).documents[0];
	const mirror=structuredClone(doc);mirror.source.url="https://example.com/job/mirror";mirror.source.kind="web";
	mirror.structured[0].company={value:"万兴科技集团股份有限公司",quote:"招聘企业：万兴科技集团股份有限公司"};
	mirror.structured[0].block=mirror.structured[0].block.replace("招聘企业：万兴科技","招聘企业：万兴科技集团股份有限公司");
	mirror.structured[0].role={value:"【校招】Agent开发工程师0",quote:"职位名称：【校招】Agent开发工程师0"};
	mirror.structured[0].block=mirror.structured[0].block.replace("职位名称：Agent开发工程师0","职位名称：【校招】Agent开发工程师0");
	const s=new Search(async()=>"");s.engineSearch=async()=>[doc.source,mirror.source];
	const flow=new JobSearch(s);flow.document=async url=>url===doc.source.url?doc:mirror;
	const result=await flow.run(fields,"mirror",new AbortController().signal,()=>{});
	assert.equal(result.matched.length,1);assert.equal(result.matched[0].kind,"official");
});

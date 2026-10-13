import { parseHTML } from "linkedom";
import type { Document, Posting } from "./jobs.ts";
import { WebError, type WebReader } from "./public-web.ts";
import { officialEmployer, trustedZhiyeHost } from "./recruitment.ts";

const text = (value: unknown) => typeof value === "string" ?
	(parseHTML(`<div>${value}</div>`).document.querySelector("div")?.textContent ?? "").trim() : "";
export function zhiyeDocuments(url: string, data: unknown): { documents: Document[]; count: number } {
	if (!trustedZhiyeHost(url)) throw new WebError("ADDRESS", "招聘平台尚未核验企业归属。");
	const envelope = data as { Code?: number; Data?: unknown[]; Count?: number };
	if (envelope?.Code !== 200 || !Array.isArray(envelope.Data))
		throw new WebError("PARSE", "官方职位接口格式已变化，未将不完整数据作为岗位。请打开官网查看。");
	const documents: Document[] = [];
	for (const value of envelope.Data.slice(0, 20)) {
		if (!value || typeof value !== "object") continue;
		const row = value as Record<string, unknown>;
		const role = text(row.JobAdName), duty = text(row.Duty), requirements = text(row.Require);
		const publicId = typeof row.Id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.Id) ? row.Id : undefined;
		if (!Number.isSafeInteger(row.JobAdId) || Number(row.JobAdId) <= 0 || row.Status !== 1 ||
			!publicId || !role || role.length > 150 || !duty || !requirements || duty.length + requirements.length > 11000) continue;
		const origin = new URL(url).origin;
		const prefix = row.CategoryId === "2" ? "campus" : "social";
		const jobUrl = `${origin}/${prefix}/detail?jobAdId=${publicId}`;
		const fields: Record<string, string> = {
			role, company: officialEmployer(url)!,
			city: Array.isArray(row.LocNames) ? row.LocNames.filter(v => typeof v === "string").join("、").slice(0, 300) : "",
			description: `岗位职责：\n${duty}\n任职要求：\n${requirements}`,
		};
		if (typeof row.PostDate === "string" && /^\d{4}-\d{2}-\d{2}T/.test(row.PostDate) && Number.isFinite(Date.parse(row.PostDate))) fields.publishedAt = row.PostDate.slice(0, 10);
		const labels: Record<string, string> = { role: "职位名称", company: "招聘企业", city: "工作地点", description: "职位描述", publishedAt: "发布时间" };
		const posting: Posting = { block: "" };
		for (const [key, value] of Object.entries(fields)) if (value) {
			const quote = `${labels[key]}：${value}`;
			(posting as unknown as Record<string, unknown>)[key] = { value, quote };
			posting.block += quote + "\n";
		}
		documents.push({ source: {
			title: role, url: jobUrl, content: posting.block, kind: "official", fullText: true,
			retrievedAt: new Date().toISOString(), searchEngine: "官方职位接口",
		}, structured: [posting] });
	}
	return { documents, count: Number.isSafeInteger(envelope.Count) ? Number(envelope.Count) : 0 };
}
export async function readZhiyePage(read: WebReader, portal: string, pageIndex: number, signal: AbortSignal, category?: "1" | "2" | "3") {
	const url = `${new URL(portal).origin}/api/Jobad/GetJobAdPageList`;
	const selected = category ?? (new URL(portal).pathname.startsWith("/campus") ? "2" : "1");
	const page = await read(url, signal, { pageIndex, category: selected });
	try { return zhiyeDocuments(url, JSON.parse(page.body)); }
	catch (error) { if (error instanceof WebError) throw error; throw new WebError("PARSE", "官方职位数据解析失败，请打开官网查看。"); }
}

import directory from "../../content/recruitment-portals.json" with { type: "json" };
import type { JobRecruitmentPortal } from "../shared/types.ts";

const entries = directory.flatMap(e => [e, ...(e.jobPortals ?? []).map(url => ({ ...e, url }))]);
const aliases: Record<string, string[]> = {
	"华为": ["huawei", "华为技术有限公司"], "阿里巴巴": ["阿里", "alibaba"],
	"腾讯": ["tencent"], "字节跳动": ["字节", "bytedance"],
	"万兴科技": ["万兴", "wondershare", "万兴科技集团股份有限公司", "万兴科技（湖南）有限公司"],
	"哔哩哔哩": ["bilibili", "b站"], "科大讯飞": ["讯飞", "iflytek"],
};
const normalized = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
export function companyIdentity(name: string): string {
	const n = normalized(name);
	return entries.find(e => normalized(e.company) === n || aliases[e.company]?.some(a => normalized(a) === n))?.company ?? name.trim();
}
export function officialEmployer(url: string): string | undefined {
	try {
		const host = new URL(url).hostname;
		return entries.find(e => new URL(e.url).hostname === host)?.company;
	} catch { return; }
}
export function knownPortals(company: string): JobRecruitmentPortal[] {
	return entries.filter(e => e.company === companyIdentity(company)).map(e => ({
		title: `${e.company}${new URL(e.url).hostname.endsWith(".zhiye.com") ? new URL(e.url).pathname.startsWith("/campus") ? "校招／实习招聘系统" : "官方招聘系统" : "招聘官网"}`, url: e.url, company: e.company,
		content: "前往官网查看招聘信息；入口不计入岗位数量。", kind: "official",
		retrievedAt: new Date().toISOString(), verifiedAt: e.verifiedAt,
		verificationSource: e.verificationSource, associationEvidence: `企业官方入口：${e.verificationSource}`,
		readStatus: "cached",
	}));
}
export function trustedZhiyeHost(url: string): boolean {
	try { const u = new URL(url); return u.protocol === "https:" &&
		!!officialEmployer(url) && u.hostname.endsWith(".zhiye.com"); } catch { return false; }
}

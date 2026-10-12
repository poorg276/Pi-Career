import type {
	Job,
	JobJD,
	ManualJobFields,
	ManualJobInput,
} from "../shared/types.ts";
import type { Store } from "./store.ts";

const labels: Record<keyof ManualJobFields, string> = {
	company: "企业名",
	city: "工作地点",
	role: "岗位名称",
	responsibilities: "岗位职责",
	requirements: "岗位要求",
	jobType: "岗位类型",
	education: "学历要求",
	experience: "经验要求",
	graduationYear: "面向毕业年份",
	salary: "薪资待遇",
	sourceUrl: "招聘来源链接",
	notes: "备注",
};
export function validateManualJob(input: unknown): ManualJobInput {
	if (!input || typeof input !== "object")
		throw new Error("手动岗位参数无效。");
	const data = input as Record<string, unknown>;
	if (
		typeof data.id !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			data.id,
		)
	)
		throw new Error("岗位编号无效。");
	if (data.mode !== "create" && data.mode !== "update")
		throw new Error("保存方式无效。");
	const fields = {} as ManualJobFields;
	for (const key of Object.keys(labels) as (keyof ManualJobFields)[]) {
		const max =
			key === "responsibilities" || key === "requirements"
				? 10000
				: key === "sourceUrl" || key === "notes"
					? 2000
					: 200;
		if (typeof data[key] !== "string" || (data[key] as string).length > max)
			throw new Error(`${labels[key]}格式无效或超出 ${max} 字。`);
		(fields as any)[key] = (data[key] as string).replace(/\r\n?/g, "\n").trim();
	}
	for (const key of [
		"company",
		"city",
		"role",
		"responsibilities",
		"requirements",
	] as const)
		if (!fields[key]) throw new Error(`请填写${labels[key]}。`);
	if (!["实习", "校招", "社招", "未注明"].includes(fields.jobType))
		throw new Error("岗位类型无效。");
	if (fields.sourceUrl) {
		try {
			const u = new URL(fields.sourceUrl);
			if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
				throw new Error();
			if (u.href.length > 2000) throw new Error();
			fields.sourceUrl = u.href;
		} catch {
			throw new Error("招聘来源链接必须是有效的 HTTP／HTTPS 网址。");
		}
	}
	return { ...fields, id: data.id, mode: data.mode };
}
export function manualJD(fields: ManualJobFields): string {
	return [
		"来源：用户手动录入",
		...Object.entries(labels)
			.filter(([k]) => !!fields[k as keyof ManualJobFields])
			.map(([k, label]) => `${label}：${fields[k as keyof ManualJobFields]}`),
	].join("\n");
}
export class ManualJobs {
	store: Store;
	constructor(store: Store) {
		this.store = store;
	}
	save(value: unknown): Job[] {
		const input = validateManualJob(value),
			existing = this.store.get<Job>("favorite", input.id);
		if (existing && existing.origin !== "manual")
			throw new Error("仅可编辑用户手动录入的岗位。");
		if (input.mode === "update" && !existing)
			throw new Error("此岗位已被删除，请重新录入。");
		const { id, mode, ...fields } = input,
			now = new Date().toISOString();
		const job: Job = {
			id,
			origin: "manual",
			manual: fields,
			company: fields.company,
			city: fields.city,
			role: fields.role,
			title: fields.role,
			url: fields.sourceUrl,
			kind: "web",
			experience: fields.experience || "未提供",
			score: 0,
			content: `岗位职责：\n${fields.responsibilities}\n\n岗位要求：\n${fields.requirements}`,
			jd: manualJD(fields),
			retrievedAt: existing?.createdAt ?? now,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		this.store.put("favorite", id, job);
		return this.store.list<Job>("favorite");
	}
	remove(id: string): Job[] {
		const job = this.store.get<Job>("favorite", id);
		if (job && job.origin !== "manual")
			throw new Error("此接口只可删除手动岗位。");
		if (job) this.store.remove("favorite", id);
		return this.store.list<Job>("favorite");
	}
	prepare(id: string): JobJD {
		const job = this.store.get<Job>("favorite", id);
		if (job?.origin !== "manual" || !job.manual)
			throw new Error("手动岗位不存在或已被删除，请返回收藏重新打开。");
		const {
			id: unused,
			mode: ignored,
			...fields
		} = validateManualJob({ ...job.manual, id, mode: "update" });
		return {
			status: "ready",
			text: manualJD(fields),
			company: fields.company,
			role: fields.role,
			url: fields.sourceUrl,
		};
	}
}

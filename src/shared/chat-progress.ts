import type { ChatEntry, ChatRun } from "./types.ts";
export const toolLabels: Record<string, string> = {
	get_current_time: "读取系统时间",
	get_weather: "查询天气",
	web_search: "搜索网页",
	web_fetch: "读取网页",
	read: "读取文件",
	write: "写入文件",
	edit: "编辑文件",
	grep: "检索内容",
	find: "查找文件",
	ls: "查看目录",
	powershell: "执行 PowerShell",
};
export function groupTurns(entries: ChatEntry[]) {
	const turns: { id: string; entries: ChatEntry[] }[] = [];
	for (const entry of entries) {
		let group = turns.find((t) => t.id === entry.turnId);
		if (!group) {
			group = { id: entry.turnId, entries: [] };
			turns.push(group);
		}
		group.entries.push(entry);
	}
	return turns;
}
export function progressLines(entries: ChatEntry[], run?: ChatRun): string[] {
	const lines = entries
		.filter((e) => e.role === "tool")
		.map((e) => {
			const name = toolLabels[e.name ?? ""] ?? e.name ?? "调用工具";
			return e.status === "running"
				? `正在${name}…`
				: `${name} · ${{ complete: "已完成", error: "未成功", cancelled: "已取消" }[e.status ?? "complete"]}`;
		});
	if (run?.phase !== "tools" || !lines.length)
		lines.push(
			run?.phase === "thinking"
				? "正在思考…"
				: run?.phase === "responding"
					? "正在整理回答…"
					: "正在处理请求…",
		);
	return lines.slice(-3);
}
export function progressSummary(entries: ChatEntry[], run?: ChatRun) {
	if (run?.status === "cancelled") return "已停止思考与工具调用";
	if (run?.status === "interrupted") return "思考与工具调用已中断";
	if (run?.status === "error") return "思考与工具调用未完成";
	const lastByTool = new Map<string, ChatEntry>();
	for (const e of entries)
		if (e.role === "tool") lastByTool.set(e.name ?? "tool", e);
	if (
		[...lastByTool.values()].some(
			(e) => e.status === "error" || e.status === "cancelled",
		)
	)
		return "已结束思考与工具调用 · 部分工具未成功";
	return "已完成思考与工具调用";
}

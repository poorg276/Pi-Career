import React, { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardState } from "../shared/types.ts";
const api = window.picareer;
export function useDashboard() {
	const [state, setState] = useState<DashboardState>();
	const [error, setError] = useState("");
	const [changing, setChanging] = useState(false);
	const generation = useRef(0),
		mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		const off = api.onEvent((event) => {
			if (event.type === "dashboardUpdate") {
				generation.current++;
				setState((old) => {
					if (
						old?.attemptedAt &&
						event.state.attemptedAt &&
						event.state.attemptedAt < old.attemptedAt
					)
						return old;
					if (
						old?.requestId === event.state.requestId &&
						old?.status !== "loading" &&
						event.state.status === "loading"
					)
						return old;
					return event.state;
				});
				setError("");
			}
			if (event.type === "backendExited") {
				generation.current++;
				setError("后台已退出，请重新打开应用。");
				setState((old) =>
					old ? { ...old, status: "failed", stage: undefined } : old,
				);
			}
		});
		const current = generation.current;
		void api
			.call("dashboard", null)
			.then((value) => {
				if (mounted.current && current === generation.current) setState(value);
			})
			.catch((e) => {
				if (mounted.current) setError(String(e.message ?? e));
			});
		return () => {
			mounted.current = false;
			off();
		};
	}, []);
	const ensure = useCallback(async () => {
		const current = generation.current;
		try {
			const value = await api.call("ensureDashboardUpdated", null);
			if (mounted.current && current === generation.current) setState(value);
		} catch (e) {
			if (mounted.current) setError(e instanceof Error ? e.message : String(e));
		}
	}, []);
	const refresh = async () => {
		if (state?.status === "loading") return;
		setError("");
		setState((old) =>
			old ? { ...old, status: "loading", stage: "正在检索官方技术发布" } : old,
		);
		try {
			const value = await api.call("refreshDashboard", null);
			if (mounted.current) setState(value);
		} catch (e) {
			if (mounted.current) {
				setError(e instanceof Error ? e.message : String(e));
				setState((old) =>
					old ? { ...old, status: "failed", stage: undefined } : old,
				);
			}
		}
	};
	const next = async () => {
		if (changing) return;
		setChanging(true);
		try {
			const value = await api.call("nextDashboardKnowledge", null);
			if (mounted.current) setState(value);
		} catch (e) {
			if (mounted.current) setError(e instanceof Error ? e.message : String(e));
		} finally {
			if (mounted.current) setChanging(false);
		}
	};
	return { state, error, changing, refresh, next, ensure };
}
function External({
	url,
	children,
}: {
	url: string;
	children: React.ReactNode;
}) {
	const [error, setError] = useState("");
	return (
		<>
			<a
				href={url}
				onClick={(e) => {
					e.preventDefault();
					void api
						.call("openExternal", { url })
						.catch((e) => setError(e.message));
				}}
			>
				{children}
			</a>
			{error && (
				<span className="dashboard-error" role="alert">
					{error}
				</span>
			)}
		</>
	);
}
const date = (value: string, evidence: string) => {
	const calendar = /^\d{4}-\d{2}-\d{2}/.exec(evidence)?.[0];
	return calendar ?? new Date(evidence || value).toLocaleDateString("zh-CN");
};
export function DashboardPanels({
	workspace,
}: {
	workspace: ReturnType<typeof useDashboard>;
}) {
	const { state, error, refresh, next, changing } = workspace;
	return (
		<div className="dashboard-panels">
			<section className="panel recruitment-panel" aria-label="企业招聘官网">
				<div className="section-heading">
					<h2>企业招聘官网</h2>
					<span>官方入口 · 岗位信息以官网为准</span>
				</div>
				<div className="recruitment-grid">
					{state?.portals.map((p) => (
						<div
							className="recruitment-link"
							key={p.company}
							title={`官方入口核验：${p.verifiedAt}`}
						>
							<External url={p.url}>
								{p.company}
								<span aria-hidden="true">↗</span>
							</External>
						</div>
					))}
				</div>
				{!state && <p className="dashboard-muted">正在加载本地入口…</p>}
			</section>
			<div className="dashboard-content-grid">
				<section className="panel news-panel" aria-label="Agent 技术进展">
					<div className="section-heading">
						<h2>Agent 技术进展</h2>
						<button
							onClick={() => void refresh()}
							disabled={state?.status === "loading"}
						>
							{state?.status === "loading" ? "更新中…" : "刷新"}
						</button>
					</div>
					<p className="dashboard-muted">
						每日自动更新 · 近30天优先 · 官方发布
						{state?.updatedAt
							? ` · 上次更新 ${new Date(state.updatedAt).toLocaleString("zh-CN")}`
							: ""}
					</p>
					{state?.status === "loading" && (
						<p className="dashboard-loading" role="status">
							{state.stage ?? "正在更新"}
							{state.news.length ? "，当前显示上次内容" : "…"}
						</p>
					)}
					{state?.status === "failed" && (
						<p className="dashboard-error" role="status">
							本次更新失败
							{state.news.length
								? "，已保留上次缓存。"
								: "，暂未取得已核实的技术资讯。"}
						</p>
					)}
					{error && (
						<p className="dashboard-error" role="alert">
							{error}
						</p>
					)}
					<div className="dashboard-news-list">
						{state?.news.map((n) => (
							<article className="dashboard-news" key={n.id}>
								<h3>
									<External url={n.url}>{n.title}</External>
								</h3>
								<p>{n.summary}</p>
								<div className="dashboard-news-meta">
									<span>发布：{date(n.publishedAt, n.dateEvidence)}</span>
									{Date.now() - Date.parse(n.publishedAt) > 30 * 86400000 && (
										<span className="badge">近90天补充</span>
									)}
									<External url={n.url}>{n.source} ↗</External>
								</div>
							</article>
						))}
					</div>
					{state?.status === "partial" && (
						<p className="dashboard-muted">{state.warnings[0]}</p>
					)}
					{!!state?.warnings.length && state.status !== "loading" && (
						<details className="dashboard-diagnostics">
							<summary>更新说明</summary>
							{state.warnings.map((w, i) => (
								<p key={i}>{w}</p>
							))}
						</details>
					)}
				</section>
				<section className="panel daily-knowledge" aria-label="今日知识点">
					<div className="section-heading">
						<h2>今日知识点</h2>
						<button disabled={!state || changing} onClick={() => void next()}>
							换一条
						</button>
					</div>
					{state ? (
						<>
							<div className="dashboard-knowledge-meta">
								<span className="badge">{state.knowledge.category}</span>
								<span>{state.knowledgeDate}</span>
							</div>
							<h3>{state.knowledge.question}</h3>
							<p>{state.knowledge.answer}</p>
							<External url={state.knowledge.source}>查看知识来源 ↗</External>
							<p className="dashboard-muted">每日一条 · 不计入学习计划进度</p>
						</>
					) : (
						<p className="dashboard-muted">正在读取知识库…</p>
					)}
				</section>
			</div>
		</div>
	);
}

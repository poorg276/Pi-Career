import React, { useEffect, useRef, useState } from "react";
import type { Job, JobFilters, JobSearchResult } from "../shared/types";
import "./jobs.css";
import { ManualJobDialogs, useManualJobsWorkspace } from "./manual-jobs.tsx";
const api = window.picareer;
export function useJobsWorkspace() {
	const manual = useManualJobsWorkspace();
	const [filters, setFilters] = useState<JobFilters>({
		city: "",
		company: "",
		role: "",
	});
	const [result, setResult] = useState<JobSearchResult>();
	const [favoriteOnly, setFavoriteOnly] = useState(false),
		[expanded, setExpanded] = useState(false);
	const [running, setRunning] = useState(false),
		[stage, setStage] = useState(""),
		[error, setError] = useState("");
	const active = useRef<string | undefined>(undefined),
		scroll = useRef(0);
	useEffect(
		() =>
			api.onEvent((e) => {
				if (e.type === "jobProgress" && e.requestId === active.current)
					setStage(e.stage);
				if (e.type === "backendExited") {
					active.current = undefined;
					setRunning(false);
					setError("检索已中断，请重试。");
				}
			}),
		[],
	);
	const search = async () => {
		const requestId = crypto.randomUUID();
		active.current = requestId;
		setRunning(true);
		setStage("正在准备检索");
		setError("");
		setFavoriteOnly(false);
		setExpanded(false);
		setResult(undefined);
		try {
			const next = await api.call("jobs", { ...filters, requestId });
			if (active.current === requestId) setResult(next);
		} catch (e) {
			if (active.current === requestId) setError(String(e));
		} finally {
			if (active.current === requestId) {
				active.current = undefined;
				setRunning(false);
			}
		}
	};
	const cancel = async () => {
		if (active.current) {
			setStage("正在停止检索…");
			await api
				.call("cancelJobs", { requestId: active.current })
				.catch((e) => setError(String(e)));
		}
	};
	return {
		manual,
		filters,
		setFilters,
		result,
		favoriteOnly,
		setFavoriteOnly,
		expanded,
		setExpanded,
		running,
		stage,
		error,
		search,
		cancel,
		scroll,
	};
}
export function JobsPage({
	workspace: w,
	favorites,
	model,
	settings,
	favorite,
	refresh,
	sendJD,
}: {
	workspace: ReturnType<typeof useJobsWorkspace>;
	favorites: Job[];
	model: string;
	settings: () => void;
	favorite: (j: Job) => void;
	refresh: () => Promise<void>;
	sendJD: (p: "learn" | "interview", j: Job) => void;
}) {
	const card = (j: Job) => (
		<article
			className={j.origin === "manual" ? "panel job job-manual" : "panel job"}
			key={j.id}
		>
			<div className="row between">
				<span className="badge">
					{j.origin === "manual" ? (
						`用户手动录入 · ${j.manual?.jobType ?? "未注明"}`
					) : (
						<>
							{j.kind === "official" ? "企业官方来源" : "公开招聘来源"} ·{" "}
							{j.verification === "verified"
								? "正文已核验"
								: j.verification === "summary"
									? "摘要待核验"
									: "旧收藏 · 待重新核验"}
						</>
					)}
				</span>
				<span className="muted small">
					{j.origin === "manual"
						? `录入于 ${new Date(j.createdAt ?? j.retrievedAt).toLocaleString("zh-CN")}`
						: `招聘有效性未确认 · ${j.publishedAt ?? "发布时间未提供"}`}
				</span>
			</div>
			<h3>{j.role}</h3>
			<div className="job-meta">
				{j.company} · {j.city} · {j.experience}
			</div>
			{j.origin !== "manual" && j.matchReasons && (
				<div className="job-matches">
					{j.matchReasons.map((r) => (
						<span key={r}>{r}</span>
					))}
				</div>
			)}
			<p>
				{j.content.slice(0, 650)}
				{j.content.length > 650 ? "…" : ""}
			</p>
			{j.origin !== "manual" && j.evidence && (
				<details className="job-evidence">
					<summary>查看匹配证据</summary>
					{Object.entries(j.evidence).map(([key, value]) => (
						<blockquote key={key}>{value}</blockquote>
					))}
				</details>
			)}
			<div className="row between">
				<small className="muted">
					{j.origin === "manual"
						? "用户手动录入"
						: `${new URL(j.url).hostname} · ${j.searchEngine ?? "公开来源"}`}{" "}
					· {new Date(j.retrievedAt).toLocaleString("zh-CN")}
				</small>
				<div className="actions">
					{j.origin === "manual" ? (
						<>
							<button onClick={() => w.manual.setDetail(j)}>查看详情</button>
							<button onClick={() => w.manual.edit(j)}>编辑</button>
							<button
								className="danger"
								onClick={() => w.manual.setDeletion(j)}
							>
								删除
							</button>
						</>
					) : (
						<button onClick={() => favorite(j)}>
							{favorites.some((f) => f.id === j.id) ? "取消收藏" : "收藏"}
						</button>
					)}
					<button onClick={() => sendJD("interview", j)}>准备面试</button>
					<button onClick={() => sendJD("learn", j)}>匹配知识点</button>
					{j.url && (
						<button
							className="primary"
							onClick={() => api.call("openExternal", { url: j.url })}
						>
							原文 ↗
						</button>
					)}
				</div>
			</div>
		</article>
	);
	return (
		<div className="jobs-page">
			<div className="page-title">
				<span className="eyebrow">FIND YOUR NEXT OPPORTUNITY</span>
				<div className="row between jobs-title-row">
					<h1>企业岗位检索</h1>
					<button onClick={w.manual.open}>＋ 手动录入目标岗位</button>
				</div>
				<p className="muted">城市、企业、岗位，任意填写一项即可开始探索。</p>
			</div>
			<section className="panel padded">
				<form
					onSubmit={(e) => {
						e.preventDefault();
						void w.search();
					}}
				>
					<div className="filter-grid">
						{(
							[
								["city", "目标城市", "例如：长沙"],
								["company", "目标企业", "例如：华为"],
								["role", "目标岗位", "例如：Agent 开发工程师"],
							] as const
						).map(([key, label, placeholder]) => (
							<label className="field" key={key}>
								<span>{label}</span>
								<input
									value={w.filters[key]}
									placeholder={placeholder}
									onChange={(e) =>
										w.setFilters({ ...w.filters, [key]: e.target.value })
									}
								/>
							</label>
						))}
						<button
							className="primary"
							disabled={!Object.values(w.filters).some((v) => v.trim())}
							type="submit"
						>
							{w.running ? "重新检索" : "搜索岗位"}
						</button>
					</div>
					<div className="jobs-search-footer">
						<span>按职位证据核验 · 官方来源优先 · 招聘有效性以原文为准</span>
						<button
							type="button"
							className="model-chip jobs-model"
							title={model || "尚未配置模型"}
							onClick={settings}
						>
							<i className={model ? "online-dot" : "offline-dot"} />
							<span>{model || "尚未配置模型"}</span>
						</button>
					</div>
				</form>
			</section>
			{w.running && (
				<div className="jobs-status" role="status">
					<span>{w.stage}</span>
					<button onClick={() => void w.cancel()}>停止检索</button>
				</div>
			)}
			{w.error && (
				<div className="alert error" role="alert">
					{w.error}
				</div>
			)}
			{!w.favoriteOnly && w.result && (
				<>
					<p className="muted jobs-query">
						本次条件：
						{Object.entries(w.result.filters)
							.filter(([, v]) => v.trim())
							.map(([, v]) => v)
							.join(" · ")}
					</p>
					{w.result.warnings.length > 0 && (
						<details className="jobs-warnings">
							<summary>检索说明（{w.result.warnings.length}）</summary>
							<ul>
								{w.result.warnings.map((t) => (
									<li key={t}>{t}</li>
								))}
							</ul>
						</details>
					)}
				</>
			)}
			<div className="section-heading">
				<h2>
					{w.favoriteOnly
						? `我的收藏 · ${favorites.length}`
						: `严格匹配${w.result ? ` · ${w.result.matched.length}` : ""}`}
				</h2>
				<div className="actions">
					{w.favoriteOnly && (
						<button onClick={w.manual.open}>＋ 手动录入目标岗位</button>
					)}
					<button onClick={() => w.setFavoriteOnly(!w.favoriteOnly)}>
						{w.favoriteOnly ? "返回搜索" : `我的收藏 (${favorites.length})`}
					</button>
				</div>
			</div>
			{w.manual.notice && (
				<p className="alert" role="status">
					{w.manual.notice}
				</p>
			)}
			{w.favoriteOnly ? (
				favorites.map(card)
			) : (
				<>
					{w.result?.matched.map(card)}
					{!w.running && !w.result?.matched.length && (
						<div className="empty">
							<h3>
								{w.result
									? "未找到已核实符合全部条件的岗位"
									: "下一份机会，从一个方向开始"}
							</h3>
							<p>
								{w.result
									? "这不代表企业没有招聘；可查看相关备选或官网入口，亦可调整条件再检索。"
									: "输入城市、企业或目标岗位开始检索。"}
							</p>
						</div>
					)}
					{!!w.result?.related.length && (
						<details
							className="jobs-related"
							open={w.expanded}
							onToggle={(e) => w.setExpanded(e.currentTarget.open)}
						>
							<summary>
								相关备选 · {w.result.related.length}（部分条件不一致或待核实）
							</summary>
							{w.result.related.map(card)}
						</details>
					)}
					{!!w.result?.portals.length && (
						<section className="panel padded jobs-portals">
							<h2>招聘入口</h2>
							<p className="muted">入口不计入岗位数量，需到原站继续筛选。</p>
							{w.result.portals.map((p) => (
								<button
									key={p.url}
									onClick={() => api.call("openExternal", { url: p.url })}
								>
									{p.title} ↗
								</button>
							))}
						</section>
					)}
				</>
			)}
			<ManualJobDialogs
				workspace={w.manual}
				refresh={refresh}
				saved={() => w.setFavoriteOnly(true)}
			/>
		</div>
	);
}

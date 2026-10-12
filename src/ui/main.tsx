import React, { useEffect, useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/python/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import type {
	Page,
	AppState,
	Chat,
	Job,
	JobJD,
	Interview,
	StudyPlan,
	Settings,
	PromptEvent,
	Source,
	ModelOption,
	ProviderOption,
} from "../shared/types";
import { CodingPage, useCodingWorkspace } from "./coding.tsx";
import { DashboardPanels, useDashboard } from "./dashboard.tsx";
import { ResumePage } from "./resume.tsx";
import knowledge from "../../content/knowledge.json";
import "./style.css";
import { JobsPage, useJobsWorkspace } from "./jobs.tsx";
import {
	ChatPage,
	ChatHistory,
	mergeChats,
	useChatWorkspace,
} from "./chat.tsx";
import {
	useAuthorization,
	AuthorizationDialog,
	isAuthorizing,
	type AuthorizationUI,
} from "./authorization.tsx";
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
	getWorker: () => new EditorWorker(),
};
const api = window.picareer;
const menu: { id: Page; title: string; icon: string }[] = [
	{ id: "home", title: "工作台", icon: "grid" },
	{ id: "chat", title: "通用 Agent", icon: "spark" },
	{ id: "interview", title: "模拟面试", icon: "mic" },
	{ id: "jobs", title: "企业岗位", icon: "search" },
	{ id: "coding", title: "Hot100 练习", icon: "code" },
	{ id: "learn", title: "知识背诵", icon: "book" },
	{ id: "resume", title: "简历优化", icon: "resume" },
];
function Icon({ name, size = 20 }: { name: string; size?: number }) {
	const paths: Record<string, React.ReactNode> = {
		grid: (
			<>
				<rect x="3" y="3" width="7" height="7" rx="1.7" />
				<rect x="14" y="3" width="7" height="7" rx="1.7" />
				<rect x="3" y="14" width="7" height="7" rx="1.7" />
				<rect x="14" y="14" width="7" height="7" rx="1.7" />
			</>
		),
		spark: (
			<>
				<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
			</>
		),
		mic: (
			<>
				<rect x="8" y="2" width="8" height="13" rx="4" />
				<path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
			</>
		),
		search: (
			<>
				<circle cx="10.5" cy="10.5" r="7" />
				<path d="m16 16 5 5" />
			</>
		),
		code: (
			<>
				<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16" />
			</>
		),
		book: (
			<>
				<path d="M12 5v16M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1Z" />
			</>
		),
		resume: (
			<>
				<path d="M13 3H5v18h14v-8M13 3v5h6l-6-5ZM8 11h4M8 15h2" />
				<path d="m12 17 1-4 6-6 3 3-6 6-4 1Zm6-9 3 3" />
			</>
		),
		settings: (
			<>
				<circle cx="12" cy="12" r="4" />
				<path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
			</>
		),
		arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
		clock: (
			<>
				<circle cx="12" cy="12" r="9" />
				<path d="M12 7v5l3 2" />
			</>
		),
		folder: <path d="M3 6h7l2 3h9v11H3V6Zm0 0V4h6l2 2" />,
		check: <path d="m5 12 4 4L19 6" />,
		plus: <path d="M12 4v16M4 12h16" />,
	};
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.65"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{paths[name] ?? paths.spark}
		</svg>
	);
}
function Text({ text }: { text: string }) {
	return (
		<div className="prose">
			{text.split(/```/).map((part, i) =>
				i % 2 ? (
					<pre key={i}>
						<code>{part.replace(/^\w+\n/, "")}</code>
					</pre>
				) : (
					<div key={i}>
						{part
							.split("\n")
							.map((line, n) =>
								/^#{1,4} /.test(line) ? (
									<h3 key={n}>{line.replace(/^#+ /, "")}</h3>
								) : (
									<div key={n}>{line || "\u00a0"}</div>
								),
							)}
					</div>
				),
			)}
		</div>
	);
}
function Sources({ sources }: { sources: Source[] }) {
	return (
		<div className="sources">
			{sources.map((s, i) => (
				<article key={s.url} className="source">
					<div className="row">
						<span className="badge">
							{s.kind === "official"
								? "招聘域名来源"
								: s.kind === "community"
									? "社区资料"
									: "公开网页"}
						</span>
						<span className="muted">{s.publishedAt ?? "发布日期未提供"}</span>
					</div>
					<button
						className="link source-title"
						onClick={() => api.call("openExternal", { url: s.url })}
					>
						{i + 1}. {s.title} ↗
					</button>
					<p>
						{s.content.slice(0, 320)}
						{s.content.length > 320 ? "…" : ""}
					</p>
					<small>
						{new URL(s.url).hostname} · 检索于{" "}
						{new Date(s.retrievedAt).toLocaleDateString("zh-CN")}
					</small>
				</article>
			))}
		</div>
	);
}
function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<label className="field">
			<span>{label}</span>
			{children}
		</label>
	);
}
function Empty({ title, detail }: { title: string; detail: string }) {
	return (
		<div className="empty">
			<div className="empty-icon">
				<Icon name="spark" size={30} />
			</div>
			<h3>{title}</h3>
			<p>{detail}</p>
		</div>
	);
}
function App() {
	const dashboardWorkspace = useDashboard();
	const mainPane = useRef<HTMLDivElement>(null);
	const jobsWorkspace = useJobsWorkspace();
	const [jobOrigin, setJobOrigin] = useState<{
		target: Page;
		job: Job;
		nonce: string;
	}>();
	const [jobDraft, setJobDraft] = useState<{
		target: Page;
		job: Job;
		prepared: JobJD;
	}>();
	const [jobsSettings, setJobsSettings] = useState(false);
	const [resumeSettings, setResumeSettings] = useState(false);
	const [resumeActivation, setResumeActivation] = useState(0);
	const [page, setPage] = useState<Page>("home"),
		[state, setState] = useState<AppState>(),
		[error, setError] = useState(""),
		[notice, setNotice] = useState(""),
		[busy, setBusy] = useState(false),
		[modal, setModal] = useState<PromptEvent>(),
		[modalValue, setModalValue] = useState(""),
		[seedJD, setSeedJD] = useState(""),
		[selectedChat, setSelectedChat] = useState<string>(),
		[chatExpanded, setChatExpanded] = useState(true),
		[selectedInterview, setSelectedInterview] = useState<string>(),
		[selectedPlan, setSelectedPlan] = useState<string>();
	const codingWorkspace = useCodingWorkspace(state?.drafts ?? {});
	const deletedChats = useRef(new Set<string>());
	const chatList = useRef(state?.chats ?? []);
	chatList.current = state?.chats ?? [];
	const removeChat = useCallback((id: string) => {
		deletedChats.current.add(id);
		setState((old) =>
			old ? { ...old, chats: old.chats.filter((chat) => chat.id !== id) } : old,
		);
		setSelectedChat((selected) =>
			selected === id
				? chatList.current.find((chat) => !deletedChats.current.has(chat.id))
						?.id
				: selected,
		);
	}, []);
	const refresh = useCallback(async () => {
		const next = await api.call("state", null);
		setState((old) => ({
			...next,
			chats: mergeChats(next.chats, old?.chats ?? []).filter(
				(chat) => !deletedChats.current.has(chat.id),
			),
		}));
	}, []);
	const updateChat = useCallback(
		(chat: Chat) =>
			setState((old) =>
				old && !deletedChats.current.has(chat.id)
					? { ...old, chats: mergeChats(old.chats, [chat]) }
					: old,
			),
		[],
	);
	const workspace = useChatWorkspace(
		state?.chats ?? [],
		selectedChat,
		setSelectedChat,
		updateChat,
		setError,
	);
	const authorization = useAuthorization(refresh);
	const run = useCallback(
		async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
			setBusy(true);
			setError("");
			try {
				return await task();
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
				return undefined;
			} finally {
				setBusy(false);
			}
		},
		[],
	);
	useEffect(() => {
		void run(refresh);
		return api.onEvent((e) => {
			if (e.type === "chatUpdate") updateChat(e.chat);
			if (e.type === "chatDeleted") removeChat(e.chatId);
			if (e.type === "backendExited")
				setState((old) =>
					old
						? {
								...old,
								chats: old.chats.map((chat) =>
									chat.run?.status === "running"
										? {
												...chat,
												run: {
													...chat.run,
													status: "interrupted",
													error: e.message,
												},
												entries: chat.entries?.map((entry) =>
													entry.status === "running"
														? { ...entry, status: "cancelled" }
														: entry,
												),
											}
										: chat,
								),
							}
						: old,
				);
			if (e.type === "prompt") {
				setModal(e.prompt);
				setModalValue("");
			} else if (e.type === "promptClosed") {
				setModal((current) => (current?.id === e.id ? undefined : current));
				setModalValue("");
			}
			if (e.type === "notice") {
				setNotice(e.text);
			}
		});
	}, [refresh, run, updateChat, removeChat]);
	const nav = (p: Page, preserveResume = false) => {
		if (p === "resume" && !preserveResume) {setResumeActivation(n => n + 1);setResumeSettings(false);}
		if (page === "coding")
			void codingWorkspace.persist(codingWorkspace.id).catch(() => {});
		if (page === "jobs")
			jobsWorkspace.scroll.current = mainPane.current?.scrollTop ?? 0;
		if (p === "chat" && page !== "chat") setChatExpanded(true);
		setPage(p);
		setError("");
	};
	useEffect(() => {
		mainPane.current?.scrollTo({
			top: page === "jobs" ? jobsWorkspace.scroll.current : 0,
		});
	}, [page]);
	const acceptJD = (target: Page, job: Job, prepared: JobJD) => {
		setSeedJD(prepared.text);
		setJobOrigin({
			target,
			job: { ...job, company: prepared.company, role: prepared.role },
			nonce: crypto.randomUUID(),
		});
		if (target === "learn") setSelectedPlan(undefined);
		else setSelectedInterview(undefined);
		setJobDraft(undefined);
		nav(target);
	};
	const sendJD = (target: Page, job: Job) => {
		if (busy) return;
		void run(async () => {
			const prepared = await api.call("prepareJobJD", { job });
			if (prepared.status === "ready") acceptJD(target, job, prepared);
			else setJobDraft({ target, job, prepared });
		});
	};
	const common = { state: state!, refresh, run, busy };
	return (
		<div className="shell">
			<div className="window-titlebar">
				<div className="window-titlebar-content">
					<span className="window-mark" aria-hidden="true">
						π
					</span>
					<span>PiCareer·辅助求职Agent</span>
				</div>
			</div>
			<aside className="sidebar">
				<div className="brand">
					<div className="brand-mark">π</div>
					<div>
						PiCareer<small>PERSONAL AGENT</small>
					</div>
				</div>
				<div className="sidebar-scroll" tabIndex={0} aria-label="工作空间导航">
					<div className="workspace-label">
						我的工作空间 <span>LOCAL</span>
					</div>
					<nav>
						{menu.map((m) => (
							<React.Fragment key={m.id}>
								<button
									onClick={() => {
										if (m.id === "chat" && page === "chat")
											setChatExpanded((v) => !v);
										else nav(m.id);
									}}
									className={page === m.id ? "nav active" : "nav"}
									aria-expanded={m.id === "chat" ? chatExpanded : undefined}
								>
									<Icon name={m.icon} />
									{m.title}
									{m.id === "chat" ? (
										<span className="nav-chevron">
											{chatExpanded ? "⌄" : "›"}
										</span>
									) : (
										page === m.id && <i />
									)}
								</button>
								{m.id === "chat" && chatExpanded && (
									<ChatHistory
										deleted={removeChat}
										chats={state?.chats ?? []}
										selected={selectedChat}
										choose={(id) => {
											setSelectedChat(id);
											nav("chat");
										}}
										create={() => {
											nav("chat");
											void workspace.newChat();
										}}
										update={updateChat}
										onError={setError}
									/>
								)}
							</React.Fragment>
						))}
					</nav>

				</div>
				<div className="sidebar-bottom">
					<button
						className={page === "settings" ? "nav active" : "nav"}
						onClick={() => nav("settings")}
					>
						<Icon name="settings" />
						模型与设置
					</button>
					<div className="profile">
						<span className="avatar">P</span>
						<div>
							个人空间
							<small>
								<i className="online-dot" /> 本地保存 · Pi 驱动
							</small>
						</div>
					</div>
				</div>
			</aside>
			<div
				className={
					page === "chat"
						? "main chat-main"
						: page === "jobs"
							? "main jobs-main"
							: "main"
				}
				ref={mainPane}
			>
				{page !== "chat" && page !== "jobs" && page !== "coding" && (
					<header className="topbar">
						<span>
							个人工作空间 <b>/</b>{" "}
							{menu.find((m) => m.id === page)?.title ?? "模型与设置"}
						</span>
						<div className="row">
							<span className="model-chip">
								<i
									className={
										state?.settings.model ? "online-dot" : "offline-dot"
									}
								/>
								{state?.settings.model || "尚未配置模型"}
							</span>
							<button
								className="icon-button"
								title="模型设置"
								onClick={() => nav("settings")}
							>
								<Icon name="settings" size={18} />
							</button>
						</div>
					</header>
				)}
				<main>
					{state && <div hidden={page!=="resume"}><ResumePage model={state.settings.model} provider={state.settings.provider} activation={resumeActivation} settings={()=>{setResumeSettings(true);nav("settings");}}/></div>}
					{page === "settings" && resumeSettings && <button className="jobs-back" onClick={()=>{setResumeSettings(false);nav("resume",true);}}>← 返回简历优化</button>}
					{(jobOrigin?.target === page ||
						(page === "settings" && jobsSettings)) && (
						<button
							className="jobs-back"
							onClick={() => {
								setJobsSettings(false);
								nav("jobs");
							}}
						>
							← 返回岗位检索
						</button>
					)}
					{error && (
						<div className="alert error" role="alert">
							{error}
							<button onClick={() => setError("")}>×</button>
						</div>
					)}
					{notice && (
						<div className="alert">
							{notice}
							<button
								onClick={() => {
									setNotice("");
								}}
							>
								×
							</button>
						</div>
					)}
					{!state ? (
						<Empty
							title={error ? "启动遇到问题" : "正在连接工作空间"}
							detail="加载本地记录与 Pi 运行时…"
						/>
					) : page === "home" ? (
						<Home
							dashboardWorkspace={dashboardWorkspace}
							state={state}
							nav={nav}
							selectChat={(id) => {
								setSelectedChat(id);
								nav("chat");
							}}
							selectPlan={(id) => {
								setSelectedPlan(id);
								nav("learn");
							}}
						/>
					) : page === "chat" ? (
						<ChatPage
							workspace={workspace}
							model={state.settings.model}
							settings={() => nav("settings")}
						/>
					) : page === "resume" ? null : page === "settings" ? (
						<SettingsPage {...common} authorization={authorization} />
					) : page === "jobs" ? (
						<JobsPage
							workspace={jobsWorkspace}
							refresh={refresh}
							favorites={state.favorites}
							model={state.settings.model}
							settings={() => {
								setJobsSettings(true);
								nav("settings");
							}}
							favorite={(j) =>
								void run(async () => {
									await api.call("favorite", j);
									await refresh();
								})
							}
							sendJD={sendJD}
						/>
					) : page === "interview" ? (
						<InterviewPage
							key={
								jobOrigin?.target === "interview"
									? jobOrigin.nonce
									: "interview"
							}
							jobSeed={
								jobOrigin?.target === "interview" ? jobOrigin.job : undefined
							}
							{...common}
							seed={seedJD}
							selected={selectedInterview}
							select={setSelectedInterview}
						/>
					) : page === "learn" ? (
						<LearnPage
							key={jobOrigin?.target === "learn" ? jobOrigin.nonce : "learn"}
							{...common}
							seed={seedJD}
							selected={selectedPlan}
							select={setSelectedPlan}
						/>
					) : (
						<CodingPage
							state={state}
							workspace={codingWorkspace}
							Editor={CodeEditor}
							onAttempts={(codingAttempts) =>
								setState((old) => {
									if (!old) return old;
									const latest = new Map(
										old.legacyResults.map((a) => [a.id, a.passed]),
									);
									for (const a of codingAttempts)
										latest.set(a.problemId, a.correct);
									return {
										...old,
										codingAttempts,
										solved: [...latest].filter(([, v]) => v).map(([id]) => id),
										failed: [...latest].filter(([, v]) => !v).map(([id]) => id),
									};
								})
							}
						/>
					)}
				</main>
				<footer className="footer">
					<span>PiCareer / 01</span>
					<span>专注今天，走向下一程</span>
					<span>PRIVATE WORKSPACE</span>
				</footer>
			</div>
			{jobDraft && (
				<div className="modal-overlay">
					<section
						className="modal job-jd-dialog"
						role="dialog"
						aria-label="确认岗位 JD"
					>
						<h2>确认岗位 JD</h2>
						<p>{jobDraft.prepared.message}</p>
						<p className="muted">来源：{jobDraft.prepared.url}</p>
						<label className="field">
							<span>岗位职责与任职要求</span>
							<textarea
								value={jobDraft.prepared.text}
								onChange={(e) =>
									setJobDraft({
										...jobDraft,
										prepared: { ...jobDraft.prepared, text: e.target.value },
									})
								}
							/>
						</label>
						<div className="actions">
							<button onClick={() => setJobDraft(undefined)}>取消</button>
							<button
								className="primary"
								disabled={jobDraft.prepared.text.trim().length < 30}
								onClick={() =>
									acceptJD(jobDraft.target, jobDraft.job, {
										...jobDraft.prepared,
										text: `来源：${jobDraft.prepared.url}\n用户确认的 JD：\n${jobDraft.prepared.text}`,
									})
								}
							>
								确认 JD 并继续
							</button>
						</div>
					</section>
				</div>
			)}
			<AuthorizationDialog
				authorization={authorization}
				onSelectModels={() => {
					nav("settings");
					mainPane.current?.scrollTo({ top: 0 });
				}}
			/>
			{modal && (
				<div className="modal-overlay">
					<section className="modal">
						<span className="eyebrow">
							{modal.kind === "approval" ? "操作确认" : "账户授权"}
						</span>
						<h2>{modal.title}</h2>
						<pre>{modal.detail}</pre>
						{modal.kind !== "approval" && modal.kind !== "select" && (
							<input
								autoFocus
								type={modal.kind === "secret" ? "password" : "text"}
								value={modalValue}
								onChange={(e) => setModalValue(e.target.value)}
							/>
						)}
						<div className="actions">
							{(
								modal.options ?? [
									{ id: modalValue, label: "提交" },
									{ id: "", label: "取消" },
								]
							).map((o, i) => (
								<button
									key={i}
									className={i === 0 ? "primary" : ""}
									onClick={() => {
										void api.call("reply", { id: modal.id, value: o.id });
										setModal(undefined);
									}}
								>
									{o.label}
								</button>
							))}
						</div>
					</section>
				</div>
			)}
		</div>
	);
}
type Common = {
	state: AppState;
	refresh: () => Promise<void>;
	run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
	busy: boolean;
};
function Home({
	dashboardWorkspace,
	state,
	nav,
	selectChat,
	selectPlan,
}: {
	dashboardWorkspace: ReturnType<typeof useDashboard>;
	state: AppState;
	nav: (p: Page) => void;
	selectChat: (id: string) => void;
	selectPlan: (id: string) => void;
}) {
	const completed = state.plans.reduce((s, p) => s + p.completed, 0);
	const ensure = dashboardWorkspace.ensure;
	useEffect(() => {
		const check = () => {
			if (document.visibilityState === "visible") void ensure();
		};
		void ensure();
		window.addEventListener("focus", check);
		document.addEventListener("visibilitychange", check);
		return () => {
			window.removeEventListener("focus", check);
			document.removeEventListener("visibilitychange", check);
		};
	}, [ensure]);
	const cards: [Page, string, string, string, string][] = [
		[
			"interview",
			"mic",
			"模拟面试",
			"从目标 JD 出发，练习有针对性的表达。",
			"开始一场面试",
		],
		[
			"jobs",
			"search",
			"企业岗位检索",
			"找到适合你的城市、企业与下一份机会。",
			"发现目标岗位",
		],
		[
			"coding",
			"code",
			"LeetCode Hot100",
			"在 Python3 工作区，把思路写成答案。",
			"进入练习空间",
		],
		[
			"learn",
			"book",
			"八股知识背诵",
			"每次 10 条，逐步建立完整的知识体系。",
			"制定复习计划",
		],
		["resume","resume","简历优化","分析项目与科研材料，撰写经历或制作完整简历。","开始优化简历"],
	];
	return (
		<>
			<DashboardPanels workspace={dashboardWorkspace} />
			<div className="section-heading">
				<h2>PiCareer工作台</h2>
				<span>围绕目标岗位，准备每一步</span>
			</div>
			<div className="feature-grid">
				{cards.map(([p, icon, title, desc, action], i) => (
					<button
						className={`feature feature-${i}`}
						key={p}
						onClick={() => nav(p)}
					>
						<div className="feature-top">
							<span className="feature-icon">
								<Icon name={icon} size={24} />
							</span>
							<span className="feature-number">0{i + 1}</span>
						</div>
						<h3>{title}</h3>
						<p>{desc}</p>
						<div className="feature-action">
							{action}
							<Icon name="arrow" size={17} />
						</div>
					</button>
				))}
			</div>
			<div className="lower-grid">
				<section className="panel">
					<div className="section-heading">
						<h2>最近的对话</h2>
						<button className="link" onClick={() => nav("chat")}>
							全部记录 ↗
						</button>
					</div>
					{state.chats.length ? (
						state.chats.slice(0, 3).map((c) => (
							<button
								className="recent-row"
								key={c.id}
								onClick={() => selectChat(c.id)}
							>
								<span className="recent-icon">
									<Icon name="clock" />
								</span>
								<div>
									<b>{c.title}</b>
									<small>{new Date(c.updatedAt).toLocaleString("zh-CN")}</small>
								</div>
								<Icon name="arrow" size={16} />
							</button>
						))
					) : (
						<div className="quiet-empty">
							还没有对话。从一个问题开始，让思路落地。
						</div>
					)}
				</section>
				<section className="panel progress-panel">
					<div className="section-heading">
						<h2>一点点，持续向前</h2>
						<span className="badge">学习足迹</span>
					</div>
					<div className="stats">
						<div>
							<strong>
								{state.solved.length}
								<small>/100</small>
							</strong>
							<span>正确题目</span>
						</div>
						<div>
							<strong>{completed}</strong>
							<span>已背诵知识点</span>
						</div>
						<div>
							<strong>
								{state.interviews.filter((i) => i.status === "complete").length}
							</strong>
							<span>已完成面试</span>
						</div>
					</div>
					<div className="progress-track">
						<i style={{ width: `${state.solved.length}%` }} />
					</div>
					{state.plans[0] ? (
						<button
							className="link"
							onClick={() => selectPlan(state.plans[0].id)}
						>
							继续上一次复习 <Icon name="arrow" size={15} />
						</button>
					) : (
						<p className="muted">不必一次完成所有事，今天先迈出一步。</p>
					)}
				</section>
			</div>
		</>
	);
}
function Title({
	eyebrow,
	title,
	detail,
}: {
	eyebrow: string;
	title: string;
	detail: string;
}) {
	return (
		<div className="page-heading compact">
			<div>
				<span className="eyebrow">{eyebrow}</span>
				<h1>{title}</h1>
				<p>{detail}</p>
			</div>
		</div>
	);
}
function SettingsPage({
	state,
	refresh,
	run,
	busy,
	authorization,
}: Common & { authorization: AuthorizationUI }) {
	const [form, setForm] = useState<Settings>(state.settings),
		[key, setKey] = useState(""),
		[searchKey, setSearchKey] = useState(""),
		[models, setModels] = useState<ModelOption[]>([]),
		[providers, setProviders] = useState<ProviderOption[]>([]),
		[result, setResult] = useState("");
	useEffect(() => {
		void run(async () => {
			const r = await api.call("models", null);
			setModels(r.models);
			setProviders(r.providers);
		});
	}, []);
	useEffect(() => {
		if (authorization.state?.status !== "succeeded") return;
		const provider = authorization.state.provider;
		setKey("");
		setResult("已授权。请选择模型，保存后测试连接。");
		setForm((f) => ({
			...f,
			provider,
			model: f.provider === provider ? f.model : "",
		}));
		void run(async () => {
			const r = await api.call("models", null);
			setModels(r.models);
			setProviders(r.providers);
		});
	}, [
		authorization.state?.attemptId,
		authorization.state?.status,
		authorization.state?.modelsRefreshRequired,
	]);

	const save = async () => {
		await api.call("settings", { ...form, key, searchKey });
		setKey("");
		setSearchKey("");
		await refresh();
		setResult("设置已保存。");
	};
	return (
		<>
			<Title
				eyebrow="MAKE IT YOURS"
				title="模型与设置"
				detail="连接你的模型与搜索服务，所有凭据在本机加密保存。"
			/>
			<div className="settings-grid">
				<section className="panel padded">
					<div className="section-heading">
						<h2>模型连接</h2>
						<span className="badge">API / 订阅</span>
					</div>
					<Field label="模型供应商">
						<select
							value={form.provider}
							onChange={(e) => (
								setKey(""),
								setResult(""),
								setForm({ ...form, provider: e.target.value, model: "" })
							)}
						>
							<option value="custom">自定义兼容 API</option>
							{Array.from(new Set(models.map((m) => m.provider))).map((p) => (
								<option key={p} value={p}>
									{p}
								</option>
							))}
						</select>
					</Field>
					{form.provider === "custom" ? (
						<>
							<Field label="服务地址">
								<input
									value={form.baseUrl}
									onChange={(e) =>
										setForm({ ...form, baseUrl: e.target.value })
									}
									placeholder="https://api.example.com/v1"
								/>
							</Field>
							<Field label="接口协议">
								<select
									value={form.api}
									onChange={(e) => setForm({ ...form, api: e.target.value })}
								>
									<option value="openai-completions">
										Chat Completions 兼容接口
									</option>
									<option value="openai-responses">Responses 兼容接口</option>
									<option value="anthropic-messages">
										Anthropic Messages 兼容接口
									</option>
								</select>
							</Field>
							<Field label="模型名称">
								<input
									value={form.model}
									onChange={(e) => setForm({ ...form, model: e.target.value })}
									placeholder="例如 deepseek-chat"
								/>
							</Field>
						</>
					) : (
						<Field label="模型">
							<select
								value={form.model}
								onChange={(e) => setForm({ ...form, model: e.target.value })}
							>
								<option value="">请选择模型</option>
								{models
									.filter((m) => m.provider === form.provider)
									.map((m) => (
										<option key={m.id} value={m.id}>
											{m.name} / {m.id}
										</option>
									))}
							</select>
						</Field>
					)}
					{providers.find((p) => p.id === form.provider)?.credentialType ===
					"oauth" ? (
						<p className="muted">已保存订阅授权，无需填写 API Key。</p>
					) : (
						<Field
							label={`API Key ${state.settings.provider === form.provider && state.settings.hasKey ? "· 已保存凭据" : ""}`}
						>
							<input
								type="password"
								autoComplete="off"
								value={key}
								onChange={(e) => setKey(e.target.value)}
								placeholder="留空保留已保存的密钥"
							/>
						</Field>
					)}
					<div className="actions">
						<button
							className="primary"
							disabled={busy || !form.model}
							onClick={() => void run(save)}
						>
							保存设置
						</button>
						<button
							disabled={busy || !form.model}
							onClick={() =>
								void run(async () => {
									await save();
									setResult(await api.call("testModel", null));
								})
							}
						>
							测试连接
						</button>
					</div>
					{result && <div className="inline-success">{result}</div>}
				</section>
				<div>
					<section className="panel padded">
						<h2>订阅授权</h2>
						<p className="muted">
							使用 Pi 提供的授权流程。可用模型与额度取决于对应账户。
						</p>
						<div className="oauth-list">
							{providers.map((p) => (
								<div className="oauth-row" key={p.id}>
									<div>
										<b>{p.name}</b>
										<small>
											{p.credentialType === "oauth" ? "已保存授权" : "未授权"} ·{" "}
											{p.subscription ? "订阅授权" : "OAuth 授权"}
										</small>
									</div>
									<button
										disabled={busy || isAuthorizing(authorization.state)}
										onClick={() => void authorization.start(p.id)}
									>
										{p.credentialType === "oauth" ? "重新连接" : "连接"}
									</button>
									<button
										disabled={
											busy ||
											isAuthorizing(authorization.state) ||
											p.credentialType !== "oauth"
										}
										className="subtle"
										onClick={() =>
											void run(async () => {
												await api.call("logout", { provider: p.id });
												await refresh();
												const r = await api.call("models", null);
												setModels(r.models);
												setProviders(r.providers);
												setResult("已退出授权");
											})
										}
									>
										退出
									</button>
								</div>
							))}
						</div>
					</section>
					<section className="panel padded mt">
						<h2>联网搜索</h2>
						<p className="muted">
							已内置免密钥搜索与公开网页读取。Tavily
							为可选增强，调用失败时自动尝试内置搜索。
							{state.settings.hasSearchKey
								? "已保存 Tavily 密钥。"
								: "无需填写密钥即可使用。"}
						</p>
						<Field label="Tavily API Key（可选）">
							<input
								type="password"
								value={searchKey}
								onChange={(e) => setSearchKey(e.target.value)}
								placeholder="tvly-…"
							/>
						</Field>
						<button disabled={busy} onClick={() => void run(save)}>
							保存搜索配置
						</button>
					</section>
					<section className="panel padded mt">
						<h2>本地数据</h2>
						<p className="muted">
							聊天、代码与学习进度保存在本机。调用模型时，当前任务所需的内容会发送至你配置的服务。Python
							练习可离线运行。
						</p>
					</section>
				</div>
			</div>
		</>
	);
}
function InterviewPage({
	state,
	refresh,
	run,
	busy,
	seed,
	jobSeed,
	selected,
	select,
}: Common & {
	seed: string;
	jobSeed?: Job;
	selected?: string;
	select: (id?: string) => void;
}) {
	const [company, setCompany] = useState(jobSeed?.company ?? ""),
		[role, setRole] = useState(jobSeed?.role ?? "Agent 开发工程师"),
		[jd, setJD] = useState(seed),
		[answer, setAnswer] = useState("");
	const i = state.interviews.find((i) => i.id === selected);
	return (
		<>
			<Title
				eyebrow="PRACTICE WITH PURPOSE"
				title="模拟面试"
				detail="结合岗位要求与公开资料，练习回答，也练习清楚地表达。"
			/>
			{!i ? (
				<>
					<section className="panel padded">
						<div className="two-cols">
							<Field label="目标企业">
								<input
									value={company}
									onChange={(e) => setCompany(e.target.value)}
									placeholder="填写企业名称"
								/>
							</Field>
							<Field label="目标岗位">
								<input value={role} onChange={(e) => setRole(e.target.value)} />
							</Field>
						</div>
						<Field label="岗位 JD · 文本或公开网页链接">
							<textarea
								rows={8}
								value={jd}
								onChange={(e) => setJD(e.target.value)}
								placeholder="粘贴岗位职责、任职要求，或公开招聘链接…"
							/>
						</Field>
						<div className="row between">
							<span className="muted">
								8 道主问题 · 每题最多 2 次追问 · 可随时结束
							</span>
							<button
								className="primary"
								disabled={busy || !company.trim() || !role.trim() || !jd.trim()}
								onClick={() =>
									void run(async () => {
										const r = await api.call("startInterview", {
											company,
											role,
											jd,
										});
										await refresh();
										select(r.id);
									})
								}
							>
								{busy ? "搜集资料并准备问题…" : "开始模拟面试"}
								<Icon name="arrow" size={17} />
							</button>
						</div>
					</section>
					<HistoryCards
						title="历次面试"
						records={state.interviews.map((i) => ({
							id: i.id,
							title: `${i.company} · ${i.role}`,
							detail:
								i.status === "complete"
									? "查看面试报告"
									: `继续第 ${i.current + 1} / 8 题`,
						}))}
						select={select}
					/>
				</>
			) : (
				<>
					<div className="section-heading">
						<h2>
							{i.company} · {i.role}
						</h2>
						<div className="actions">
							<span className="badge">
								{i.status === "complete"
									? "已完成"
									: `主问题 ${i.current + 1}/8 · 追问 ${i.followups}/2`}
							</span>
							<button disabled={busy} onClick={() => select(undefined)}>
								返回列表
							</button>
						</div>
					</div>
					{i.warning && <div className="alert">{i.warning}</div>}
					<div className="interview-grid">
						<section className="panel padded">
							{i.transcript.map((m, n) => (
								<div key={n} className={`message ${m.role}`}>
									<span className="message-name">
										{m.role === "user" ? "你的回答" : "面试官 · 模拟问题"}
									</span>
									<Text text={m.text} />
								</div>
							))}
							{i.report ? (
								<div className="report">
									<h2>面试复盘</h2>
									<Text text={i.report} />
								</div>
							) : (
								<div className="mt">
									<textarea
										rows={6}
										value={answer}
										onChange={(e) => setAnswer(e.target.value)}
										placeholder="组织你的回答，可结合具体项目、取舍和验证方法…"
									/>
									<div className="actions mt">
										<button
											disabled={busy}
											onClick={() =>
												void run(async () => {
													await api.call("answerInterview", {
														id: i.id,
														answer: "",
														finish: true,
													});
													await refresh();
												})
											}
										>
											结束并生成报告
										</button>
										<button
											className="primary"
											disabled={busy || !answer.trim()}
											onClick={() =>
												void run(async () => {
													await api.call("answerInterview", {
														id: i.id,
														answer,
													});
													setAnswer("");
													await refresh();
												})
											}
										>
											{busy ? "正在处理…" : "提交回答"}
										</button>
									</div>
								</div>
							)}
						</section>
						<aside className="panel padded source-panel">
							<h3>本次参考资料</h3>
							<p className="muted small">
								公开经验用于参考，不代表企业当前正式流程。没有来源支持的问题属于模拟题。
							</p>
							<Sources sources={i.sources} />
						</aside>
					</div>
				</>
			)}
		</>
	);
}
function HistoryCards({
	title,
	records,
	select,
}: {
	title: string;
	records: { id: string; title: string; detail: string }[];
	select: (id: string) => void;
}) {
	return (
		<>
			<div className="section-heading">
				<h2>{title}</h2>
				<span>{records.length} 条记录</span>
			</div>
			<div className="history-cards">
				{records.map((r) => (
					<button
						className="panel history-card"
						key={r.id}
						onClick={() => select(r.id)}
					>
						<b>{r.title}</b>
						<span>{r.detail}</span>
						<Icon name="arrow" size={17} />
					</button>
				))}
			</div>
		</>
	);
}
function LearnPage({
	state,
	refresh,
	run,
	busy,
	seed,
	selected,
	select,
}: Common & {
	seed: string;
	selected?: string;
	select: (id?: string) => void;
}) {
	const [jd, setJD] = useState(seed),
		[company, setCompany] = useState(""),
		[sources, setSources] = useState<Source[]>([]),
		[answers, setAnswers] = useState<Record<string, string>>({}),
		[command, setCommand] = useState(""),
		[showAll, setShowAll] = useState(false);
	const p = state.plans.find((p) => p.id === selected),
		q = p?.quizzes.at(-1);
	const advance = () => {
		if (!p) return;
		void run(async () => {
			await api.call("advancePlan", { id: p.id, token: p.batchToken });
			setCommand("");
			await refresh();
		});
	};
	return (
		<>
			<Title
				eyebrow="LEARN · RECALL · GROW"
				title="八股知识背诵"
				detail={`从 JD 找到复习重点。预置 ${knowledge.length} 条知识点，每 10 条前进一步。`}
			/>
			{!p ? (
				<>
					<section className="panel padded">
						<Field label="目标岗位 JD">
							<textarea
								rows={7}
								value={jd}
								onChange={(e) => setJD(e.target.value)}
								placeholder="粘贴 JD，生成针对你的知识复习计划…"
							/>
						</Field>
						<div className="row between">
							<span className="muted">每 50 条进行小测 · 自动保存进度</span>
							<button
								disabled={busy || !jd.trim()}
								className="primary"
								onClick={() =>
									void run(async () => {
										const p = await api.call("startPlan", { jd, company });
										await refresh();
										select(p.id);
										setAnswers({});
									})
								}
							>
								{busy ? "正在匹配知识点…" : "生成背诵计划"}
								<Icon name="arrow" size={17} />
							</button>
						</div>
					</section>
					<section className="panel padded mt">
						<h3>补充企业面经</h3>
						<p className="muted">
							检索华为等企业的公开题库、面经。保留来源与时间，仅作参考。
						</p>
						<div className="row">
							<input
								value={company}
								onChange={(e) => setCompany(e.target.value)}
								placeholder="企业名称，例如华为"
							/>
							<button
								disabled={busy || !company.trim()}
								onClick={() =>
									void run(async () =>
										setSources(
											await api.call("companySources", {
												company,
												role: "Agent 开发",
											}),
										),
									)
								}
							>
								检索公开资料
							</button>
						</div>
						<Sources sources={sources} />
					</section>
					<HistoryCards
						title="我的复习计划"
						records={state.plans.map((p) => ({
							id: p.id,
							title: p.jd.slice(0, 45),
							detail: `${p.completed}/${p.items.length} 条 · ${p.status === "quiz" ? "待完成小测" : p.status === "complete" ? "已完成" : "继续背诵"}`,
						}))}
						select={(id) => {
							select(id);
							setAnswers({});
						}}
					/>
				</>
			) : (
				<>
					<div className="panel padded">
						<div className="row between">
							<div>
								<span className="eyebrow">YOUR STUDY PLAN</span>
								<h2>共 {p.items.length} 条知识点需要背诵</h2>
								<p className="muted">{p.reason}</p>
							</div>
							<button disabled={busy} onClick={() => select(undefined)}>
								返回计划
							</button>
						</div>
						<div className="row between">
							<span>
								已完成 {p.completed} / {p.items.length}
							</span>
							<span className="badge">
								{p.status === "quiz"
									? "阶段测验"
									: p.status === "complete"
										? "计划已完成"
										: `当前第 ${p.completed + 1}–${Math.min(p.completed + 10, p.items.length)} 条`}
							</span>
						</div>
						<div className="progress-track mt">
							<i
								style={{ width: `${(p.completed / p.items.length) * 100}%` }}
							/>
						</div>
					</div>
					{!!p.sources?.length && (
						<section className="panel padded mt">
							<h3>本计划参考的企业资料</h3>
							<p className="muted">
								公开资料与网友面经仅作参考，非官方题库。资料快照随计划保存。
							</p>
							<Sources sources={p.sources} />
						</section>
					)}
					{p.status === "learning" ? (
						<>
							<div className="study-grid">
								{p.items.slice(p.completed, p.completed + 10).map((k, n) => (
									<article className="panel study-card" key={k.id}>
										<div className="row between">
											<span className="number-label">
												{String(p.completed + n + 1).padStart(2, "0")}
											</span>
											<span className="badge">
												{k.category} · {k.level}
											</span>
										</div>
										<h3>{k.question}</h3>
										<p>{k.answer}</p>
										<details>
											<summary>展开理解与出处</summary>
											<p>{k.explanation}</p>
											<button
												className="link"
												onClick={() =>
													api.call("openExternal", { url: k.source })
												}
											>
												参考文档 ↗
											</button>
											<small className="muted">
												{" "}
												{k.id} · v{k.version}
											</small>
										</details>
									</article>
								))}
							</div>
							<div className="panel padded row between">
								<input
									className="command-input"
									value={command}
									onChange={(e) => setCommand(e.target.value)}
									placeholder="输入：这10条背完了"
									onKeyDown={(e) => {
										if (e.key === "Enter" && command.trim() === "这10条背完了")
											advance();
									}}
								/>
								<button className="primary" disabled={busy} onClick={advance}>
									这{Math.min(10, p.items.length - p.completed)}条背完了{" "}
									<Icon name="check" size={17} />
								</button>
							</div>
						</>
					) : p.status === "quiz" && q ? (
						<section className="panel padded mt">
							<span className="eyebrow">
								RECALL CHECK · {q.from + 1}–{q.to}
							</span>
							<h2>停一下，检验真正记住了多少</h2>
							<p className="muted">
								本次 {q.itemIds.length}{" "}
								题，不设及格门槛。不会的题目填写“不会”，完成后查看解析。
							</p>
							{q.itemIds.map((id, n) => {
								const k = p.items.find((k) => k.id === id)!;
								return (
									<Field key={id} label={`${n + 1}. ${k.question}`}>
										<textarea
											rows={3}
											value={answers[id] ?? ""}
											onChange={(e) =>
												setAnswers({ ...answers, [id]: e.target.value })
											}
										/>
									</Field>
								);
							})}
							<button
								className="primary"
								disabled={busy || q.itemIds.some((id) => !answers[id]?.trim())}
								onClick={() =>
									void run(async () => {
										await api.call("submitQuiz", {
											id: p.id,
											quizId: q.id,
											answers,
										});
										setAnswers({});
										await refresh();
									})
								}
							>
								{busy ? "正在生成反馈…" : "提交小测"}
							</button>
						</section>
					) : (
						<Empty
							title="这份计划，已经完成"
							detail="回看小测中的薄弱点，或用新的岗位 JD 开启下一份计划。"
						/>
					)}
					{p.quizzes.some((q) => q.reviewIds?.length) && (
						<section className="panel padded mt">
							<h3>错题与待复习清单</h3>
							<p className="muted">
								评分不足 7 分或暂未评分的题目。复习不影响后续进度。
							</p>
							{p.items
								.filter((k) =>
									p.quizzes.some((q) => q.reviewIds?.includes(k.id)),
								)
								.map((k) => (
									<details key={k.id}>
										<summary>
											{k.id} · {k.question}
										</summary>
										<p>{k.answer}</p>
										<p className="muted">{k.explanation}</p>
									</details>
								))}
						</section>
					)}
					{p.quizzes.some((q) => q.submitted) && (
						<section className="panel padded mt">
							<h2>小测记录与复习建议</h2>
							{p.quizzes
								.filter((q) => q.submitted)
								.map((q) => (
									<details key={q.id} className="quiz-history">
										<summary>
											知识点 {q.from + 1}–{q.to} · 查看反馈
										</summary>
										<Text text={q.feedback ?? ""} />
									</details>
								))}
							<button className="link" onClick={() => setShowAll(!showAll)}>
								{showAll ? "收起知识列表" : "查看本计划全部知识点"}
							</button>
							{showAll &&
								p.items.map((k) => (
									<details key={k.id}>
										<summary>
											{k.id} {k.question}
										</summary>
										<p>{k.answer}</p>
									</details>
								))}
						</section>
					)}
				</>
			)}
		</>
	);
}
function CodeEditor({
	value,
	onChange,
	readOnly = false,
}: {
	value: string;
	onChange: (v: string) => void;
	readOnly?: boolean;
}) {
	const host = useRef<HTMLDivElement>(null),
		editor = useRef<monaco.editor.IStandaloneCodeEditor>(null),
		fn = useRef(onChange),
		syncing = useRef(false);
	fn.current = onChange;
	useEffect(() => {
		monaco.editor.defineTheme("picareer", {
			base: "vs",
			inherit: true,
			rules: [],
			colors: {
				"editor.background": "#fcfcfa",
				"editor.foreground": "#202020",
				"editorLineNumber.foreground": "#777777",
				"scrollbarSlider.background": "#20202038",
				"scrollbarSlider.hoverBackground": "#20202061",
				"scrollbarSlider.activeBackground": "#20202080",
				"editor.lineHighlightBackground": "#f1f4ef",
				"editor.selectionBackground": "#dde9e1",
			},
		});
		const e = monaco.editor.create(host.current!, {
			value,
			language: "python",
			theme: "picareer",
			fontSize: 14,
			lineHeight: 24,
			fontFamily: "Cascadia Code, Consolas, monospace",
			minimap: { enabled: false },
			automaticLayout: true,
			scrollBeyondLastLine: false,
			scrollbar: {
				verticalScrollbarSize: 6,
				horizontalScrollbarSize: 6,
				useShadows: false,
			},
			padding: { top: 16 },
			tabSize: 4,
		});
		editor.current = e;
		const sub = e.onDidChangeModelContent(() => {
			if (!syncing.current) fn.current(e.getValue());
		});
		return () => {
			sub.dispose();
			const model = e.getModel();
			e.dispose();
			model?.dispose();
		};
	}, []);
	useEffect(() => {
		if (editor.current && editor.current.getValue() !== value) {
			syncing.current = true;
			editor.current.setValue(value);
			syncing.current = false;
		}
	}, [value]);
	useEffect(() => {
		editor.current?.updateOptions({ readOnly });
	}, [readOnly]);
	return <div className="code-editor" ref={host} />;
}
createRoot(document.getElementById("root")!).render(<App />);

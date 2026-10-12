import React, { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./chat.css";
import type {
	Chat,
	ChatEntry,
	ChatTurn,
	ChatRun,
	ChatDeletionPreview,
} from "../shared/types";
import {
	groupTurns,
	progressLines,
	progressSummary,
} from "../shared/chat-progress";
const api = window.picareer;

export function mergeChats(...lists: Chat[][]): Chat[] {
	const map = new Map<string, Chat>();
	for (const list of lists)
		for (const chat of list) {
			if ((map.get(chat.id)?.revision ?? -1) <= (chat.revision ?? 0))
				map.set(chat.id, chat);
		}
	return [...map.values()].sort((a, b) =>
		b.updatedAt.localeCompare(a.updatedAt),
	);
}
export function useChatWorkspace(
	chats: Chat[],
	selected: string | undefined,
	select: (id: string) => void,
	update: (chat: Chat) => void,
	error: (message: string) => void,
) {
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [pendingId, setPendingId] = useState<string>();
	const [creating, setCreating] = useState(false);
	useEffect(() => {
		const ids = new Set(chats.map((chat) => chat.id));
		setDrafts((old) =>
			Object.fromEntries(
				Object.entries(old).filter(([id]) => id === "new" || ids.has(id)),
			),
		);
	}, [chats.length]);
	const sending = useRef(false);
	const chat = chats.find((c) => c.id === selected);
	const activeId =
		chats.find((c) => c.run?.status === "running")?.id ?? pendingId;
	const handleError = (e: unknown) =>
		error(e instanceof Error ? e.message : String(e));
	const newChat = async () => {
		setCreating(true);
		try {
			const c = await api.call("createChat", {});
			update(c);
			if (!selected) setDrafts((d) => ({ ...d, [c.id]: d.new ?? "", new: "" }));
			select(c.id);
			return c;
		} catch (e) {
			handleError(e);
			return undefined;
		} finally {
			setCreating(false);
		}
	};
	const send = async () => {
		const key = selected ?? "new",
			text = drafts[key]?.trim();
		if (!text || sending.current || activeId) return;
		sending.current = true;
		setPendingId(selected ?? "new");
		error("");
		let target = chat;
		try {
			target ??= await newChat();
			if (!target) return;
			setPendingId(target.id);
			const targetId = target.id;
			setDrafts((d) => ({ ...d, [key]: "", [targetId]: "" }));
			const response = await api.call("chat", { id: target.id, text });
			update(response);
		} catch (e) {
			handleError(e);
			if (target) {
				try {
					update(await api.call("chatSnapshot", { id: target.id }));
				} catch {
					/* Backend exit event preserves the visible transcript. */
				}
			}
		} finally {
			sending.current = false;
			setPendingId(undefined);
		}
	};
	const chooseDirectory = async () => {
		try {
			const cwd = await api.call("chooseDirectory", null);
			if (!cwd) return;
			const c = chat ?? (await newChat());
			if (c) update(await api.call("setChatDirectory", { id: c.id, cwd }));
		} catch (e) {
			handleError(e);
		}
	};
	return {
		chat,
		activeId,
		creating,
		newChat,
		send,
		chooseDirectory,
		draft: drafts[selected ?? "new"] ?? "",
		setDraft: (text: string) =>
			setDrafts((d) => ({ ...d, [selected ?? "new"]: text })),
		stop: async () => {
			if (activeId && activeId !== "new")
				try {
					await api.call("stopChat", { id: activeId });
				} catch (e) {
					handleError(e);
				}
		},
	};
}
type Workspace = ReturnType<typeof useChatWorkspace>;

export function ChatHistory({
	chats,
	selected,
	choose,
	create,
	update,
	deleted,
	onError,
}: {
	chats: Chat[];
	selected?: string;
	choose: (id: string) => void;
	create: () => void;
	update: (chat: Chat) => void;
	deleted: (id: string) => void;
	onError: (text: string) => void;
}) {
	const [menu, setMenu] = useState<{ chat: Chat; x: number; y: number }>();
	const [renaming, setRenaming] = useState<Chat>();
	const [deleting, setDeleting] = useState<Chat>();
	const [deletionPreview, setDeletionPreview] = useState<ChatDeletionPreview>();
	const [deletionError, setDeletionError] = useState("");
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);
	const dialog = useRef<HTMLDialogElement>(null);
	const deleteDialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		if (!deleting) return;
		deleteDialog.current?.showModal();
		let live = true;
		setDeletionPreview(undefined);
		setDeletionError("");
		setSaving(true);
		api
			.call("previewDeleteChat", { id: deleting.id })
			.then((p) => {
				if (live) setDeletionPreview(p);
			})
			.catch((e) => {
				if (live) setDeletionError(String(e.message ?? e));
			})
			.finally(() => {
				if (live) setSaving(false);
			});
		return () => {
			live = false;
		};
	}, [deleting]);
	useEffect(() => {
		if (renaming) dialog.current?.showModal();
	}, [renaming]);
	useEffect(() => {
		if (!menu) return;
		const close = () => setMenu(undefined);
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		window.addEventListener("click", close);
		window.addEventListener("blur", close);
		window.addEventListener("keydown", key);
		return () => {
			window.removeEventListener("click", close);
			window.removeEventListener("blur", close);
			window.removeEventListener("keydown", key);
		};
	}, [menu]);
	const save = async () => {
		if (!renaming || !name.trim() || [...name.trim()].length > 80 || saving)
			return;
		setSaving(true);
		try {
			update(await api.call("renameChat", { id: renaming.id, title: name }));
			setRenaming(undefined);
		} catch (e) {
			onError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};
	return (
		<div className="chat-history" aria-label="对话列表">
			<button className="new-chat" onClick={create}>
				＋ 新对话
			</button>
			<div className="chat-history-list">
				{!chats.length && <small className="muted">对话会自动保存在这里</small>}
				{chats.map((c) => (
					<button
						key={c.id}
						title={c.title}
						aria-current={c.id === selected ? "page" : undefined}
						className={`chat-history-row ${c.id === selected ? "selected" : ""}`}
						onClick={() => choose(c.id)}
						onContextMenu={(e) => {
							e.preventDefault();
							setMenu({
								chat: c,
								x: Math.min(e.clientX, window.innerWidth - 170),
								y: Math.min(e.clientY, window.innerHeight - 115),
							});
						}}
						onKeyDown={(e) => {
							if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
								e.preventDefault();
								const r = e.currentTarget.getBoundingClientRect();
								setMenu({
									chat: c,
									x: r.left,
									y: Math.min(r.bottom, window.innerHeight - 115),
								});
							}
						}}
					>
						<span>
							{c.run?.status === "running" && <i className="pulse-dot" />}{" "}
							{c.title}
						</span>
						<small>{new Date(c.updatedAt).toLocaleDateString("zh-CN")}</small>
					</button>
				))}
			</div>
			{menu && (
				<div
					className="chat-context-menu"
					role="menu"
					style={{ left: menu.x, top: menu.y }}
				>
					<button
						role="menuitem"
						autoFocus
						onClick={() => {
							setName(menu.chat.title);
							setRenaming(menu.chat);
							setMenu(undefined);
						}}
					>
						重命名
					</button>
					<button
						role="menuitem"
						className="danger-text"
						onClick={() => {
							setDeleting(menu.chat);
							setMenu(undefined);
						}}
					>
						删除
					</button>
				</div>
			)}
			{deleting && (
				<dialog
					ref={deleteDialog}
					className="rename-dialog"
					aria-labelledby="delete-title"
					onCancel={(e) => {
						e.preventDefault();
						if (!saving) setDeleting(undefined);
					}}
				>
					<h2 id="delete-title">删除对话</h2>
					<p>确定删除“{deleting.title}”及其聊天记录吗？</p>
					{!deletionPreview && saving && (
						<p role="status">
							{deleting.run?.status === "running"
								? "正在停止任务并核对清理清单…"
								: "正在核对清理清单…"}
						</p>
					)}
					{deletionPreview && (
						<>
							<p>
								同时将本对话新建的 {deletionPreview.files.length}{" "}
								个文件移入回收站。
							</p>
							<small className="muted">
								一并清理本对话创建且已为空的子目录。
							</small>
							{!!deletionPreview.files.length && (
								<details className="deletion-files">
									<summary>查看清理清单</summary>
									<ul>
										{deletionPreview.files.map((f) => (
											<li key={f.path}>{f.path}</li>
										))}
									</ul>
								</details>
							)}
							{!!deletionPreview.skipped.length && (
								<details className="deletion-files">
									<summary>
										{deletionPreview.skipped.length} 个文件跳过清理
									</summary>
									<ul>
										{deletionPreview.skipped.map((f) => (
											<li key={f.path}>
												{f.path}
												<small>{f.reason}</small>
											</li>
										))}
									</ul>
								</details>
							)}
							{!!deletionPreview.undeclaredCommands && (
								<p className="muted">
									有 {deletionPreview.undeclaredCommands}{" "}
									次命令未登记产物；未登记的文件不在此次清单内。
								</p>
							)}
						</>
					)}
					{deletionError && (
						<p className="deletion-error" role="alert">
							{deletionError}
						</p>
					)}
					<div className="actions">
						<button
							autoFocus
							disabled={saving}
							onClick={() => setDeleting(undefined)}
						>
							取消
						</button>
						<button
							className="danger-text"
							disabled={saving || !deletionPreview}
							onClick={async () => {
								setSaving(true);
								try {
									const result = await api.call("deleteChat", {
										id: deleting.id,
										token: deletionPreview?.token,
									});
									if (!result.deleted) {
										setDeletionPreview(result.preview);
										setDeletionError(
											result.errors?.join("\n") ??
												"清理范围发生变化，请核对清单后再次确认。",
										);
										return;
									}
									deleted(deleting.id);
									setDeleting(undefined);
								} catch (e) {
									setDeletionError(e instanceof Error ? e.message : String(e));
								} finally {
									setSaving(false);
								}
							}}
						>
							{saving ? "正在删除…" : "删除对话"}
						</button>
					</div>
				</dialog>
			)}
			{renaming && (
				<dialog
					ref={dialog}
					className="rename-dialog"
					aria-labelledby="rename-title"
					onCancel={(e) => {
						e.preventDefault();
						if (!saving) setRenaming(undefined);
					}}
				>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							void save();
						}}
					>
						<h2 id="rename-title">重命名对话</h2>
						<label>
							对话名称
							<input
								autoFocus
								value={name}
								onFocus={(e) => e.target.select()}
								onChange={(e) => setName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && e.nativeEvent.isComposing)
										e.preventDefault();
								}}
							/>
						</label>
						<small className="muted">{[...name.trim()].length} / 80 字</small>
						<div className="actions">
							<button
								type="button"
								disabled={saving}
								onClick={() => setRenaming(undefined)}
							>
								取消
							</button>
							<button
								className="primary"
								disabled={
									saving || !name.trim() || [...name.trim()].length > 80
								}
							>
								保存
							</button>
						</div>
					</form>
				</dialog>
			)}
		</div>
	);
}
function ChatText({ text }: { text: string }) {
	return (
		<div className="chat-prose">
			<Markdown
				remarkPlugins={[remarkGfm]}
				skipHtml
				components={{
					a: ({ href, children }) =>
						href && /^https?:\/\//i.test(href) ? (
							<a
								href={href}
								onClick={(e) => {
									e.preventDefault();
									void api.call("openExternal", { url: href }).catch(() => {});
								}}
							>
								{children}
							</a>
						) : (
							<span>{children}</span>
						),
					img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : "[图片]"}</span>,
				}}
			>
				{text}
			</Markdown>
		</div>
	);
}
function Entry({ entry }: { entry: ChatEntry }) {
	if (entry.role === "tool") return null;
	return (
		<article
			className={`chat-message ${entry.role}`}
			aria-label={entry.role === "user" ? "用户消息" : "助手消息"}
		>
			<ChatText text={entry.text} />
		</article>
	);
}
function TurnProgress({
	entries,
	run,
	running,
}: {
	entries: ChatEntry[];
	run?: ChatRun;
	running: boolean;
}) {
	return (
		<div
			className={`turn-progress ${running ? "running" : "settled"}`}
			role="status"
			aria-live="polite"
		>
			{running ? (
				progressLines(entries, run).map((line, i) => (
					<div className="activity-line" key={i}>
						{line}
					</div>
				))
			) : (
				<div>{progressSummary(entries, run)}</div>
			)}
		</div>
	);
}
export function ChatPage({
	workspace,
	model,
	settings,
}: {
	workspace: Workspace;
	model: string;
	settings: () => void;
}) {
	const { chat, activeId, draft, setDraft, send, stop, chooseDirectory } =
		workspace;
	const box = useRef<HTMLDivElement>(null),
		following = useRef(true);
	const [showLatest, setShowLatest] = useState(false);
	const entries =
		chat?.entries ??
		chat?.messages.map((m, i) => ({ ...m, id: String(i), turnId: "legacy" })) ??
		[];
	const running =
		chat?.run?.status === "running" ||
		(!!activeId && activeId === (chat?.id ?? "new"));
	useEffect(() => {
		following.current = true;
		setShowLatest(false);
		if (box.current) box.current.scrollTop = box.current.scrollHeight;
	}, [chat?.id]);
	useEffect(() => {
		if (!box.current) return;
		if (following.current) box.current.scrollTop = box.current.scrollHeight;
		else setShowLatest(true);
	}, [chat?.revision]);
	return (
		<section className="chat-workspace panel" aria-label="通用 Agent 对话">
			<div className="chat-header">
				<h1 title={chat?.title ?? "通用 Agent"}>
					{chat?.title ?? "通用 Agent"}
				</h1>
			</div>
			<div
				className="chat-messages"
				ref={box}
				onScroll={() => {
					if (box.current) {
						following.current =
							box.current.scrollHeight -
								box.current.scrollTop -
								box.current.clientHeight <
							90;
						if (following.current) setShowLatest(false);
					}
				}}
			>
				{!entries.length && (
					<div className="chat-welcome">
						<span className="welcome-spark">✧</span>
						<h2>今天想一起做些什么？</h2>
						<p>查阅资料、解答问题，或选择一个项目一起动手。</p>
						<button
							onClick={() => setDraft("今天是几月几号？长沙的天气怎么样？")}
						>
							查询今天的日期与长沙天气 ↗
						</button>
					</div>
				)}
				{groupTurns(entries).map((group) => {
					const turn =
						chat?.turns?.find((turn) => turn.turnId === group.id) ??
						(chat?.run?.turnId === group.id && chat.run.status !== "running"
							? { ...chat.run, endedAt: "" }
							: undefined);
					const active = running && chat?.run?.turnId === group.id;
					return (
						<React.Fragment key={group.id}>
							{group.entries
								.filter((e) => e.role === "user")
								.map((e) => (
									<Entry key={e.id} entry={e} />
								))}
							<TurnProgress
								entries={group.entries}
								run={active ? chat?.run : turn}
								running={active}
							/>
							{group.entries
								.filter((e) => e.role === "assistant")
								.map((e) => (
									<Entry key={e.id} entry={e} />
								))}
							{turn && <TurnEnd turn={turn} />}
						</React.Fragment>
					);
				})}
			</div>
			{showLatest && (
				<button
					className="latest-message"
					onClick={() => {
						following.current = true;
						setShowLatest(false);
						if (box.current) box.current.scrollTop = box.current.scrollHeight;
					}}
				>
					↓ 回到最新消息
				</button>
			)}
			<div className="chat-composer">
				<textarea
					disabled={workspace.creating}
					aria-label="对话消息"
					placeholder="输入你的问题，Shift + Enter 换行…"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (
							e.key === "Enter" &&
							!e.shiftKey &&
							!e.nativeEvent.isComposing &&
							e.keyCode !== 229
						) {
							e.preventDefault();
							void send();
						}
					}}
				/>
				<div className="composer-bottom">
					<div className="composer-tools">
						<button
							className="model-chip composer-model"
							onClick={settings}
							title={`当前模型：${model || "尚未配置"}；点击打开模型设置`}
						>
							<i className={model ? "online-dot" : "offline-dot"} />
							<span>{model || "选择模型"}</span>
						</button>
						<button
							className="composer-directory subtle"
							disabled={running}
							onClick={() => void chooseDirectory()}
							title={`${chat?.cwd ?? "选择 Agent 工作目录"}；写入文件和执行命令前会请求确认`}
						>
							▱ {chat?.cwd ? "更换工作目录" : "选择工作目录"}
						</button>
					</div>
					{activeId && !running && (
						<small className="other-chat-running">另一段对话正在运行</small>
					)}
					{running ? (
						<button onClick={() => void stop()}>停止生成</button>
					) : (
						<button
							className="primary"
							disabled={!!activeId || !draft.trim()}
							onClick={() => {
								following.current = true;
								void send();
							}}
						>
							发送 →
						</button>
					)}
				</div>
			</div>
		</section>
	);
}
function TurnEnd({ turn }: { turn: ChatTurn }) {
	const context = turn.context;
	const known =
		context &&
		context.tokens !== null &&
		context.percent !== null &&
		context.contextWindow > 0;
	const format = (n: number) =>
		n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
	return (
		<div
			className={`chat-turn-end ${turn.status}`}
			role="status"
			data-turn-id={turn.turnId}
			title={turn.model ? `本轮模型：${turn.model}` : undefined}
		>
			<span className="turn-end-label">
				{
					{
						complete: "回答结束",
						cancelled: "已停止",
						error: "本轮失败",
						interrupted: "本轮已中断",
						running: "正在处理",
					}[turn.status]
				}
			</span>
			<span>
				{known
					? `Context 估算剩余 ${Math.max(0, Math.min(100, 100 - context.percent!)).toFixed(1)}% · 已用 ${format(context.tokens!)} / ${format(context.contextWindow)} tokens`
					: "Context 余量暂不可用"}
			</span>
			{turn.error && <div className="turn-end-error">{turn.error}</div>}
		</div>
	);
}

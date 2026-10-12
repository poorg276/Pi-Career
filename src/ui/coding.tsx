import React, { useEffect, useRef, useState } from "react";
import type {
	AppState,
	CodingAttempt,
	OfficialProblem,
} from "../shared/types.ts";
import snapshot from "../../content/official-problems.json";
const problems = snapshot as OfficialProblem[];
const api = window.picareer;
type Form = {
	id: string;
	correct?: boolean;
	notes: string;
	editing?: CodingAttempt;
};
const fresh = (): Form => ({ id: crypto.randomUUID(), notes: "" });
export function useCodingWorkspace(initial: Record<string, string>) {
	const [id, setId] = useState(1),
		[filter, setFilter] = useState(""),
		[onlyFailed, setOnlyFailed] = useState(false);
	const drafts = useRef<Record<string, string>>({}),
		forms = useRef<Record<string, Form>>({}),
		timers = useRef(new Map<number, ReturnType<typeof setTimeout>>()),
		chains = useRef(new Map<number, Promise<unknown>>());
	const [statuses, setStatuses] = useState<Record<string, string>>({}),
		[, paint] = useState(0);
	for (const [key, value] of Object.entries(initial))
		if (!(key in drafts.current)) drafts.current[key] = value;
	const code = (pid = id) =>
		drafts.current[pid] ?? problems.find((p) => p.id === pid)?.template ?? "";
	const status = (pid: number, text: string) =>
		setStatuses((s) => ({ ...s, [pid]: text }));
	const persist = (pid: number) => {
		clearTimeout(timers.current.get(pid));
		timers.current.delete(pid);
		const value = code(pid);
		status(pid, "正在保存…");
		const promise = (chains.current.get(pid) ?? Promise.resolve())
			.catch(() => {})
			.then(() => api.call("draft", { id: pid, code: value }))
			.then(() => {
				if (code(pid) === value) status(pid, "已保存");
			})
			.catch((error) => {
				status(pid, `保存失败：${String(error)}`);
				throw error;
			});
		chains.current.set(pid, promise);
		return promise;
	};
	const change = (value: string) => {
		drafts.current[id] = value;
		status(id, "尚未保存");
		paint((n) => n + 1);
		clearTimeout(timers.current.get(id));
		const pid = id;
		timers.current.set(
			pid,
			setTimeout(() => void persist(pid).catch(() => {}), 200),
		);
	};
	useEffect(
		() => () => {
			for (const t of timers.current.values()) clearTimeout(t);
		},
		[],
	);
	const form = forms.current[id] ?? (forms.current[id] = fresh());
	const updateForm = (next: Partial<Form>) => {
		forms.current[id] = { ...form, ...next };
		paint((n) => n + 1);
	};
	const resetForm = (pid = id) => {
		forms.current[pid] = fresh();
		paint((n) => n + 1);
	};
	const pick = (pid: number) => {
		if (pid === id) return;
		if (id in drafts.current) void persist(id).catch(() => {});
		setId(pid);
	};
	return {
		id,
		filter,
		setFilter,
		onlyFailed,
		setOnlyFailed,
		code: code(),
		change,
		persist,
		pick,
		status: statuses[id] ?? "自动保存",
		form,
		updateForm,
		resetForm,
	};
}
export function CodingPage({
	state,
	workspace: w,
	Editor,
	onAttempts,
}: {
	state: AppState;
	workspace: ReturnType<typeof useCodingWorkspace>;
	Editor: React.ComponentType<{
		value: string;
		onChange: (value: string) => void;
		readOnly?: boolean;
	}>;
	onAttempts: (a: CodingAttempt[]) => void;
}) {
	const [message, setMessage] = useState(""),
		[saving, setSaving] = useState(false),
		[opening, setOpening] = useState(false);
	const lock = useRef(false),
		openLock = useRef(false);
	const p = problems.find((p) => p.id === w.id) ?? problems[0];
	const history = state.codingAttempts.filter((a) => a.problemId === p.id),
		next = Math.max(0, ...history.map((a) => a.number)) + 1;
	useEffect(() => setMessage(""), [w.id]);
	const save = async () => {
		if (lock.current) return;
		if (w.form.correct === undefined) {
			setMessage("请先根据力扣提交结果选择正确或错误。");
			return;
		}
		const pid = p.id,
			form = { ...w.form };
		lock.current = true;
		setSaving(true);
		setMessage("");
		try {
			const records = await api.call("saveCodingAttempt", {
				id: form.id,
				problemId: pid,
				mode: form.editing ? "update" : "create",
				correct: form.correct!,
				notes: form.notes,
			});
			onAttempts(records);
			w.resetForm(pid);
			setMessage("刷题记录已保存。");
		} catch (e) {
			setMessage(`保存失败，输入已保留：${String(e)}`);
		} finally {
			lock.current = false;
			setSaving(false);
		}
	};
	const open = async () => {
		if (openLock.current) return;
		openLock.current = true;
		setOpening(true);
		setMessage("");
		try {
			await w.persist(p.id);
			await api.call("copyCodeAndOpenProblem", { id: p.id, code: w.code });
			setMessage("代码已复制，请到力扣粘贴并运行提交。");
		} catch (e) {
			setMessage(String(e));
		} finally {
			openLock.current = false;
			setOpening(false);
		}
	};
	const edit = (a: CodingAttempt) => {
		w.updateForm({ id: a.id, correct: a.correct, notes: a.notes, editing: a });
		setMessage("");
	};
	return (
		<div className="coding-layout coding-v19">
			<aside className="panel problem-list">
				<div className="problem-list-head">
					<b>热题 100</b>
					<span className="badge">{state.solved.length} / 100</span>
				</div>
				<input
					aria-label="搜索题号、分类或名称"
					placeholder="搜索题号、分类或名称"
					value={w.filter}
					onChange={(e) => w.setFilter(e.target.value)}
				/>
				<button
					className="text-button"
					onClick={() => w.setOnlyFailed(!w.onlyFailed)}
				>
					{w.onlyFailed ? "显示全部" : "错题记录"} ({state.failed.length})
				</button>
				{problems
					.filter(
						(x) =>
							(!w.onlyFailed || state.failed.includes(x.id)) &&
							`${x.id} ${x.title} ${x.category}`
								.toLowerCase()
								.includes(w.filter.toLowerCase()),
					)
					.map((x) => {
						const attempts = state.codingAttempts.filter(
							(a) => a.problemId === x.id,
						);
						return (
							<div
								className={`problem-entry ${p.id === x.id ? "selected" : ""}`}
								key={x.id}
							>
								<button
									className="problem-row"
									onClick={() => w.pick(x.id)}
									aria-pressed={p.id === x.id}
								>
									<span>
										<b>
											{x.id}. {x.title}
										</b>
										<small>
											{x.category} · {x.difficulty}
										</small>
									</span>
								</button>
								{attempts.length > 0 && (
									<div
										className="attempt-dots"
										aria-label={`${x.title}刷题记录`}
									>
										{attempts.map((a) => (
											<span
												key={a.id}
												tabIndex={0}
												className={`attempt-dot ${a.correct ? "correct" : "incorrect"}`}
												title={`第 ${a.number} 次：${a.correct ? "正确" : "错误"}`}
												aria-label={`第 ${a.number} 次：${a.correct ? "正确" : "错误"}`}
												role="img"
											/>
										))}
									</div>
								)}
							</div>
						);
					})}
			</aside>
			<section className="problem-workspace">
				<section className="panel problem-detail">
					<div className="row between">
						<span className="badge">
							{p.category} · {p.difficulty}
						</span>
						<button
							className="text-button"
							disabled={opening}
							onClick={() => void open()}
						>
							{opening ? "正在复制并打开…" : "力扣原题 ↗"}
						</button>
					</div>
					<h2>
						{p.id}. {p.title}
					</h2>
					<div
						className="official-description"
						dangerouslySetInnerHTML={{ __html: p.descriptionHtml }}
						onClick={(e) => {
							const anchor = (e.target as Element).closest("a");
							if (anchor) {
								e.preventDefault();
								const url = anchor.getAttribute("href");
								if (url)
									void api
										.call("openExternal", {
											url: new URL(url, location.href).href,
										})
										.catch((e) => setMessage(String(e)));
							}
						}}
					/>
				</section>
				{message && (
					<div className="alert coding-notice" role="alert">
						{message}
						<button aria-label="关闭提示" onClick={() => setMessage("")}>
							×
						</button>
					</div>
				)}
				<section className="panel editor-panel">
					<div className="editor-toolbar">
						<span>Python 3</span>
						<span role="status">
							{w.status}
							{w.status.startsWith("保存失败") && (
								<button onClick={() => void w.persist(p.id).catch(() => {})}>
									重试保存
								</button>
							)}
						</span>
					</div>
					<Editor
						key={p.id}
						value={w.code}
						onChange={w.change}
						readOnly={opening}
					/>
				</section>
				<section className="panel attempt-records">
					<div className="row between">
						<h3>
							{w.form.editing
								? `编辑第 ${w.form.editing.number} 次刷题`
								: `第 ${next} 次刷题`}
						</h3>
						<small>正误由你根据官网提交结果确认</small>
					</div>
					<fieldset disabled={saving}>
						<legend>本次结果（必选）</legend>
						<label>
							<input
								type="radio"
								name={`result-${p.id}`}
								checked={w.form.correct === true}
								onChange={() => w.updateForm({ correct: true })}
							/>
							正确
						</label>
						<label>
							<input
								type="radio"
								name={`result-${p.id}`}
								checked={w.form.correct === false}
								onChange={() => w.updateForm({ correct: false })}
							/>
							错误
						</label>
						<label className="attempt-notes">
							本次刷题心得（选填）
							<textarea
								value={w.form.notes}
								maxLength={30000}
								onChange={(e) => w.updateForm({ notes: e.target.value })}
								placeholder="记录思路、错误原因与改进方法…"
							/>
						</label>
					</fieldset>
					<div className="actions">
						{w.form.editing && (
							<button disabled={saving} onClick={() => w.resetForm()}>
								取消编辑
							</button>
						)}
						<button
							className="primary"
							disabled={saving}
							onClick={() => void save()}
						>
							{saving
								? "正在保存…"
								: w.form.editing
									? "保存修改"
									: "保存本次记录"}
						</button>
					</div>
					<h3>刷题历史 · {history.length}</h3>
					{history.map((a) => (
						<article className="attempt-history" key={a.id}>
							<div className="row between">
								<b>
									第 {a.number} 次 ·{" "}
									<span
										className={a.correct ? "correct-text" : "incorrect-text"}
									>
										{a.correct ? "正确" : "错误"}
									</span>
								</b>
								<button
									className="text-button"
									disabled={saving}
									onClick={() => edit(a)}
								>
									编辑记录
								</button>
							</div>
							<p>{a.notes || "未填写心得"}</p>
							<small>
								{new Date(a.created).toLocaleString()}
								{a.updated !== a.created
									? ` · 修改于 ${new Date(a.updated).toLocaleString()}`
									: ""}
							</small>
						</article>
					))}
					{!history.length && <p className="muted">尚无手动刷题记录。</p>}
					{state.legacyResults
						.filter((a) => a.id === p.id)
						.map((a) => (
							<p className="legacy-result" key={a.id}>
								旧版本地判题结果：{a.passed ? "本地测试通过" : "本地测试未通过"}
								（不代表官网通过，不计入刷题次数）
							</p>
						))}
				</section>
			</section>
		</div>
	);
}

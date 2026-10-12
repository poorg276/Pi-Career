import React, { useEffect, useRef, useState } from "react";
import type { Job, ManualJobFields, ManualJobInput } from "../shared/types";
const api = window.picareer;
export const manualFields: {
	key: keyof ManualJobFields;
	label: string;
	required?: boolean;
	multiline?: boolean;
}[] = [
	{ key: "company", label: "企业名", required: true },
	{ key: "city", label: "工作地点", required: true },
	{ key: "role", label: "岗位名称", required: true },
	{ key: "jobType", label: "岗位类型" },
	{
		key: "responsibilities",
		label: "岗位职责",
		required: true,
		multiline: true,
	},
	{ key: "requirements", label: "岗位要求", required: true, multiline: true },
	{ key: "education", label: "学历要求" },
	{ key: "experience", label: "经验要求" },
	{ key: "graduationYear", label: "面向毕业年份" },
	{ key: "salary", label: "薪资待遇" },
	{ key: "sourceUrl", label: "招聘来源链接" },
	{ key: "notes", label: "备注", multiline: true },
];
const newDraft = (): ManualJobInput => ({
	id: crypto.randomUUID(),
	mode: "create",
	company: "",
	city: "",
	role: "",
	jobType: "未注明",
	responsibilities: "",
	requirements: "",
	education: "",
	experience: "",
	graduationYear: "",
	salary: "",
	sourceUrl: "",
	notes: "",
});
export function useManualJobsWorkspace() {
	const [draft, setDraft] = useState(newDraft),
		[editor, setEditor] = useState<ManualJobInput>(),
		[detail, setDetail] = useState<Job>(),
		[deletion, setDeletion] = useState<Job>(),
		[notice, setNotice] = useState("");
	const open = () => {
		setNotice("");
		setEditor({ ...draft });
	};
	const edit = (job: Job) => {
		setNotice("");
		if (job.manual) setEditor({ ...job.manual, id: job.id, mode: "update" });
	};
	const change = (fields: ManualJobInput) => {
		setEditor(fields);
		if (fields.mode === "create") setDraft(fields);
	};
	return {
		draft,
		setDraft,
		editor,
		setEditor,
		detail,
		setDetail,
		deletion,
		setDeletion,
		notice,
		setNotice,
		open,
		edit,
		change,
		reset: () => setDraft(newDraft()),
	};
}
function Dialog({
	title,
	close,
	busy = false,
	children,
}: {
	title: string;
	close: () => void;
	busy?: boolean;
	children: React.ReactNode;
}) {
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		const original = document.activeElement as HTMLElement;
		ref.current?.querySelector<HTMLElement>("input,button")?.focus();
		return () => original?.focus();
	}, []);
	return (
		<div
			className="modal-overlay manual-overlay"
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					if (!busy) close();
				}
				if (e.key === "Tab") {
					const items = [
						...ref.current!.querySelectorAll<HTMLElement>(
							'input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled),[tabindex="0"]',
						),
					];
					const first = items[0],
						last = items.at(-1);
					if (e.shiftKey && document.activeElement === first) {
						e.preventDefault();
						last?.focus();
					} else if (!e.shiftKey && document.activeElement === last) {
						e.preventDefault();
						first?.focus();
					}
				}
			}}
		>
			<section
				ref={ref}
				className="modal manual-dialog"
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<div className="manual-header">
					<h2>{title}</h2>
					<button disabled={busy} onClick={close} aria-label="关闭弹窗">
						×
					</button>
				</div>
				{children}
			</section>
		</div>
	);
}
export function ManualJobDialogs({
	workspace: w,
	refresh,
	saved,
}: {
	workspace: ReturnType<typeof useManualJobsWorkspace>;
	refresh: () => Promise<void>;
	saved: () => void;
}) {
	if (w.editor)
		return (
			<Editor
				key={w.editor.id + w.editor.mode}
				workspace={w}
				refresh={refresh}
				saved={saved}
			/>
		);
	if (w.detail?.manual) {
		const j = w.detail;
		return (
			<Dialog title="目标岗位详情" close={() => w.setDetail(undefined)}>
				<div className="manual-body">
					<p className="badge">用户手动录入 · {j.manual!.jobType}</p>
					<dl className="manual-details">
						{manualFields
							.filter((f) => j.manual![f.key])
							.map((f) => (
								<div key={f.key}>
									<dt>{f.label}</dt>
									<dd>{j.manual![f.key]}</dd>
								</div>
							))}
					</dl>
				</div>
				<div className="manual-footer">
					<button onClick={() => w.setDetail(undefined)}>关闭</button>
				</div>
			</Dialog>
		);
	}
	if (w.deletion) return <DeleteDialog workspace={w} refresh={refresh} />;
	return null;
}
function Editor({
	workspace: w,
	refresh,
	saved,
}: {
	workspace: ReturnType<typeof useManualJobsWorkspace>;
	refresh: () => Promise<void>;
	saved: () => void;
}) {
	const fields = w.editor!,
		[busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const saving = useRef(false);
	const close = () => w.setEditor(undefined);
	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (saving.current) return;
		for (const f of manualFields)
			if (f.required && !fields[f.key].trim()) {
				setError(`请填写${f.label}。`);
				return;
			}
		if (fields.sourceUrl) {
			try {
				const u = new URL(fields.sourceUrl);
				if (
					!["http:", "https:"].includes(u.protocol) ||
					u.username ||
					u.password
				)
					throw new Error();
			} catch {
				setError("招聘来源链接必须是有效的 HTTP／HTTPS 网址。");
				return;
			}
		}
		saving.current = true;
		setBusy(true);
		setError("");
		try {
			await api.call("saveManualJob", fields);
			await refresh();
			w.setNotice(
				fields.mode === "create"
					? "目标岗位已保存到我的收藏。"
					: "目标岗位已更新。",
			);
			if (fields.mode === "create") w.reset();
			close();
			saved();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
			saving.current = false;
		}
	};
	return (
		<Dialog
			title={fields.mode === "create" ? "手动录入目标岗位" : "编辑目标岗位"}
			close={close}
			busy={busy}
		>
			<form onSubmit={submit} noValidate>
				<div className="manual-body">
					<p className="muted">
						填写目标岗位，标有 * 的信息为必填。无需招聘链接即可保存。
					</p>
					<div className="manual-grid">
						{manualFields.map((f) => (
							<label
								key={f.key}
								className={`field ${f.multiline || f.key === "sourceUrl" ? "manual-wide" : ""}`}
							>
								<span>
									{f.label}
									{f.required ? " *" : "（选填）"}
								</span>
								{f.key === "jobType" ? (
									<select
										disabled={busy}
										value={fields.jobType}
										onChange={(e) =>
											w.change({
												...fields,
												jobType: e.target.value as ManualJobFields["jobType"],
											})
										}
									>
										{["实习", "校招", "社招", "未注明"].map((t) => (
											<option key={t}>{t}</option>
										))}
									</select>
								) : f.multiline ? (
									<textarea
										disabled={busy}
										aria-required={f.required}
										value={fields[f.key]}
										maxLength={f.key === "notes" ? 2000 : 10000}
										onChange={(e) =>
											w.change({ ...fields, [f.key]: e.target.value })
										}
									/>
								) : (
									<input
										disabled={busy}
										aria-required={f.required}
										value={fields[f.key]}
										maxLength={f.key === "sourceUrl" ? 2000 : 200}
										placeholder={
											f.key === "sourceUrl" ? "https://…" : undefined
										}
										onChange={(e) =>
											w.change({ ...fields, [f.key]: e.target.value })
										}
									/>
								)}
							</label>
						))}
					</div>
					{error && (
						<p role="alert" className="alert error">
							{error}
						</p>
					)}
				</div>
				<div className="manual-footer">
					<button disabled={busy} type="button" onClick={close}>
						取消
					</button>
					<button disabled={busy} type="submit" className="primary">
						{busy
							? "正在保存…"
							: fields.mode === "create"
								? "保存到我的收藏"
								: "保存修改"}
					</button>
				</div>
			</form>
		</Dialog>
	);
}
function DeleteDialog({
	workspace: w,
	refresh,
}: {
	workspace: ReturnType<typeof useManualJobsWorkspace>;
	refresh: () => Promise<void>;
}) {
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const job = w.deletion!;
	return (
		<Dialog
			title="删除手动岗位"
			close={() => w.setDeletion(undefined)}
			busy={busy}
		>
			<div className="manual-body">
				<p>
					确定从我的收藏删除“{job.company} · {job.role}”吗？
				</p>
				<p className="muted">已生成的面试与学习计划会保留。</p>
				{error && (
					<p role="alert" className="alert error">
						{error}
					</p>
				)}
			</div>
			<div className="manual-footer">
				<button disabled={busy} onClick={() => w.setDeletion(undefined)}>
					取消
				</button>
				<button
					disabled={busy}
					className="danger"
					onClick={async () => {
						if (busy) return;
						setBusy(true);
						try {
							await api.call("deleteManualJob", { id: job.id });
							await refresh();
							w.setDeletion(undefined);
							w.setNotice("目标岗位已删除。");
						} catch (e) {
							setError(String(e));
						} finally {
							setBusy(false);
						}
					}}
				>
					{busy ? "正在删除…" : "删除岗位"}
				</button>
			</div>
		</Dialog>
	);
}

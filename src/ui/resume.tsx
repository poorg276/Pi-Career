import React, { useEffect, useRef, useState } from "react";
import type {
	ResumeDraft,
	ResumeEdit,
	MaterialPurpose,
} from "../shared/resume.ts";
const api = window.picareer;
function toEdit(d: ResumeDraft): ResumeEdit {
	const {
		id,
		revision,
		title,
		mode,
		step,
		jd,
		overview,
		fields,
		layout,
		facts,
		questions,
		experiences,
	} = d;
	return {
		id,
		revision,
		title,
		mode,
		step,
		jd,
		overview,
		fields,
		layout,
		facts,
		questions,
		experiences,
		selections: Object.fromEntries(
			d.materials.flatMap((m) => m.units.map((u) => [u.id, u.selected])),
		),
	};
}
export function ResumePage({
	model,
	provider,
	activation,
	settings,
}: {
	model: string;
	provider: string;
	activation: number;
	settings: () => void;
}) {
	const [view, setView] = useState<"landing" | "experience" | "full">(
		"landing",
	);
	const [list, setList] = useState<ResumeDraft[]>([]),
		[draft, setDraft] = useState<ResumeDraft>();
	const [error, setError] = useState(""),
		[notice, setNotice] = useState(""),
		[purpose, setPurpose] = useState<MaterialPurpose>("project");
	const [busy, setBusy] = useState(false),
		[saved, setSaved] = useState(true),
		[tick, setTick] = useState(0),
		[deleting, setDeleting] = useState(false);
	const current = useRef<ResumeDraft>(undefined),
		dirty = useRef(false),
		saving = useRef<Promise<void>>(undefined),
		mounted = useRef(true),
		locked = useRef(false);
	const load = (d: ResumeDraft) => {
		current.current = d;
		setDraft(d);
		dirty.current = false;
		setSaved(true);
	};
	const merge = (d: ResumeDraft) => {
		setList((old) => [d, ...old.filter((x) => x.id !== d.id)]);
		if (
			current.current?.id === d.id &&
			!dirty.current &&
			!saving.current &&
			d.revision >= current.current.revision
		) {
			current.current = d;
			setDraft(d);
		}
	};
	useEffect(() => {
		setView("landing");
		setDeleting(false);
		setError("");
		setNotice("");
	}, [activation]);
	useEffect(() => {
		mounted.current = true;
		void api
			.call("resumeList", null)
			.then(setList)
			.catch((e) => setError(e.message));
		const off = api.onEvent((e) => {
			if (e.type === "resumeUpdate") merge(e.draft);
			if (e.type === "backendExited") {
				setBusy(false);
				setError("后台已退出，请重启应用；已保存的输入与文稿可恢复。");
			}
		});
		return () => {
			mounted.current = false;
			off();
		};
	}, []);
	const edit = (fn: (d: ResumeDraft) => void) => {
		if (!current.current) return;
		const d = structuredClone(current.current);
		fn(d);
		current.current = d;
		setDraft(d);
		dirty.current = true;
		setSaved(false);
		setTick((t) => t + 1);
	};
	const flush = async (): Promise<void> => {
		if (saving.current) {
			await saving.current;
			if (dirty.current) await flush();
			return;
		}
		if (!dirty.current || !current.current) return;
		const snapshot = structuredClone(current.current);
		dirty.current = false;
		const task = api
			.call("saveResume", toEdit(snapshot))
			.then((d) => {
				setList((old) => [d, ...old.filter((x) => x.id !== d.id)]);
				if (current.current?.id === d.id) {
					if (dirty.current) {
						current.current = { ...current.current, revision: d.revision };
						setDraft(current.current);
					} else load(d);
				}
			})
			.catch((e) => {
				dirty.current = true;
				setSaved(false);
				setError("保存失败：" + e.message + "。输入已保留，请保存重试。");
				throw e;
			})
			.finally(() => {
				saving.current = undefined;
			});
		saving.current = task;
		await task;
		if (dirty.current) await flush();
	};
	useEffect(() => {
		const t = setTimeout(() => {
			if (current.current?.run?.status !== "running")
				void flush().catch(() => {});
		}, 600);
		return () => clearTimeout(t);
	}, [tick]);
	const action = async (fn: () => Promise<unknown>) => {
		if (locked.current) return;
		locked.current = true;
		setBusy(true);
		setError("");
		setNotice("");
		try {
			await flush();
			await fn();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			locked.current = false;
			if (mounted.current) setBusy(false);
		}
	};
	const openExperience = () => {
		if (current.current?.run?.status === "running") {
			setView("experience");
			return;
		}
		void action(async () => {
			const all = await api.call("resumeList", null);
			setList(all);
			const d =
				all.find(
					(x) => x.id === current.current?.id && x.mode === "experience",
				) ?? all.find((x) => x.mode === "experience");
			load(d ?? (await api.call("createResume", { mode: "experience" })));
			setView("experience");
		});
	};
	const running = busy || draft?.run?.status === "running";
	const selected =
		draft?.materials
			.filter((m) => m.purpose === "project" || m.purpose === "research")
			.flatMap((m) =>
				m.units
					.filter((u) => u.selected)
					.map((u) => ({ ...u, material: m.name })),
			) ?? [];
	const back = () => {
		if (locked.current) {
			setView("landing");
			return;
		}
		void action(async () => {
			setView("landing");
		});
	};
	const configure = () => void action(async () => settings());
	const importMaterials = (directory = false) =>
		void action(async () => {
			const d = await api.call("chooseResumeMaterials", {
				id: current.current!.id,
				purpose,
				directory,
			});
			if (d) load(d);
		});
	const generate = () =>
		void action(async () => {
			const d = await api.call("generateResumeExperience", {
				id: current.current!.id,
			});
			load(d);
			if (d.run?.status === "complete")
				setNotice("已生成并核验文稿，请核对个人事实后复制使用。");
		});
	return (
		<section className="resume-page">
			{view !== "landing" && (
				<button className="jobs-back" onClick={back}>
					← 返回简历优化
				</button>
			)}
			{view === "landing" ? (
				<>
					<div className="section-heading">
						<h1>简历优化</h1>
						<button className="resume-model" title={model} onClick={configure}>
							{model || "配置模型"}
						</button>
					</div>
					<div className="resume-mode-grid">
						<button
							className="panel resume-mode"
							onClick={openExperience}
							disabled={busy && !draft}
						>
							<strong>项目经历优化</strong>
							<span>项目、论文与专利材料 → 精炼的简历经历</span>
						</button>
						<button
							className="panel resume-mode"
							onClick={() => setView("full")}
						>
							<strong>完整简历</strong>
							<span>制作完整简历</span>
						</button>
					</div>
				</>
			) : view === "full" ? (
				<div className="panel resume-empty">
					<p>该功能还在开发中......</p>
				</div>
			) : (
				draft && (
					<>
						<div className="section-heading">
							<h1>项目经历优化</h1>
							<button
								className="resume-model"
								title={model}
								onClick={configure}
								disabled={running}
							>
								{model || "配置模型"}
							</button>
						</div>
						<div className="panel resume-toolbar resume-compact-drafts">
							<label>
								经历草稿
								<select
									aria-label="经历草稿"
									value={draft.id}
									disabled={running}
									onChange={(e) => {
										const id = e.target.value;
										void action(async () => {
											const all = await api.call("resumeList", null);
											setList(all);
											const next = all.find((d) => d.id === id);
											if (next) load(next);
										});
									}}
								>
									{list
										.filter((d) => d.mode === "experience")
										.map((d) => (
											<option key={d.id} value={d.id}>
												{d.title}
											</option>
										))}
								</select>
							</label>
							<input
								aria-label="草稿名称"
								value={draft.title}
								disabled={running}
								onChange={(e) =>
									edit((d) => {
										d.title = e.target.value;
									})
								}
							/>
							<span>{saved ? "已保存" : "待保存"}</span>
							<button
								disabled={running}
								onClick={() =>
									void action(async () =>
										load(
											await api.call("createResume", { mode: "experience" }),
										),
									)
								}
							>
								新建
							</button>
							<button
								disabled={running}
								onClick={() =>
									void action(async () => {
										setNotice("草稿已保存");
									})
								}
							>
								保存
							</button>
							<button
								className="danger"
								disabled={running}
								onClick={() => setDeleting(true)}
							>
								删除草稿
							</button>
						</div>
						<div className="resume-content">
							<div className="panel padded">
								<h2>目标岗位（选填）</h2>
								<label>
									岗位职责与要求
									<textarea
										rows={5}
										disabled={running}
										value={draft.jd}
										placeholder="粘贴目标岗位 JD；未填写时进行通用优化"
										onChange={(e) =>
											edit((d) => {
												d.jd = e.target.value;
											})
										}
									/>
								</label>
							</div>
							<div className="panel padded">
								<h2>现有项目/科研经历概述</h2>
								<label>
									经历概述（必填）
									<textarea
										rows={8}
										aria-describedby="resume-overview-help"
										disabled={running}
										value={draft.overview ?? ""}
										placeholder="说明项目及材料对应关系、本人实际承担的工作、技术方法；科研请说明作者身份与成果状态。时间或实测指标未知可注明未知／未测量。"
										onChange={(e) =>
											edit((d) => {
												d.overview = e.target.value;
												d.inputIssues = [];
											})
										}
									/>
								</label>
								<p id="resume-overview-help" className="muted">
									可灵活介绍项目与科研内容；不必拆分栏目。请区分本人贡献与团队成果。
								</p>
								{!!draft.inputIssues?.length && (
									<div className="alert error" role="alert">
										<strong>请补充概述后重新生成</strong>
										<ul>
											{draft.inputIssues.map((x, i) => (
												<li key={i}>{x}</li>
											))}
										</ul>
									</div>
								)}
							</div>
							<div className="panel padded">
								<h2>材料与发送范围</h2>
								<div className="resume-inline">
									<label>
										材料用途
										<select
											value={purpose}
											disabled={running}
											onChange={(e) =>
												setPurpose(e.target.value as MaterialPurpose)
											}
										>
											<option value="project">项目</option>
											<option value="research">论文／专利</option>
										</select>
									</label>
									<button disabled={running} onClick={() => importMaterials()}>
										导入文件／源码 ZIP
									</button>
									<button
										disabled={running}
										onClick={() => importMaterials(true)}
									>
										导入源码目录
									</button>
								</div>
								<p className="muted">
									本地读取，不执行代码。支持
									PDF、DOCX、TXT、Markdown、PNG/JPG；仅发送勾选片段。未读取或跳过的文件不会视为已审阅。
								</p>
								{draft.materials
									.filter(
										(m) => m.purpose === "project" || m.purpose === "research",
									)
									.map((m) => (
										<div className="resume-material" key={m.id}>
											<div className="resume-inline">
												<strong>{m.name}</strong>
												<small>
													{m.purpose === "project" ? "项目" : "论文／专利"} ·
													已读取 {m.units.length} 个片段
												</small>
												<button
													disabled={running}
													onClick={() =>
														void action(async () =>
															load(
																await api.call("removeResumeMaterial", {
																	id: draft.id,
																	materialId: m.id,
																}),
															),
														)
													}
												>
													移除
												</button>
											</div>
											<details>
												<summary>读取清单、片段选择与失败提示</summary>
												{m.skipped.length > 0 && (
													<div className="alert">
														<ul>
															{m.skipped.map((s, i) => (
																<li key={i}>{s}</li>
															))}
														</ul>
													</div>
												)}
												{m.units.map((u) => (
													<div className="resume-unit" key={u.id}>
														<label>
															<input
																type="checkbox"
																disabled={running}
																checked={u.selected}
																onChange={(e) =>
																	edit((d) => {
																		d.materials
																			.find((x) => x.id === m.id)!
																			.units.find(
																				(x) => x.id === u.id,
																			)!.selected = e.target.checked;
																	})
																}
															/>
															{u.location}
														</label>
														<pre>{u.text}</pre>
														{u.image && (
															<img
																alt={u.location}
																src={
																	"data:" + u.mimeType + ";base64," + u.image
																}
															/>
														)}
													</div>
												))}
											</details>
										</div>
									))}
								{!draft.materials.some((m) =>
									["project", "research"].includes(m.purpose),
								) && (
									<p className="muted">
										未导入材料，也可依据完整的文字概述生成。
									</p>
								)}
							</div>
							<div className="panel padded resume-generate">
								<p>
									将发送至{" "}
									<strong>
										{provider || "尚未配置供应商"} / {model || "尚未配置模型"}
									</strong>
									：岗位信息、经历概述及 {selected.length} 个已选片段（
									{selected
										.reduce((n, u) => n + u.text.length, 0)
										.toLocaleString()}{" "}
									字符，{selected.filter((u) => u.image).length} 张图片）。
								</p>
								<details>
									<summary>查看本次发送的材料范围</summary>
									<ul>
										{selected.map((u) => (
											<li key={u.id}>
												{u.material} · {u.location}
											</li>
										))}
									</ul>
								</details>
								<button
									className="primary"
									disabled={running || !draft.overview?.trim()}
									onClick={generate}
								>
									依据提供的信息生成简历中的项目经历及科研经历
								</button>
								{draft.run && (
									<div
										className={"resume-status " + draft.run.status}
										role="status"
									>
										<span>{draft.run.stage}</span>
										{draft.run.status === "running" && (
											<button
												onClick={() =>
													void api
														.call("cancelResume", { id: draft.id })
														.catch((e) => setError(e.message))
												}
											>
												停止
											</button>
										)}
									</div>
								)}
							</div>
							{!!draft.experiences.length && (
								<div className="panel padded">
									<div className="section-heading">
										<h2>生成结果</h2>
										<button
											disabled={running}
											onClick={() =>
												void action(async () => {
													await api.call("copyResume", { id: draft.id });
													setNotice("已复制全部经历文本");
												})
											}
										>
											整体复制
										</button>
									</div>
									<p className="muted">
										文字可直接编辑；编辑内容由你确认，证据说明不包含在复制文本中。
									</p>
									{draft.experiences.map((x, index) => (
										<div className="resume-experience" key={x.id}>
											<strong>
												{x.kind === "project" ? "项目经历" : "科研成果"}
											</strong>
											<div className="resume-basic-grid">
												{(["name", "time", "role"] as const).map((k) => (
													<label key={k}>
														{k === "name"
															? "名称"
															: k === "time"
																? "时间"
																: "本人角色"}
														<input
															disabled={running}
															value={x[k]}
															onChange={(e) =>
																edit((d) => {
																	d.experiences[index][k] = e.target.value;
																})
															}
														/>
													</label>
												))}
											</div>
											{x.bullets.map((b, i) => (
												<label key={i}>
													条目 {i + 1}
													<textarea
														rows={2}
														aria-label={"条目 " + (i + 1)}
														value={b.text}
														disabled={running}
														onChange={(e) =>
															edit((d) => {
																d.experiences[index].bullets[i].text =
																	e.target.value;
															})
														}
													/>
												</label>
											))}
											<button
												disabled={running}
												onClick={() =>
													void action(async () => {
														await api.call("copyResume", {
															id: draft.id,
															experienceId: x.id,
														});
														setNotice("已复制本项经历");
													})
												}
											>
												复制本项
											</button>
											<details>
												<summary>证据与修改说明</summary>
												<p>
													依据概述突出本人工作与目标岗位相关技术；未知时间和指标省略。手动修改的条目需自行核对。
												</p>
												{x.bullets.map((b, i) => (
													<div key={i}>
														<strong>条目 {i + 1}</strong>
														{b.factIds.map((id) => {
															const s = draft.experienceSources?.find(
																(s) => s.id === id,
															);
															const f = draft.facts.find((f) => f.id === id);
															return (
																<div key={id}>
																	<p>
																		{s?.origin === "overview"
																			? "用户概述："
																			: "材料依据："}
																		{s?.text ??
																			f?.text ??
																			"旧稿／用户补充内容，需自行核对"}
																	</p>
																	{(s?.evidence ?? f?.evidence ?? []).map(
																		(ev, n) => (
																			<p key={n}>
																				{draft.materials
																					.flatMap((m) => m.units)
																					.find((u) => u.id === ev.unitId)
																					?.location ?? "原片段已移除"}
																				：{ev.quote}
																			</p>
																		),
																	)}
																</div>
															);
														})}
													</div>
												))}
											</details>
										</div>
									))}
								</div>
							)}
							{!!draft.versions.length && (
								<details className="panel padded">
									<summary>生成版本恢复</summary>
									{draft.versions.map((v) => (
										<div className="resume-inline" key={v.at}>
											<span>
												{new Date(v.at).toLocaleString()} ·{" "}
												{v.experiences.length} 项
											</span>
											<button
												disabled={running}
												onClick={() =>
													void action(async () =>
														load(
															await api.call("restoreResumeVersion", {
																id: draft.id,
																at: v.at,
															}),
														),
													)
												}
											>
												恢复此版本
											</button>
										</div>
									))}
								</details>
							)}
						</div>
					</>
				)
			)}
			{error && (
				<div className="alert error" role="alert">
					<span>{error}</span>
					<button onClick={() => setError("")}>×</button>
				</div>
			)}
			{notice && (
				<div className="alert" role="status">
					<span>{notice}</span>
					<button onClick={() => setNotice("")}>×</button>
				</div>
			)}
			{deleting && draft && (
				<div className="modal-backdrop">
					<div
						className="panel resume-confirm"
						role="dialog"
						aria-modal="true"
						aria-label="删除草稿"
					>
						<h2>删除草稿</h2>
						<p>确定删除“{draft.title}”及导入的材料副本？原文件不受影响。</p>
						<div className="resume-inline">
							<button onClick={() => setDeleting(false)}>取消</button>
							<button
								className="danger"
								disabled={busy}
								onClick={() =>
									void action(async () => {
										await api.call("deleteResume", { id: draft.id });
										setDeleting(false);
										const all = await api.call("resumeList", null);
										setList(all);
										const next = all.find((x) => x.mode === "experience");
										current.current = undefined;
										setDraft(undefined);
										if (next) load(next);
										else setView("landing");
									})
								}
							>
								删除
							</button>
						</div>
					</div>
				</div>
			)}
		</section>
	);
}

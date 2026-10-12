import { useEffect, useRef, useState } from "react";
import type { AuthorizationState, LoginMethod } from "../shared/types.ts";

const api = window.picareer;
const stageNames = { preparing: "准备授权", browser: "等待浏览器", exchanging: "交换令牌", validating: "验证令牌", saving: "保存凭据", refreshing: "刷新模型", complete: "已完成" };
export const isAuthorizing = (state?: AuthorizationState) =>
	!!state && ["starting", "waiting", "cancelling"].includes(state.status);
export function useAuthorization(refresh: () => Promise<void>) {
	const [state, setState] = useState<AuthorizationState>();
	const current = useRef<AuthorizationState | undefined>(undefined);
	const update = (next?: AuthorizationState) => {
		current.current = next;
		setState(next);
	};
	useEffect(
		() =>
			api.onEvent((event) => {
				if (
					event.type === "authorization" &&
					event.state.attemptId === current.current?.attemptId
				)
					update(event.state);
			}),
		[],
	);
	const start = async (provider: string, method: LoginMethod = "browser") => {
		if (isAuthorizing(current.current)) return;
		const input = { provider, method, attemptId: crypto.randomUUID() };
		update({ ...input, status: "starting", message: "正在准备授权…" });
		try {
			const result = await api.call("login", input);
			if (current.current?.attemptId !== input.attemptId) return;
			update(result);
			if (result.status === "succeeded") {
				try {
					await refresh();
				} catch {
					if (current.current?.attemptId === input.attemptId)
						update({
							...result,
							message: "已保存授权。配置读取失败，请重新打开应用后选择模型。",
						});
				}
			}
		} catch {
			if (current.current?.attemptId === input.attemptId)
				update({
					...input,
					status: "failed",
					message: "无法启动授权，请重新连接；若后台已退出，请重新打开应用。",
					details: "AUTH_START_FAILED",
				});
		}
	};
	const cancel = async () => {
		const s = current.current;
		if (!s || !isAuthorizing(s)) return;
		update({
			...s,
			status: "cancelling",
			message: "正在取消授权…",
			url: undefined,
			userCode: undefined,
			prompt: undefined,
		});
		try {
			await api.call("cancelLogin", { attemptId: s.attemptId });
		} catch {
			if (current.current?.attemptId === s.attemptId)
				update({
					...s,
					status: "failed",
					message: "授权后台不可用，请重新打开应用。",
					url: undefined,
					userCode: undefined,
					prompt: undefined,
				});
		}
	};
	return {
		state,
		start,
		cancel,
		refreshModels: async () => {
			const s = current.current;
			if (!s || s.status !== "succeeded") return;
			await api.call("refreshModels", { provider: s.provider });
			await refresh();
			if (current.current?.attemptId === s.attemptId) update({ ...s,
				modelsRefreshRequired: false, stage: "complete", diagnostic: undefined, details: undefined,
				message: "已授权。模型列表已刷新，请选择模型，保存后测试连接。" });
		},
		close: () => {
			if (!isAuthorizing(current.current)) update();
		},
		switchMethod: async (method: LoginMethod) => {
			const provider = current.current?.provider;
			await cancel();
			if (provider) await start(provider, method);
		},
	};
}
export type AuthorizationUI = ReturnType<typeof useAuthorization>;

export function AuthorizationDialog({
	authorization,
	onSelectModels,
}: {
	authorization: AuthorizationUI;
	onSelectModels: () => void;
}) {
	const { state: s } = authorization;
	const [value, setValue] = useState(""),
		[error, setError] = useState(""),
		[info, setInfo] = useState(""),
		[sending, setSending] = useState(false),
		[now, setNow] = useState(Date.now());
	const panel = useRef<HTMLElement>(null);
	const errorMessage = useRef<HTMLParagraphElement>(null);
	useEffect(() => {
		if (error) errorMessage.current?.scrollIntoView({ block: "nearest" });
	}, [error]);
	useEffect(() => {
		setValue("");
		setError("");
		setInfo("");
		setSending(false);
	}, [s?.attemptId, s?.prompt?.id]);
	useEffect(() => {
		if (s) panel.current?.focus();
	}, [s?.attemptId]);
	useEffect(() => {
		if (!s?.expiresAt) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [s?.expiresAt]);
	if (!s) return null;
	const working = isAuthorizing(s),
		prompt = s.prompt;
	const seconds = Math.max(0, Math.ceil(((s.expiresAt ?? now) - now) / 1000));
	const act = async (task: () => Promise<unknown>) => {
		setError("");
		setInfo("");
		setSending(true);
		try {
			await task();
		} catch (e) {
			setError(
				(e instanceof Error ? e.message : "操作失败，请重试。").replace(
					/^Error invoking remote method '[^']+': (?:Error: )?/,
					"",
				),
			);
		} finally {
			setSending(false);
		}
	};
	const submit = (input: string) =>
		act(async () => {
			if (!prompt) return;
			const accepted = await api.call("authReply", {
				attemptId: s.attemptId,
				promptId: prompt.id,
				value: input,
			});
			if (!accepted) throw new Error("此输入请求已结束，请按当前状态继续。");
			setValue("");
		});
	const input = prompt && (
		<div className="auth-input">
			{prompt.kind !== "manual_code" && <p>{prompt.detail}</p>}
			{prompt.kind === "select" ? (
				<div className="actions">
					{prompt.options?.map((option) => (
						<button
							key={option.id}
							disabled={sending}
							onClick={() => void submit(option.id)}
						>
							{option.label}
						</button>
					))}
				</div>
			) : (
				<>
					<label htmlFor="authorization-input">
						{prompt.kind === "text"
							? "按提示输入（允许留空使用默认值）"
							: prompt.kind === "secret"
								? "输入账户凭据"
								: s.provider === "openai-codex"
									? "粘贴浏览器地址栏中的完整回调地址"
									: "粘贴授权页面返回的代码或地址"}
					</label>
					<input
						id="authorization-input"
						type={prompt.kind === "secret" ? "password" : "text"}
						autoComplete="off"
						spellCheck={false}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						placeholder={
							s.provider === "openai-codex"
								? "http://localhost:1455/auth/callback?…"
								: "授权结果"
						}
					/>
					<button
						disabled={sending || (prompt.kind !== "text" && !value.trim())}
						onClick={() => void submit(value)}
					>
						提交授权结果
					</button>
				</>
			)}
		</div>
	);
	return (
		<div className="modal-overlay auth-overlay">
			<section
				className="modal auth-modal"
				ref={panel}
				role="dialog"
				aria-modal="true"
				aria-labelledby="authorization-title"
				tabIndex={-1}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						if (working) void authorization.cancel();
						else authorization.close();
					}
					if (e.key === "Tab") {
						const items = [
							...(panel.current?.querySelectorAll<HTMLElement>(
								"button:not(:disabled), input, summary",
							) ?? []),
						].filter((el) => el.getClientRects().length);
						const first = items[0],
							last = items.at(-1);
						if (
							e.shiftKey &&
							(document.activeElement === first ||
								document.activeElement === panel.current)
						) {
							e.preventDefault();
							last?.focus();
						} else if (!e.shiftKey && document.activeElement === last) {
							e.preventDefault();
							first?.focus();
						}
					}
				}}
			>
				<div className="auth-heading">
					<span className="eyebrow">账户授权</span>
					<h2 id="authorization-title">
						{s.provider === "openai-codex"
							? "连接 OpenAI Codex"
							: "连接订阅账户"}
					</h2>
				</div>
				<div className="auth-body">
					<p className="auth-status" role="status">
						{working && <span className="auth-spinner" aria-hidden="true" />}
						{s.message}
					</p>
					{s.status === "succeeded" && (
						<p className="muted">
							授权已保存到本机。模型是否可用，以保存模型后的连接测试结果为准。
						</p>
					)}
					{s.url && (
						<>
							{s.browser === "failed" ? (
								<p className="alert error" role="alert">
									未能自动打开浏览器。请点击下方按钮，或复制链接到浏览器中打开。
								</p>
							) : (
								<p className="muted">
									{s.browser === "opened"
										? "已请求系统浏览器打开授权页面。若未看到页面，可重新打开。"
										: "正在打开系统默认浏览器…"}
								</p>
							)}
							{s.userCode && (
								<div className="device-code">
									<span>在授权页面输入验证码</span>
									<strong>{s.userCode}</strong>
								</div>
							)}
							<div className="actions">
								<button
									className="primary"
									disabled={sending}
									onClick={() =>
										void act(async () => {
											if (
												!(await api.call("authLink", {
													attemptId: s.attemptId,
													action: "open",
												}))
											)
												throw new Error(
													"浏览器未能打开，请复制链接后手动打开。",
												);
										})
									}
								>
									重新打开授权页面 ↗
								</button>
								<button
									disabled={sending}
									onClick={() =>
										void act(async () => {
											await api.call("authLink", {
												attemptId: s.attemptId,
												action: "copy",
											});
											setInfo("授权链接已复制。");
										})
									}
								>
									复制链接
								</button>
							</div>
							{s.expiresAt && (
								<p className="muted small">
									剩余 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒 · 请保持
									PiCareer 开启
								</p>
							)}
						</>
					)}
					{input &&
						(prompt?.kind === "manual_code" && s.url ? (
							<details className="auth-fallback">
								<summary>浏览器回调失败？手动粘贴授权结果</summary>
								<p className="muted">
									若浏览器已跳转到 localhost
									但页面无法打开，可复制完整地址到下方，继续本次授权。
								</p>
								{input}
							</details>
						) : (
							input
						))}
					{error && (
						<p className="alert error" role="alert" ref={errorMessage}>
							{error}
						</p>
					)}
					{info && <p role="status">{info}</p>}
					{s.details && (
						<details>
							<summary>技术详情</summary>
							<code>{s.details}</code>
							{s.diagnostic && <p className="small">
								阶段：{stageNames[s.diagnostic.stage]}
								{s.diagnostic.httpStatus ? ` · HTTP ${s.diagnostic.httpStatus}` : ""}
								<br />诊断编号：{s.diagnostic.id}
							</p>}
						</details>
					)}
				</div>
				<div className="auth-footer">
					{s.modelsRefreshRequired && <button disabled={sending} onClick={() => void act(authorization.refreshModels)}>刷新模型列表</button>}
					{s.provider === "openai-codex" && s.status !== "succeeded" && (
						<button
							disabled={sending || s.status === "cancelling"}
							onClick={() =>
								void act(() =>
									authorization.switchMethod(
										s.method === "browser" ? "device_code" : "browser",
									),
								)
							}
						>
							{s.method === "browser" ? "改用设备码登录" : "改用浏览器登录"}
						</button>
					)}
					{working ? (
						<button
							disabled={s.status === "cancelling"}
							onClick={() => void authorization.cancel()}
						>
							取消授权
						</button>
					) : (
						<>
							{s.status !== "succeeded" && (
								<button
									className="primary"
									onClick={() => void authorization.start(s.provider, s.method)}
								>
									重新连接
								</button>
							)}
							<button
								onClick={() => {
									authorization.close();
									if (s.status === "succeeded") onSelectModels();
								}}
							>
								{s.status === "succeeded" ? "选择模型" : "关闭"}
							</button>
						</>
					)}
				</div>
			</section>
		</div>
	);
}

import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { authContext } from "./auth-context.ts";
import { diagnoseAuthorization, authorizationErrorMessage } from "./auth-diagnostics.ts";
import type { AuthInteraction } from "../../../pi-main/packages/ai/dist/index.js";
import type {
	AuthorizationState,
	LoginInput,
	PromptEvent,
	AuthorizationStage,
	AuthorizationDiagnostic,
} from "../shared/types.ts";

type Login = (
	provider: string,
	interaction: AuthInteraction,
) => Promise<unknown>;
type Waiting = {
	prompt: PromptEvent;
	resolve: (value: string) => void;
	reject: (error: Error) => void;
};
type Attempt = {
	state: AuthorizationState;
	controller: AbortController;
	done: Promise<AuthorizationState>;
	waiting?: Waiting;
	timer?: ReturnType<typeof setTimeout>;
};
const active = (s: AuthorizationState) =>
	s.status === "starting" || s.status === "waiting";

// Only inspect/bind loopback; never terminate another application's listener.
export function checkCallbackPort(): Promise<void> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", () => reject(new Error("CALLBACK_PORT_UNAVAILABLE")));
		server.listen(
			1455,
			process.env.PI_OAUTH_CALLBACK_HOST || "127.0.0.1",
			() => {
				server.close((error) => (error ? reject(error) : resolve()));
			},
		);
	});
}

export class Authorization {
	private current?: Attempt;
	private used = new Set<string>();
	private login: Login;
	private emit: (state: AuthorizationState) => void;
	private preflight: () => Promise<void>;
	private timeout: number;
	private record: (diagnostic: AuthorizationDiagnostic) => void;
	constructor(
		login: Login,
		emit: (state: AuthorizationState) => void,
		options: { preflight?: () => Promise<void>; timeout?: number; record?: (diagnostic: AuthorizationDiagnostic) => void } = {},
	) {
		this.login = login;
		this.emit = emit;
		this.preflight = options.preflight ?? checkCallbackPort;
		this.timeout = options.timeout ?? 15 * 60 * 1000;
		this.record = options.record ?? (() => {});
	}
	start(input: LoginInput): Promise<AuthorizationState> {
		if (
			!/^[a-zA-Z0-9-]{8,100}$/.test(input.attemptId) ||
			!input.provider ||
			!["browser", "device_code"].includes(input.method)
		)
			return Promise.reject(new Error("授权参数无效"));
		if (this.current) {
			if (this.current.state.attemptId === input.attemptId)
				return this.current.done;
			return Promise.reject(new Error("请先取消正在进行的授权"));
		}
		if (this.used.has(input.attemptId))
			return Promise.reject(new Error("此授权已结束，请重新连接"));
		this.used.add(input.attemptId);
		if (this.used.size > 100)
			this.used.delete(this.used.values().next().value!);
		const state: AuthorizationState = {
			...input,
			status: "starting",
			stage: "preparing",
			message: "正在准备授权…",
			expiresAt: Date.now() + this.timeout,
		};
		const attempt: Attempt = {
			state,
			controller: new AbortController(),
			done: Promise.resolve(state),
		};
		this.current = attempt;
		this.publish(attempt, {});
		this.setExpiry(attempt, state.expiresAt!);
		attempt.done = this.run(attempt);
		return attempt.done;
	}
	private publish(a: Attempt, patch: Partial<AuthorizationState>) {
		if (this.current !== a) return;
		a.state = { ...a.state, ...patch };
		this.emit({ ...a.state });
	}
	private setExpiry(a: Attempt, expiresAt: number) {
		clearTimeout(a.timer);
		a.timer = setTimeout(
			() => a.controller.abort(new Error("AUTH_TIMEOUT")),
			Math.max(1, expiresAt - Date.now()),
		);
	}
	private async run(a: Attempt): Promise<AuthorizationState> {
		let status: AuthorizationState["status"] = "succeeded",
			message = "已授权。请选择该供应商的模型，保存后测试连接。",
			details: string | undefined,
			diagnostic: AuthorizationDiagnostic | undefined,
			modelsRefreshRequired = false;
		try {
			if (a.state.provider === "openai-codex" && a.state.method === "browser")
				await this.preflight();
			a.controller.signal.throwIfAborted();
			await authContext.run({ signal: a.controller.signal, progress: (stage) => this.progress(a, stage) }, () => this.login(a.state.provider, {
				signal: a.controller.signal,
				prompt: (p) => {
					if (
						a.state.provider === "openai-codex" &&
						p.type === "select" &&
						p.options.some((o) => o.id === "browser") &&
						p.options.some((o) => o.id === "device_code")
					)
						return Promise.resolve(a.state.method);
					const signal = p.signal
						? AbortSignal.any([a.controller.signal, p.signal])
						: a.controller.signal;
					return new Promise<string>((resolve, reject) => {
						if (signal.aborted) {
							reject(new Error("AUTH_CANCELLED"));
							return;
						}
						const prompt: PromptEvent = {
							id: randomUUID(),
							kind: p.type,
							title:
								p.type === "manual_code" ? "手动粘贴授权结果" : "完成账户授权",
							detail: p.message,
							options: p.type === "select" ? [...p.options] : undefined,
						};
						const finish = (error?: Error, value?: string) => {
							signal.removeEventListener("abort", abort);
							if (a.waiting?.prompt.id === prompt.id) {
								a.waiting = undefined;
								this.publish(a, { prompt: undefined });
							}
							if (error) reject(error);
							else resolve(value!);
						};
						const abort = () => finish(new Error("AUTH_CANCELLED"));
						a.waiting = {
							prompt,
							resolve: (value) => finish(undefined, value),
							reject: (error) => finish(error),
						};
						signal.addEventListener("abort", abort, { once: true });
						this.publish(a, {
							status: "waiting",
							prompt,
							message:
								p.type === "manual_code" && a.state.url
									? "请在浏览器中完成授权，完成后会自动返回结果。"
									: "请按下方提示完成授权。",
						});
					});
				},
				notify: (e) => {
					if (this.current !== a || a.controller.signal.aborted) return;
					if (e.type === "auth_url")
						this.publish(a, {
							status: "waiting",
							stage: "browser",
							url: e.url,
							message: "等待浏览器授权。请在打开的页面中选择账号并完成授权。",
						});
					else if (e.type === "device_code") {
						const expiresAt = Math.min(
							a.state.expiresAt!,
							Date.now() + (e.expiresInSeconds ?? 900) * 1000,
						);
						this.setExpiry(a, expiresAt);
						this.publish(a, {
							status: "waiting",
							stage: "browser",
							url: e.verificationUri,
							userCode: e.userCode,
							expiresAt,
							message:
								"请在浏览器中输入下方验证码。若设备码登录不可用，请检查账户的安全设置。",
						});
					} else this.publish(a, { message: "正在处理授权，请稍候…" });
				},
			}));
		} catch (e) {
			const reason = a.controller.signal.reason;
			if (e instanceof Error && e.name === "CredentialSynchronizationError") {
				status = "succeeded";
				modelsRefreshRequired = true;
				message = "授权已保存，模型列表刷新失败。请点击刷新模型列表，无需重复授权。";
				diagnostic = diagnoseAuthorization(e, "refreshing");
				diagnostic.category = "AUTH_MODEL_REFRESH_ERROR";
				details = diagnostic.category;
			} else if (reason?.message === "AUTH_TIMEOUT") {
				status = "failed";
				message = "授权已超时，请重新连接。";
				details = "AUTH_TIMEOUT";
			} else if (a.controller.signal.aborted) {
				status = "cancelled";
				message = "已取消授权。重新连接会生成新的授权链接。";
			} else {
				status = "failed";
				diagnostic = diagnoseAuthorization(e, a.state.stage ?? "preparing");
				details = diagnostic.category;
				message = authorizationErrorMessage(diagnostic);
			}
		} finally {
			clearTimeout(a.timer);
			a.controller.abort();
			a.waiting?.reject(new Error("AUTH_CANCELLED"));
			// Pi may reject its abort race before the provider's finally closes the listener.
			await delay(0);
		}
		if (!diagnostic && status === "failed" && details) diagnostic = { id: randomUUID(), stage: a.state.stage ?? "preparing", category: details };
		if (diagnostic) {
			try { this.record(diagnostic); } catch { /* Diagnostics must never change a login result. */ }
		}
		this.publish(a, {
			stage: status === "succeeded" && !modelsRefreshRequired ? "complete" : a.state.stage,
			diagnostic,
			modelsRefreshRequired,
			status,
			message,
			details,
			url: undefined,
			userCode: undefined,
			prompt: undefined,
			expiresAt: undefined,
		});
		if (this.current === a) this.current = undefined;
		return a.state;
	}
	private progress(a: Attempt, stage: AuthorizationStage) {
		if (a.controller.signal.aborted || this.current !== a) return;
		const messages: Partial<Record<AuthorizationStage, string>> = {
			exchanging: "已收到授权结果，正在交换访问令牌…",
			validating: "正在验证账户令牌…",
			saving: "正在加密保存授权凭据…",
			refreshing: "授权已保存，正在刷新模型列表…",
		};
		this.publish(a, { stage, message: messages[stage] ?? a.state.message,
			url: undefined, userCode: undefined, prompt: undefined });
	}

	async cancel(attemptId: string) {
		const a = this.current;
		if (!a || a.state.attemptId !== attemptId) return false;
		this.publish(a, {
			status: "cancelling",
			message: "正在取消授权…",
			url: undefined,
			userCode: undefined,
			prompt: undefined,
		});
		a.controller.abort(new Error("AUTH_CANCELLED"));
		await a.done;
		return true;
	}
	reply(attemptId: string, promptId: string, value: string) {
		const a = this.current,
			waiting = a?.waiting;
		if (
			!a ||
			!active(a.state) ||
			a.state.attemptId !== attemptId ||
			waiting?.prompt.id !== promptId
		)
			return false;
		value = value.trim();
		if (!value && waiting.prompt.kind !== "text")
			throw new Error("请输入授权结果；如需退出，请点击取消授权。");
		if (value.length > 16000) throw new Error("授权输入过长。");
		if (
			waiting.prompt.kind === "select" &&
			!waiting.prompt.options?.some((o) => o.id === value)
		)
			throw new Error("请选择有效的选项。");
		if (
			a.state.provider === "openai-codex" &&
			waiting.prompt.kind === "manual_code"
		) {
			let url: URL;
			try {
				url = new URL(value);
			} catch {
				throw new Error("请粘贴浏览器地址栏中的完整回调地址。");
			}
			const expected = new URL(a.state.url!).searchParams.get("state");
			if (
				url.protocol !== "http:" ||
				!["localhost", "127.0.0.1"].includes(url.hostname) ||
				url.port !== "1455" ||
				url.pathname !== "/auth/callback" ||
				!url.searchParams.get("code") ||
				!expected ||
				url.searchParams.get("state") !== expected
			)
				throw new Error(
					"这不是本次授权的有效回调地址，请检查是否复制完整，或重新连接。",
				);
		}
		waiting.resolve(value);
		this.publish(a, {
			message: "正在验证授权结果…",
			url: undefined,
			userCode: undefined,
		});
		return true;
	}
}

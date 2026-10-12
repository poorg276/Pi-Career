import type { AuthorizationState, LoginInput } from "../shared/types.ts";

export class AuthorizationBrowser {
	private state?: AuthorizationState;
	private opened = false;
	private open: (url: string) => Promise<void>;
	private copy: (url: string) => void | Promise<void>;
	private emit: (state: AuthorizationState) => void;
	constructor(
		open: (url: string) => Promise<void>,
		copy: (url: string) => void | Promise<void>,
		emit: (state: AuthorizationState) => void,
	) {
		this.open = open;
		this.copy = copy;
		this.emit = emit;
	}
	arm(input: LoginInput) {
		if (
			this.state &&
			["starting", "waiting", "cancelling"].includes(this.state.status)
		)
			throw new Error("请先取消正在进行的授权");
		this.state = { ...input, status: "starting", message: "正在准备授权…" };
		this.opened = false;
	}
	receive(state: AuthorizationState) {
		if (
			this.state?.attemptId !== state.attemptId ||
			this.state.provider !== state.provider
		)
			return;
		const browser =
			state.url === this.state.url ? this.state.browser : undefined;
		this.state = { ...state, browser };
		this.emit(this.state);
		if (state.url && state.status === "waiting" && !this.opened) {
			this.opened = true;
			void this.performOpen(state.attemptId);
		}
	}
	private currentUrl(attemptId: string) {
		const s = this.state;
		if (
			!s ||
			s.attemptId !== attemptId ||
			s.status !== "waiting" ||
			!s.url ||
			(s.expiresAt && s.expiresAt <= Date.now())
		)
			throw new Error("此授权链接已失效，请重新连接。");
		const url = new URL(s.url);
		if (url.protocol !== "https:" || url.username || url.password)
			throw new Error("授权链接无效，请重新连接。");
		return url.href;
	}
	private async performOpen(attemptId: string) {
		try {
			const url = this.currentUrl(attemptId);
			this.state = { ...this.state!, browser: "opening" };
			this.emit(this.state);
			await this.open(url);
			if (
				this.state?.attemptId === attemptId &&
				this.state.url === url &&
				this.state.status === "waiting"
			) {
				this.state = { ...this.state, browser: "opened" };
				this.emit(this.state);
			}
			return true;
		} catch {
			if (
				this.state?.attemptId === attemptId &&
				this.state.status === "waiting"
			) {
				this.state = { ...this.state, browser: "failed" };
				this.emit(this.state);
			}
			return false;
		}
	}
	async link(attemptId: string, action: string) {
		const url = this.currentUrl(attemptId);
		if (action === "copy") {
			await this.copy(url);
			return true;
		}
		if (action === "open") return this.performOpen(attemptId);
		throw new Error("无效操作");
	}
	fail(message: string) {
		if (
			!this.state ||
			!["starting", "waiting", "cancelling"].includes(this.state.status)
		)
			return;
		this.receive({
			...this.state,
			status: "failed",
			message,
			details: "AUTH_BACKEND_UNAVAILABLE",
			url: undefined,
			prompt: undefined,
			userCode: undefined,
			expiresAt: undefined,
		});
	}
}

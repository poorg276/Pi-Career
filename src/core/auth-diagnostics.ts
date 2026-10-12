import { randomUUID } from "node:crypto";
import type { AuthorizationDiagnostic, AuthorizationStage } from "../shared/types.ts";

export function diagnoseAuthorization(error: unknown, stage: AuthorizationStage): AuthorizationDiagnostic {
	let category = "AUTH_PROVIDER_ERROR", httpStatus: number | undefined;
	const seen = new Set<unknown>();
	for (let current = error; current && !seen.has(current) && seen.size < 8;) {
		seen.add(current);
		const e = current as { message?: unknown; code?: unknown; httpStatus?: number; cause?: unknown };
		const raw = typeof e.message === "string" ? e.message : "";
		if (typeof e.httpStatus === "number" && e.httpStatus >= 100 && e.httpStatus <= 599) httpStatus = e.httpStatus;
		const allowed = /^(AUTH_(?:PROXY_UNSUPPORTED|PROXY_INVALID|PROXY_RESOLUTION|NETWORK_TIMEOUT|NETWORK_ERROR|HTTP_ERROR|EXPIRED|STORAGE_ERROR))$/;
		if (typeof e.code === "string" && allowed.test(e.code)) category = e.code;
		else if (allowed.test(raw)) category = raw;
		else if (/CALLBACK_PORT_UNAVAILABLE/.test(raw)) category = "CALLBACK_PORT_UNAVAILABLE";
		else if (/device code login is not enabled/i.test(raw)) category = "AUTH_DEVICE_NOT_ENABLED";
		else if (/Failed to extract accountId|response missing fields|JSON/i.test(raw)) category = "AUTH_TOKEN_INVALID";
		else if (/invalid_grant|expired/i.test(raw)) category = "AUTH_EXPIRED";
		else if (/state mismatch/i.test(raw)) category = "AUTH_STATE_MISMATCH";
		else if (/token (?:exchange|refresh) failed \((\d{3})\)/.test(raw)) {
			category = "AUTH_HTTP_ERROR";
			httpStatus = Number(/failed \((\d{3})\)/.exec(raw)?.[1]);
		} else if (/fetch|network|ECONN|ENOTFOUND|timeout|timed out/i.test(raw)) category = "AUTH_NETWORK_ERROR";
		current = e.cause;
	}
	if (stage === "saving") category = "AUTH_STORAGE_ERROR";
	return { id: randomUUID(), stage, category, ...(httpStatus ? { httpStatus } : {}) };
}
export function authorizationErrorMessage(d: AuthorizationDiagnostic): string {
	const messages: Record<string, string> = {
		CALLBACK_PORT_UNAVAILABLE: "本地授权端口 1455 无法使用，可能被其他程序占用。可改用设备码登录，或关闭占用程序后重试。",
		AUTH_DEVICE_NOT_ENABLED: "此账户或服务尚未启用设备码登录，请检查账户安全设置，或改用浏览器登录。",
		AUTH_TOKEN_INVALID: "已收到授权服务响应，但无法解析有效的账户令牌。请重新连接；若仍失败，请提供下方诊断编号。",
		AUTH_STORAGE_ERROR: "已获得授权，但凭据未能加密保存到本机。请重新打开应用后重试。",
		AUTH_EXPIRED: "授权结果已过期或失效，请重新连接。",
		AUTH_STATE_MISMATCH: "授权结果与本次登录不匹配，请重新连接。",
		AUTH_NETWORK_ERROR: "无法连接授权服务，请检查系统代理与网络后重新连接。",
		AUTH_NETWORK_TIMEOUT: "连接授权服务超时，请检查系统代理与网络后重新连接。",
		AUTH_PROXY_RESOLUTION: "无法读取系统代理，请检查系统网络设置后重试。",
		AUTH_PROXY_UNSUPPORTED: "当前系统代理类型暂不支持，请使用 HTTP／HTTPS 系统代理后重试。",
		AUTH_PROXY_INVALID: "系统代理地址无效，请检查系统网络设置后重试。",
	};
	return messages[d.category] ?? (d.category === "AUTH_HTTP_ERROR"
		? `授权服务拒绝了令牌交换请求（HTTP ${d.httpStatus ?? "未知"}）。请检查网络出口和账户状态后重新连接。`
		: "授权未完成，请重新连接。若仍失败，请提供下方诊断编号。");
}

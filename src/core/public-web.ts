import { isIP } from "node:net";
import { trustedZhiyeHost } from "./recruitment.ts";

export interface WebPage {
	url: string;
	body: string;
	contentType: string;
}
export interface RecruitmentRequest { pageIndex: number; category: "1" | "2" | "3" }
export type WebReader = (url: string, signal?: AbortSignal, request?: RecruitmentRequest) => Promise<WebPage>;
export function validateRecruitmentRequest(url: string, request: RecruitmentRequest): void {
	const u = publicUrl(url);
	if (!trustedZhiyeHost(url) || u.pathname !== "/api/Jobad/GetJobAdPageList" || u.search ||
		!Number.isInteger(request.pageIndex) || request.pageIndex < 0 || request.pageIndex > 4 ||
		!["1", "2", "3"].includes(request.category))
		throw new WebError("ADDRESS", "仅允许读取已核验招聘站点的公开职位列表。");
}
function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			reject(signal.reason);
		};
		if (signal.aborted) {
			task.catch(() => {});
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
		task.then(
			(value) => {
				signal.removeEventListener("abort", abort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
	});
}
export class WebError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "WebError";
		this.code = code;
	}
}
export function publicIP(address: string): boolean {
	if (isIP(address) === 4) {
		const [a, b, c] = address.split(".").map(Number);
		return !(
			a === 0 ||
			a === 10 ||
			a === 127 ||
			a >= 224 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
			(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
			(a === 203 && b === 0 && c === 113)
		);
	}
	if (isIP(address) !== 6) return false;
	// Accept ordinary globally routed IPv6 only, excluding transition/documentation ranges.
	const first = parseInt(address.split(":")[0], 16);
	return first >= 0x2000 && first <= 0x3fff && !/^200[12]:/i.test(address);
}
export function publicUrl(input: string): URL {
	let u: URL;
	try {
		u = new URL(input);
	} catch {
		throw new WebError("ADDRESS", "网页地址无效。");
	}
	const host = u.hostname
		.replace(/^\[|\]$/g, "")
		.toLowerCase()
		.replace(/\.$/, "");
	if (
		input.length > 8000 ||
		!["http:", "https:"].includes(u.protocol) ||
		u.username ||
		u.password ||
		(u.port && !["80", "443"].includes(u.port)) ||
		(!host.includes(".") && !isIP(host)) ||
		/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
		(isIP(host) && !publicIP(host))
	)
		throw new WebError(
			"ADDRESS",
			"仅支持公开网页，不能访问本机、内网或非标准网页端口。",
		);
	u.hostname = isIP(host) === 6 ? `[${host}]` : host;
	u.hash = "";
	return u;
}

// Transport is injected: production uses an isolated Electron session; tests use fixtures.
export async function readPublicPage(
	input: string,
	transport: (url: string, signal: AbortSignal) => Promise<Response>,
	resolveHost: (host: string, url: string) => Promise<string[]>,
	parent?: AbortSignal,
	timeout = 20000,
	allowJSON = false,
): Promise<WebPage> {
	const signal = AbortSignal.any([
		...(parent ? [parent] : []),
		AbortSignal.timeout(timeout),
	]);
	try {
		let url = publicUrl(input);
		for (let redirects = 0; redirects <= 5; redirects++) {
			signal.throwIfAborted();
			if (/\/(?:[^/]+\/)*(?:verify|captcha|challenge)(?:\.html)?(?:\/|$)/i.test(url.pathname))
				throw new WebError("VERIFICATION", "网站要求安全验证，可在系统浏览器打开官方入口；未将验证页作为岗位正文。");
			if (/\/(?:login|signin)(?:\.html)?(?:\/|$)/i.test(url.pathname))
				throw new WebError("LOGIN", "网站要求登录，可在系统浏览器打开招聘入口查看。");
			const host = url.hostname.replace(/^\[|\]$/g, "");
			const addresses = isIP(host)
				? [host]
				: await abortable(resolveHost(host, url.href), signal);
			signal.throwIfAborted();
			if (!addresses.length || addresses.some((ip) => !publicIP(ip)))
				throw new WebError("ADDRESS", "已阻止访问非公开网络地址。");
			const res = await abortable(
				transport(url.href, signal).then(async (res) => {
					if (signal.aborted) {
						await res.body?.cancel();
						signal.throwIfAborted();
					}
					return res;
				}),
				signal,
			);
			if ([301, 302, 303, 307, 308].includes(res.status)) {
				await res.body?.cancel();
				const target = res.headers.get("location");
				if (!target) throw new WebError("REDIRECT", "网页重定向缺少目标地址。");
				url = publicUrl(new URL(target, url).href);
				continue;
			}
			if (!res.ok) {
				await res.body?.cancel();
				throw new WebError(
					res.status === 429 ? "RATE_LIMIT" : "HTTP",
					res.status === 429
						? "网站访问限流（HTTP 429），请稍后重试。"
						: `网页拒绝访问（HTTP ${res.status}），可能需要登录或验证。`,
				);
			}
			const contentType = res.headers.get("content-type") ?? "";
			if (
				!/^(text\/(html|plain)|application\/xhtml\+xml)\b/i.test(contentType) &&
				!(allowJSON && /^application\/json\b/i.test(contentType))
			) {
				await res.body?.cancel();
				throw new WebError(
					"CONTENT_TYPE",
					"目前支持 HTML 和纯文本网页，此地址返回了其他文件类型。",
				);
			}
			const limit = 2 * 1024 * 1024;
			if (Number(res.headers.get("content-length")) > limit) {
				await res.body?.cancel();
				throw new WebError("SIZE", "网页内容过大，已停止读取。");
			}
			const reader = res.body?.getReader(),
				chunks: Uint8Array[] = [];
			let size = 0;
			try {
				if (reader)
					while (true) {
						signal.throwIfAborted();
						const chunk = await reader.read();
						if (chunk.done) break;
						size += chunk.value.byteLength;
						if (size > limit)
							throw new WebError("SIZE", "网页内容过大，已停止读取。");
						chunks.push(chunk.value);
					}
			} finally {
				await reader?.cancel().catch(() => {});
			}
			const bytes = Buffer.concat(chunks);
			const charset =
				/charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ??
				/charset\s*=\s*["']?([\w-]+)/i.exec(
					bytes.subarray(0, 2048).toString("ascii"),
				)?.[1] ??
				"utf-8";
			let body: string;
			try {
				body = new TextDecoder(charset).decode(bytes);
			} catch {
				body = bytes.toString("utf8");
			}
			return { url: url.href, body, contentType };
		}
		throw new WebError("REDIRECT", "网页重定向次数过多。");
	} catch (error) {
		if (parent?.aborted) throw parent.reason;
		if (signal.aborted)
			throw new WebError("TIMEOUT", "网页请求超时，请稍后重试。");
		if (error instanceof WebError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		const proxy = /PROXY|TUNNEL/i.test(message);
		throw new WebError(proxy ? "PROXY" : "NETWORK", proxy
			? "系统代理连接失败；未绕过代理。"
			: "网页连接失败，请检查网络或稍后重试。");
	}
}

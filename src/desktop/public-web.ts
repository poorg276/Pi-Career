import { session, net, type Session } from "electron";
import { randomUUID } from "node:crypto";
import { proxyRoute } from "../core/codex-network.ts";
import { readPublicPage, WebError, validateRecruitmentRequest, type RecruitmentRequest } from "../core/public-web.ts";

// Electron fetch rejects manual redirects. Capture a single response with ClientRequest,
// then let readPublicPage validate DNS, destination and proxy before every next hop.
export function requestResponse(isolated: Session, url: string, signal: AbortSignal, body?: string): Promise<Response> {
	return new Promise((resolve, reject) => {
		signal.throwIfAborted();
		const request = net.request({ url, session: isolated, method: body ? "POST" : "GET", redirect: "manual", credentials: "omit", useSessionCookies: false });
		let settled = false;
		const finish = (error?: Error, response?: Response) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", abort);
			if (error) reject(error); else resolve(response!);
		};
		const abort = () => { finish(signal.reason); request.abort(); };
		signal.addEventListener("abort", abort, { once: true });
		request.setHeader("Accept", body ? "application/json" : "text/html,application/xhtml+xml,text/plain;q=0.8");
		request.setHeader("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.7");
		request.on("login", (_auth, callback) => callback());
		request.on("error", error => finish(error));
		request.on("redirect", (status, _method, target) => {
			if (body) finish(new WebError("REDIRECT", "招聘数据接口发生跳转，已停止读取；请打开官网查看。"));
			else finish(undefined, new Response(null, { status, headers: { location: target } }));
			request.abort();
		});
		request.on("response", incoming => {
			const chunks: Buffer[] = []; let size = 0;
			const headers = new Headers();
			for (const [key, value] of Object.entries(incoming.headers))
				if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
			if (Number(headers.get("content-length")) > 2 * 1024 * 1024) {
				finish(new WebError("SIZE", "网页内容过大，已停止读取。")); request.abort(); return;
			}
			incoming.on("data", chunk => {
				size += chunk.length;
				if (size > 2 * 1024 * 1024) { finish(new WebError("SIZE", "网页内容过大，已停止读取。")); request.abort(); }
				else chunks.push(Buffer.from(chunk));
			});
			incoming.on("error", error => finish(error));
			incoming.on("aborted", () => finish(new WebError("NETWORK", "网页响应已中断。")));
			incoming.on("end", () => finish(undefined, new Response([204, 205, 304].includes(incoming.statusCode) ? null : Buffer.concat(chunks), { status: incoming.statusCode, headers })));
		});
		if (body) { request.setHeader("Content-Type", "application/json"); request.write(body); }
		request.end();
	});
}

export class PublicWeb {
	private routes = new Map<string, Promise<Session>>();
	private pending = new Map<string, AbortController>();
	private async route(url: string): Promise<Session> {
		let proxy: string | undefined;
		try {
			proxy = proxyRoute(await session.defaultSession.resolveProxy(url));
		} catch {
			throw new WebError(
				"PROXY",
				"系统代理解析失败或代理类型不受支持；未绕过代理。",
			);
		}
		const key = proxy ?? "DIRECT";
		if (!this.routes.has(key))
			this.routes.set(
				key,
				(async () => {
					// Not the offline application session, and never a persistent browser profile.
					const isolated = session.fromPartition(
						`picareer-web-${randomUUID()}`,
						{ cache: false },
					);
					isolated.setPermissionRequestHandler((_w, _p, done) => done(false));
					await isolated.setProxy(
						proxy
							? {
									mode: "fixed_servers",
									proxyRules: proxy,
									proxyBypassRules: "<-loopback>",
								}
							: { mode: "direct" },
					);
					return isolated;
				})(),
			);
		return this.routes.get(key)!;
	}
	async read(id: string, url: string, input?: unknown) {
		if (input !== undefined && (!input || typeof input !== "object")) throw new WebError("ADDRESS", "招聘数据请求无效。");
		const recruitment = input as RecruitmentRequest | undefined;
		if (recruitment) validateRecruitmentRequest(url, recruitment);
		if (this.pending.has(id) || this.pending.size >= 8)
			throw new WebError("BUSY", "联网请求过多，请稍后重试。");
		const controller = new AbortController();
		this.pending.set(id, controller);
		try {
			return await readPublicPage(
				url,
				async (target, signal) => {
					const isolated = await this.route(target);
					signal.throwIfAborted();
					return requestResponse(isolated, target, signal, recruitment ? JSON.stringify({
						PageIndex: recruitment.pageIndex, PageSize: 20, Category: [recruitment.category], KeyWords: "",
						SpecialType: 0, PortalId: "", DisplayFields: ["Category", "Kind", "LocId", "PostDate", "Salary"],
					}) : undefined);
				},
				async (host, target) => {
					const isolated = await this.route(target);
					return (
						await isolated.resolveHost(host, { cacheUsage: "allowed" })
					).endpoints.map((p) => p.address);
				},
				controller.signal,
				20000,
				!!recruitment,
			);
		} finally {
			this.pending.delete(id);
		}
	}
	cancel(id: string) {
		this.pending.get(id)?.abort();
	}
	close() {
		for (const controller of this.pending.values()) controller.abort();
	}
}

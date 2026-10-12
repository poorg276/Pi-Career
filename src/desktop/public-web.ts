import { session, type Session } from "electron";
import { randomUUID } from "node:crypto";
import { proxyRoute } from "../core/codex-network.ts";
import { readPublicPage, WebError } from "../core/public-web.ts";

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
	async read(id: string, url: string) {
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
					return isolated.fetch(target, {
						method: "GET",
						redirect: "manual",
						credentials: "omit",
						signal,
						headers: {
							Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
							"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
						},
					});
				},
				async (host, target) => {
					const isolated = await this.route(target);
					return (
						await isolated.resolveHost(host, { cacheUsage: "allowed" })
					).endpoints.map((p) => p.address);
				},
				controller.signal,
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

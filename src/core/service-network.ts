import { Agent, ProxyAgent, type Dispatcher } from "undici";
import { proxyRoute } from "./codex-network.ts";
import { toolOrigins } from "../shared/network-origins.ts";

export function createServiceFetch(
	resolveProxy: (origin: string) => Promise<string>,
	original: typeof fetch = globalThis.fetch,
	makeProxy: (uri: string) => Dispatcher = (uri) => new ProxyAgent(uri),
) {
	const direct = new Agent(),
		agents = new Map<string, Dispatcher>();
	const fetcher: typeof fetch = async (input, init) => {
		const url = new URL(
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url,
		);
		if (!toolOrigins.has(url.origin) || url.username || url.password)
			return original(input, init);
		const parent =
			init?.signal ?? (input instanceof Request ? input.signal : undefined);
		const signal = AbortSignal.any([
			...(parent ? [parent] : []),
			AbortSignal.timeout(30000),
		]);
		try {
			signal.throwIfAborted();
			const route = proxyRoute(await resolveProxy(url.origin));
			signal.throwIfAborted();
			if (route && !agents.has(route)) agents.set(route, makeProxy(route));
			return await original(input, {
				...init,
				signal,
				dispatcher: route ? agents.get(route) : direct,
				redirect: "error",
			} as RequestInit);
		} catch {
			if (parent?.aborted) throw parent.reason;
			throw new Error(
				signal.aborted
					? "联网服务请求超时，请稍后重试。"
					: "联网服务连接失败，请检查网络和系统代理；未自动绕过代理。",
			);
		}
	};
	return {
		fetch: fetcher,
		close: async () => {
			await Promise.all([
				direct.destroy(),
				...[...agents.values()].map((a) => a.destroy()),
			]);
		},
	};
}

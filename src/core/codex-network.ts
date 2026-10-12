import { Agent, ProxyAgent, type Dispatcher } from "undici";
import { authProgress } from "./auth-context.ts";

const origins = new Set(["https://auth.openai.com", "https://chatgpt.com"]);
export function codexOrigin(input: string): string | undefined {
	try {
		const url = new URL(input);
		return !url.username && !url.password && origins.has(url.origin)
			? url.origin : undefined;
	} catch { return undefined; }
}
export class CodexNetworkError extends Error {
	code: string;
	httpStatus?: number;
	constructor(code: string, httpStatus?: number) {
		super(code);
		this.name = "CodexNetworkError";
		this.code = code;
		this.httpStatus = httpStatus;
	}
}
// Follow the first route selected by the OS. Never silently bypass a failed proxy.
export function proxyRoute(result: string): string | undefined {
	const first = result.split(";")[0]?.trim();
	if (first === "DIRECT") return undefined;
	const match = /^(PROXY|HTTPS)\s+([^\s/]+)$/i.exec(first);
	if (!match) throw new CodexNetworkError("AUTH_PROXY_UNSUPPORTED");
	try {
		const url = new URL(`${match[1].toUpperCase() === "HTTPS" ? "https" : "http"}://${match[2]}`);
		if (url.username || url.password || !url.hostname) throw new Error();
		return url.origin;
	} catch { throw new CodexNetworkError("AUTH_PROXY_INVALID"); }
}

export function createCodexFetch(
	resolveProxy: (origin: string) => Promise<string>,
	original: typeof fetch = globalThis.fetch,
	makeProxy: (uri: string) => Dispatcher = (uri) => new ProxyAgent(uri),
) {
	const agents = new Map<string, Dispatcher>();
	const direct = new Agent();
	const fetcher: typeof fetch = async (input, init) => {
		const address = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const origin = codexOrigin(address);
		if (!origin) return original(input, init);
		const url = new URL(address);
		const exchange = origin === "https://auth.openai.com" && url.pathname === "/oauth/token";
		if (exchange) authProgress("exchanging");
		const parentSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
		const signal = origin === "https://auth.openai.com"
			? AbortSignal.any([...(parentSignal ? [parentSignal] : []), AbortSignal.timeout(60000)])
			: parentSignal;
		let response: Response;
		try {
			signal?.throwIfAborted();
			const route = proxyRoute(await resolveProxy(origin));
			signal?.throwIfAborted();
			let dispatcher = direct as Dispatcher;
			if (route) {
				if (!agents.has(route)) agents.set(route, makeProxy(route));
				dispatcher = agents.get(route)!;
			}
			// Use native fetch so Request/Response and streaming retain their original semantics.
			response = await original(input, { ...init, signal, dispatcher, redirect: "error" } as RequestInit);
		} catch (error) {
			if (parentSignal?.aborted) throw parentSignal.reason;
			if (error instanceof CodexNetworkError) throw error;
			if (error instanceof Error && error.message === "AUTH_PROXY_RESOLUTION") throw new CodexNetworkError("AUTH_PROXY_RESOLUTION");
			throw new CodexNetworkError(signal?.aborted ? "AUTH_NETWORK_TIMEOUT" : "AUTH_NETWORK_ERROR");
		}
		if (exchange && !response.ok) {
			// Never carry upstream response bodies (which can contain credentials) into diagnostics.
			let code = "AUTH_HTTP_ERROR";
			if (response.status === 400) {
				const body = await response.clone().json().catch(() => null);
				if (body?.error === "invalid_grant" || body?.error?.code === "invalid_grant") code = "AUTH_EXPIRED";
			}
			await response.body?.cancel();
			throw new CodexNetworkError(code, response.status);
		}
		if (exchange) authProgress("validating");
		return response;
	};
	return { fetch: fetcher, close: async () => {
		await Promise.all([direct.destroy(), ...[...agents.values()].map((a) => a.destroy())]);
	} };
}

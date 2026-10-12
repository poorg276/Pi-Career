import { randomUUID } from "node:crypto";
import { Service } from "../core/service.ts";
import type { AppEvent, PromptEvent, ArtifactTarget } from "../shared/types.ts";
import { createCodexFetch } from "../core/codex-network.ts";
import { createServiceFetch } from "../core/service-network.ts";
import type { WebPage, WebReader } from "../core/public-web.ts";
type ParentPort = {
	postMessage(value: unknown): void;
	on(
		name: string,
		fn: (event: { data: Record<string, unknown> }) => void,
	): void;
};
const port = (process as unknown as { parentPort: ParentPort }).parentPort;
const pending = new Map<
	string,
	{ resolve: (s: string) => void; reject: (e: Error) => void }
>();
function ask(
	prompt: Omit<PromptEvent, "id">,
	signal?: AbortSignal,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const id = randomUUID();
		const timer = setTimeout(
			() => {
				pending.delete(id);
				emit({ type: "promptClosed", id });
				signal?.removeEventListener("abort", abort);
				reject(new Error("等待输入超时"));
			},
			10 * 60 * 1000,
		);
		const abort = () => {
			pending.delete(id);
			clearTimeout(timer);
			emit({ type: "promptClosed", id });
			reject(new Error("操作已取消"));
		};
		if (signal?.aborted) {
			abort();
			return;
		}
		signal?.addEventListener("abort", abort, { once: true });
		pending.set(id, {
			resolve: (s) => {
				clearTimeout(timer);
				emit({ type: "promptClosed", id });
				signal?.removeEventListener("abort", abort);
				resolve(s);
			},
			reject,
		});
		emit({ type: "prompt", prompt: { ...prompt, id } });
	});
}
function emit(event: AppEvent) {
	port.postMessage({ type: "event", event });
}
function crypt(op: string, value: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const id = randomUUID();
		pending.set(id, { resolve, reject });
		port.postMessage({ type: "crypt", id, op, value });
	});
}
const resolveProxy = (origin: string): Promise<string> =>
	new Promise((resolve, reject) => {
		const id = randomUUID();
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error("AUTH_PROXY_RESOLUTION"));
		}, 10000);
		pending.set(id, {
			resolve: (value) => {
				clearTimeout(timer);
				resolve(value);
			},
			reject: () => {
				clearTimeout(timer);
				reject(new Error("AUTH_PROXY_RESOLUTION"));
			},
		});
		port.postMessage({ type: "resolveProxy", id, origin });
	});
const serviceNetwork = createServiceFetch(resolveProxy);
const network = createCodexFetch(resolveProxy, serviceNetwork.fetch);
globalThis.fetch = network.fetch;
const webPending = new Map<
	string,
	{ resolve: (page: WebPage) => void; reject: (error: Error) => void }
>();
const readWeb: WebReader = (url, signal) =>
	new Promise((resolve, reject) => {
		const id = randomUUID();
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			webPending.delete(id);
		};
		const abort = () => {
			cleanup();
			port.postMessage({ type: "webCancel", id });
			reject(signal?.reason ?? new Error("网页读取已取消。"));
		};
		const timer = setTimeout(() => {
			cleanup();
			port.postMessage({ type: "webCancel", id });
			reject(new Error("网页读取超时。"));
		}, 25000);
		if (signal?.aborted) {
			abort();
			return;
		}
		signal?.addEventListener("abort", abort, { once: true });
		webPending.set(id, {
			resolve: (page) => {
				cleanup();
				resolve(page);
			},
			reject: (error) => {
				cleanup();
				reject(error);
			},
		});
		port.postMessage({ type: "webRead", id, url });
	});
const trashArtifact = (target: ArtifactTarget): Promise<void> =>
	new Promise((resolve, reject) => {
		const id = randomUUID();
		pending.set(id, { resolve: () => resolve(), reject });
		port.postMessage({ type: "trashArtifact", id, target });
	});
const service = new Service(
	process.argv[2],
	crypt,
	emit,
	ask,
	readWeb,
	trashArtifact,
);
const ready = service.pi.init();
ready
	.then(() => {
		port.postMessage({ type: "ready" });
		if (process.env.PICAREER_DASHBOARD_AUTOSTART !== "0" &&
			(!process.env.PICAREER_TEST_DATA || process.env.PICAREER_DASHBOARD_AUTOSTART === "1")) service.dashboard.start();
	})
	.catch((e) => port.postMessage({ type: "fatal", error: String(e) }));
port.on("message", async ({ data: m }) => {
	if (m.type === "webReply") {
		const task = webPending.get(String(m.id));
		if (m.error) task?.reject(new Error(String(m.error)));
		else task?.resolve(m.value as WebPage);
		return;
	}
	if (m.type === "reply") {
		const p = pending.get(String(m.id));
		pending.delete(String(m.id));
		if (m.error) p?.reject(new Error(String(m.error)));
		else p?.resolve(String(m.value ?? ""));
		return;
	}
	if (m.type !== "call") return;
	try {
		await ready;
		const result = await service.call(
			String(m.method),
			(m.input ?? {}) as Record<string, unknown>,
		);
		port.postMessage({ type: "result", id: m.id, result });
	} catch (e) {
		port.postMessage({
			type: "result",
			id: m.id,
			error: e instanceof Error ? e.message : String(e),
		});
	}
});

import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, AppEvent, Method, ApiMap } from "../shared/types.ts";
const bridge: Bridge = {
	call: <K extends Method>(method: K, input: ApiMap[K]["input"]) =>
		ipcRenderer.invoke("call", method, input),
	onEvent: (fn: (e: AppEvent) => void) => {
		const handler = (_: unknown, e: AppEvent) => fn(e);
		ipcRenderer.on("event", handler);
		return () => ipcRenderer.removeListener("event", handler);
	},
};
contextBridge.exposeInMainWorld("picareer", bridge);

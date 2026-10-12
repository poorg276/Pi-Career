import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthorizationStage } from "../shared/types.ts";

export const authContext = new AsyncLocalStorage<{
	signal: AbortSignal;
	progress: (stage: AuthorizationStage) => void;
}>();
export function authProgress(stage: AuthorizationStage) {
	const context = authContext.getStore();
	if (context && !context.signal.aborted) context.progress(stage);
}

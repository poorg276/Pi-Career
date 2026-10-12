import type { CodingAttempt, CodingAttemptInput } from "../shared/types.ts";
import { Store } from "./store.ts";
import problems from "../../content/problems.json" with { type: "json" };
const ids = new Set(problems.map((p) => p.id));
export class CodingRecords {
	store: Store;
	constructor(store: Store) {
		this.store = store;
	}
	list(): CodingAttempt[] {
		return this.store
			.list<CodingAttempt>("coding-attempt")
			.sort((a, b) => a.problemId - b.problemId || a.number - b.number);
	}
	save(input: CodingAttemptInput): CodingAttempt[] {
		if (
			!input ||
			!/^[a-f0-9-]{36}$/i.test(input.id) ||
			!ids.has(input.problemId) ||
			typeof input.correct !== "boolean" ||
			typeof input.notes !== "string" ||
			input.notes.length > 30000 ||
			!["create", "update"].includes(input.mode)
		)
			throw new Error("请确认题目、正确／错误选项及心得内容。");
		this.store.db.exec("BEGIN IMMEDIATE");
		try {
			const old = this.store.get<CodingAttempt>("coding-attempt", input.id);
			if (old && old.problemId !== input.problemId)
				throw new Error("不能更改记录所属题目。");
			if (input.mode === "update" && !old) throw new Error("刷题记录不存在。");
			// A repeated create is a retry, never an edit or another attempt.
			if (!old || input.mode === "update") {
				const now = new Date().toISOString();
				const number =
					old?.number ??
					Math.max(
						0,
						...this.list()
							.filter((a) => a.problemId === input.problemId)
							.map((a) => a.number),
					) + 1;
				this.store.put("coding-attempt", input.id, {
					id: input.id,
					problemId: input.problemId,
					number,
					correct: input.correct,
					notes: input.notes,
					created: old?.created ?? now,
					updated: now,
				});
			}
			this.store.db.exec("COMMIT");
		} catch (error) {
			this.store.db.exec("ROLLBACK");
			throw error;
		}
		return this.list();
	}
	progress() {
		const legacy = this.store.list<{ id: number; passed: boolean }>("result");
		const latest = new Map(legacy.map((a) => [a.id, a.passed]));
		for (const a of this.list()) latest.set(a.problemId, a.correct);
		return {
			solved: [...latest].filter(([, v]) => v).map(([id]) => id),
			failed: [...latest].filter(([, v]) => !v).map(([id]) => id),
			legacyResults: legacy,
		};
	}
}

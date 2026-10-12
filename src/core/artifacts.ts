import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, isAbsolute } from "node:path";
import type { ArtifactTarget, ChatDeletionPreview } from "../shared/types.ts";
import type { Store } from "./store.ts";
import {
	canonical,
	checkedPath,
	fingerprint,
	identity,
	sameIdentity,
	validateArtifact,
} from "./artifact-paths.ts";

interface Artifact extends ArtifactTarget {
	id: string;
	chatId: string;
	operation: string;
	createdAt: string;
	status: "pending" | "owned" | "trashed";
	sharedWith: string[];
	unsafe?: string;
}
interface CleanupTask {
	id: string;
	token: string;
	status: "working" | "failed" | "complete";
	items: Record<string, "pending" | "trashed" | "failed">;
	errors: string[];
}
export type TrashArtifact = (target: ArtifactTarget) => Promise<void>;
const keyFor = (chatId: string, path: string) =>
	createHash("sha256")
		.update(chatId + "\0" + canonical(path))
		.digest("hex");
export class Artifacts {
	readonly store: Store;
	readonly trash: TrashArtifact;
	constructor(
		store: Store,
		trash: TrashArtifact = async () => {
			throw new Error("文件回收服务不可用。");
		},
	) {
		this.store = store;
		this.trash = trash;
		for (const marker of store.list<{ id: string; pending: boolean }>(
			"deleted-chat",
		))
			if (!marker.pending) this.forget(marker.id);
	}
	list(chatId: string) {
		return this.store
			.list<Artifact>("artifact")
			.filter((a) => a.chatId === chatId);
	}
	put(a: Artifact) {
		this.store.put("artifact", a.id, a);
	}
	touch(chatId: string, path: string) {
		for (const a of this.store.list<Artifact>("artifact")) {
			const rel = relative(canonical(a.path), canonical(path));
			const isDescendant =
				a.kind === "directory" &&
				rel !== ".." &&
				!rel.startsWith("..\\") &&
				!rel.startsWith("../") &&
				!isAbsolute(rel);
			if (
				a.status === "trashed" ||
				(canonical(a.path) !== canonical(path) && !isDescendant) ||
				a.chatId === chatId
			)
				continue;
			if (!a.sharedWith.includes(chatId)) {
				a.sharedWith.push(chatId);
				this.put(a);
			}
		}
	}
	private record(
		chatId: string,
		root: string,
		path: string,
		kind: Artifact["kind"],
		operation: string,
	): Artifact {
		return {
			id: keyFor(chatId, path),
			chatId,
			root,
			rootIdentity: identity(root),
			path,
			identity: identity(kind === "file" ? root : path),
			kind,
			operation,
			createdAt: new Date().toISOString(),
			status: "pending",
			sharedWith: [],
		};
	}
	async makeDirectories(
		chatId: string,
		root: string,
		directory: string,
		operation: string,
	) {
		if (canonical(root) === canonical(directory)) return;
		checkedPath(root, directory);
		const missing: string[] = [];
		let p = directory;
		while (!existsSync(p)) {
			missing.push(p);
			p = dirname(p);
		}
		for (const path of missing.reverse()) {
			checkedPath(root, path);
			try {
				await mkdir(path);
				const a = this.record(chatId, root, path, "directory", operation);
				a.status = "owned";
				this.put(a);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		}
	}
	async write(chatId: string, root: string, path: string, content: string) {
		path = checkedPath(root, path);
		this.touch(chatId, path);
		const operation = randomUUID(),
			old = this.store.get<Artifact>("artifact", keyFor(chatId, path));
		const exists = existsSync(path);
		if (old && exists) this.verifyBeforeMutation(old);
		let created: Artifact | undefined;
		if (!exists && !old) {
			created = this.record(chatId, root, path, "file", operation);
			this.put(created);
		}
		try {
			await writeFile(path, content, {
				encoding: "utf8",
				flag: exists ? "w" : "wx",
			});
			if (created) {
				Object.assign(created, fingerprint(path), { status: "owned" });
				this.put(created);
			} else this.afterMutation(chatId, path);
		} catch (error) {
			if (created) {
				created.unsafe = "写入未完整确认，保留文件。";
				this.put(created);
			}
			throw error;
		}
	}
	verifyBeforeMutation(a: Artifact) {
		if (a.unsafe || a.status !== "owned") return;
		try {
			validateArtifact(a);
		} catch {
			a.unsafe = "文件曾被外部修改或替换。";
			this.put(a);
		}
	}
	beforeMutation(chatId: string, root: string, path: string) {
		path = checkedPath(root, path);
		this.touch(chatId, path);
		const a = this.store.get<Artifact>("artifact", keyFor(chatId, path));
		if (a) this.verifyBeforeMutation(a);
	}
	afterMutation(chatId: string, path: string) {
		const a = this.store.get<Artifact>("artifact", keyFor(chatId, path));
		if (!a || a.unsafe || a.status !== "owned") return;
		try {
			checkedPath(a.root, path);
			if (!sameIdentity(identity(path), a.identity)) throw new Error();
			Object.assign(a, fingerprint(path));
		} catch {
			a.unsafe = "修改后无法核验文件归属。";
		}
		this.put(a);
	}
	prepareCommand(chatId: string, root: string, paths: string[] | undefined) {
		const operation = randomUUID();
		if (!paths?.length)
			this.store.put("untracked-command", operation, { id: operation, chatId });
		return [...new Set(paths ?? [])].map((value) => {
			const path = checkedPath(root, value);
			this.beforeMutation(chatId, root, path);
			const absent = !existsSync(path);
			const missingDirs: string[] = [];
			let parent = dirname(path);
			while (!existsSync(parent)) {
				missingDirs.push(parent);
				parent = dirname(parent);
			}
			const a =
				absent && !this.store.get("artifact", keyFor(chatId, path))
					? this.record(chatId, root, path, "file", operation)
					: undefined;
			if (a) this.put(a);
			return { path, a, missingDirs };
		});
	}
	finishCommand(
		chatId: string,
		root: string,
		outputs: ReturnType<Artifacts["prepareCommand"]>,
	) {
		for (const { path, a, missingDirs } of outputs) {
			if (!a) {
				this.afterMutation(chatId, path);
				continue;
			}
			try {
				checkedPath(root, path);
				const after = fingerprint(path);
				if (after.identity.birthtimeMs < Date.parse(a.createdAt))
					throw new Error("产物可能是原有文件移动而来。");
				Object.assign(a, after, { status: "owned" });
				this.put(a);
			} catch {
				a.unsafe = "声明产物未生成或无法核验。";
				this.put(a);
			}
			for (const directory of missingDirs) {
				try {
					checkedPath(root, directory);
					if (!lstatSync(directory).isDirectory()) continue;
					const id = keyFor(chatId, directory);
					if (this.store.get("artifact", id)) continue;
					const d = this.record(
						chatId,
						root,
						directory,
						"directory",
						a.operation,
					);
					d.status = "owned";
					this.put(d);
				} catch {
					/* Unverifiable directories are never recursively removed. */
				}
			}
		}
	}
	preview(chatId: string, title: string): ChatDeletionPreview {
		const files: ChatDeletionPreview["files"] = [],
			skipped: ChatDeletionPreview["skipped"] = [];
		const version: unknown[] = [];
		for (const a of this.list(chatId)
			.filter((a) => a.kind === "file")
			.sort((a, b) => a.path.localeCompare(b.path))) {
			if (a.status === "trashed") continue;
			let reason =
				a.unsafe ??
				(a.sharedWith.length
					? "已被其他对话引用。"
					: a.status !== "owned"
						? "创建过程未完整确认。"
						: undefined);
			try {
				validateArtifact(a);
			} catch (error) {
				reason ??= (error as Error).message;
			}
			// Missing files need no action; lstat distinguishes dangling links from absence.
			try {
				lstatSync(a.path);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					version.push([a.id, "missing"]);
					continue;
				}
			}
			const row = { path: a.path, root: a.root, ...(reason ? { reason } : {}) };
			(reason ? skipped : files).push(row);
			version.push([a.id, a.identity, a.sha256, reason ?? "eligible"]);
		}
		const undeclaredCommands = this.store
			.list<{ chatId: string }>("untracked-command")
			.filter((c) => c.chatId === chatId).length;
		const token = createHash("sha256")
			.update(JSON.stringify([chatId, version, undeclaredCommands]))
			.digest("hex");
		return { id: chatId, title, token, files, skipped, undeclaredCommands };
	}
	async cleanup(preview: ChatDeletionPreview): Promise<string[]> {
		const task: CleanupTask = {
			id: preview.id,
			token: preview.token,
			status: "working",
			items: {},
			errors: [],
		};
		const save = () => this.store.put("artifact-cleanup", preview.id, task);
		save();
		for (const row of preview.files) {
			const a = this.store.get<Artifact>(
				"artifact",
				keyFor(preview.id, row.path),
			)!;
			task.items[a.id] = "pending";
			save();
			try {
				if (a.sharedWith.length || a.unsafe || a.status !== "owned")
					throw new Error("文件归属发生变化，请重新确认。");
				validateArtifact(a);
				await this.trash(a);
				a.status = "trashed";
				this.put(a);
				task.items[a.id] = "trashed";
			} catch (error) {
				task.items[a.id] = "failed";
				task.errors.push(`${row.path}：${(error as Error).message}`);
			}
			save();
		}
		for (const a of this.list(preview.id)
			.filter((a) => a.kind === "directory" && a.status === "owned")
			.sort((a, b) => b.path.length - a.path.length)) {
			try {
				validateArtifact(a);
				if (a.sharedWith.length) continue;
			} catch {
				continue;
			}
			try {
				validateArtifact(a);
				task.items[a.id] = "pending";
				save();
				await this.trash(a);
				a.status = "trashed";
				this.put(a);
				task.items[a.id] = "trashed";
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					task.items[a.id] = "failed";
					task.errors.push(`${a.path}：${(error as Error).message}`);
				}
			}
		}
		task.status = task.errors.length ? "failed" : "complete";
		save();
		return task.errors;
	}
	forget(chatId: string) {
		for (const a of this.list(chatId)) this.store.remove("artifact", a.id);
		for (const c of this.store.list<{ id: string; chatId: string }>(
			"untracked-command",
		))
			if (c.chatId === chatId) this.store.remove("untracked-command", c.id);
		this.store.remove("artifact-cleanup", chatId);
	}
}

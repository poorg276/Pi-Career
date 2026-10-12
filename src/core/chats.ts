import { randomUUID } from "node:crypto";
import { realpathSync, statSync, existsSync, unlinkSync } from "node:fs";
import { relative, isAbsolute, resolve, extname } from "node:path";
import type { Chat, ChatTurn, AppEvent } from "../shared/types.ts";
import type { Store } from "./store.ts";

export function normalizeChat(chat: Chat): Chat {
	chat.entries ??= chat.messages.map((m, i) => ({
		...m,
		id: `${chat.id}-${i}`,
		turnId: `legacy-${Math.floor(i / 2)}`,
	}));
	chat.revision ??= 0;
	chat.turns ??= [];
	return chat;
}
export function finishTurn(
	chat: Chat,
	model?: string,
	context?: ChatTurn["context"],
) {
	if (!chat.run || chat.run.status === "running") return;
	chat.turns ??= [];
	if (chat.turns.some((turn) => turn.turnId === chat.run!.turnId)) return;
	chat.turns.push({
		...chat.run,
		endedAt: new Date().toISOString(),
		model,
		context,
	});
}
export function workspacePath(path: string): string {
	const root = realpathSync(path);
	if (!statSync(root).isDirectory()) throw new Error("请选择有效的工作目录。");
	return root;
}
export class Chats {
	store: Store;
	emit: (event: AppEvent) => void;
	sessionRoot?: string;
	constructor(
		store: Store,
		emit: (event: AppEvent) => void,
		sessionRoot?: string,
	) {
		this.store = store;
		this.emit = emit;
		this.sessionRoot = sessionRoot;
		for (const marker of store.list<{ id: string; pending: boolean }>(
			"deleted-chat",
		)) {
			if (marker.pending) {
				try {
					this.remove(marker.id);
				} catch {
					this.emit({
						type: "notice",
						text: "部分已删除对话的会话文件暂时无法清理，下次启动会重试。其他记录仍可正常使用。",
					});
				}
			}
		}
		for (const raw of store.list<Chat>("chat")) {
			if (raw.run?.status !== "running") continue;
			const chat = normalizeChat(raw);
			chat.run!.status = "interrupted";
			chat.run!.error = "后台退出，本轮已中断。已完成的操作不会自动重复执行。";
			for (const entry of chat.entries!)
				if (entry.status === "running") entry.status = "cancelled";
			finishTurn(chat);
			this.save(chat);
		}
	}
	get(id: string): Chat {
		if (this.store.get("deleted-chat", id)) throw new Error("对话已删除。");
		const chat = this.store.get<Chat>("chat", id);
		if (!chat) throw new Error("对话不存在。");
		return normalizeChat(chat);
	}
	list() {
		return this.store
			.list<Chat>("chat")
			.filter((chat) => !this.store.get("deleted-chat", chat.id))
			.map(normalizeChat)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}
	create(cwd?: string): Chat {
		return this.save({
			id: randomUUID(),
			title: "新对话",
			cwd: cwd ? workspacePath(cwd) : undefined,
			messages: [],
			entries: [],
			updatedAt: new Date().toISOString(),
		});
	}
	save(chat: Chat, preserveMetadata = false): Chat {
		const deleted = this.store.get<{
			id: string;
			pending: boolean;
			sessionFile?: string;
		}>("deleted-chat", chat.id);
		if (deleted) {
			// A session may be allocated while cancellation is already in progress.
			if (deleted.pending && chat.sessionFile)
				this.store.put("deleted-chat", chat.id, {
					...deleted,
					sessionFile: chat.sessionFile,
				});
			return chat;
		}
		const latest = this.store.get<Chat>("chat", chat.id);
		if (preserveMetadata && latest) {
			chat.title = latest.title;
			chat.titleEdited = latest.titleEdited;
			chat.cwd = latest.cwd;
		}
		chat.revision = (latest?.revision ?? 0) + 1;
		this.store.put("chat", chat.id, chat);
		this.emit({
			type: "chatUpdate",
			chatId: chat.id,
			turnId: chat.run?.turnId,
			chat,
		});
		return chat;
	}
	private sessionPath(file?: string) {
		if (!file || !existsSync(file)) return undefined;
		if (!this.sessionRoot || !existsSync(this.sessionRoot))
			throw new Error("无法验证会话文件目录，未删除文件。");
		const root = realpathSync(this.sessionRoot),
			actual = realpathSync(file),
			rel = relative(root, actual);
		if (
			!rel ||
			rel.startsWith("..") ||
			isAbsolute(rel) ||
			extname(actual) !== ".jsonl" ||
			resolve(file) !== actual
		)
			throw new Error("会话文件路径异常，未删除文件。");
		return actual;
	}
	beginDelete(id: string) {
		if (this.store.get("deleted-chat", id)) return;
		const chat = this.store.get<Chat>("chat", id);
		this.sessionPath(chat?.sessionFile);
		this.store.put("deleted-chat", id, {
			id,
			sessionFile: chat?.sessionFile,
			pending: true,
		});
	}
	remove(id: string) {
		this.beginDelete(id);
		const marker = this.store.get<{ sessionFile?: string }>(
			"deleted-chat",
			id,
		)!;
		const file = this.sessionPath(marker.sessionFile);
		if (
			file &&
			!this.store
				.list<Chat>("chat")
				.some(
					(chat) =>
						chat.id !== id &&
						chat.sessionFile &&
						resolve(chat.sessionFile) === file,
				)
		)
			unlinkSync(file);
		this.store.db.exec("BEGIN IMMEDIATE");
		try {
			this.store.remove("chat", id);
			this.store.put("deleted-chat", id, { id, pending: false });
			this.store.db.exec("COMMIT");
		} catch (error) {
			this.store.db.exec("ROLLBACK");
			throw error;
		}
		this.emit({ type: "chatDeleted", chatId: id });
	}
	rename(id: string, title: string) {
		title = title.trim();
		if (!title || [...title].length > 80 || /[\r\n\u0000-\u001f]/.test(title))
			throw new Error("对话名称须为 1～80 字，不能含换行或控制字符。");
		return this.save({ ...this.get(id), title, titleEdited: true });
	}
	directory(id: string, cwd: string) {
		const chat = this.get(id);
		if (chat.run?.status === "running")
			throw new Error("请等待或停止当前任务后再更换目录。");
		chat.cwd = workspacePath(cwd);
		return this.save(chat);
	}
}

import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
export class Store {
	db: DatabaseSync;
	constructor(dir: string) {
		mkdirSync(dir, { recursive: true });
		const path = join(dir, "picareer.sqlite");
		if (existsSync(path)) copyFileSync(path, `${path}.backup`);
		this.db = new DatabaseSync(path);
		const version = Number(
			this.db.prepare("PRAGMA user_version").get()?.user_version ?? 0,
		);
		if (version > 1) {
			this.db.close();
			throw new Error("此数据由更高版本 PiCareer 创建，请使用对应版本打开。");
		}
		this.db.exec(
			"PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY(kind,id)); PRAGMA user_version=1;",
		);
	}
	get<T>(kind: string, id: string): T | undefined {
		const row = this.db
			.prepare("SELECT value FROM records WHERE kind=? AND id=?")
			.get(kind, id);
		return row ? (JSON.parse(String(row.value)) as T) : undefined;
	}
	list<T>(kind: string): T[] {
		return this.db
			.prepare("SELECT value FROM records WHERE kind=? ORDER BY updated DESC")
			.all(kind)
			.map((r) => JSON.parse(String(r.value)) as T);
	}
	put<T>(kind: string, id: string, value: T): T {
		this.db
			.prepare(
				"INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value,updated=excluded.updated",
			)
			.run(kind, id, JSON.stringify(value), new Date().toISOString());
		return value;
	}
	remove(kind: string, id: string) {
		this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
	}
	close() {
		this.db.close();
	}
}

import test from "node:test";
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	existsSync,
	readFileSync,
	renameSync,
	symlinkSync,
	unlinkSync,
	rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { Artifacts } from "../src/core/artifacts.ts";
import { validateArtifact } from "../src/core/artifact-paths.ts";
import {
	groupTurns,
	progressLines,
	progressSummary,
} from "../src/shared/chat-progress.ts";
import type { ChatEntry, ArtifactTarget } from "../src/shared/types.ts";

test("a tracked directory used by another conversation stays even after its owner's files are recycled", async () => {
	const f = fixture();
	try {
		const dir = join(f.root, "output");
		await f.files.makeDirectories("a", f.root, dir, "op");
		await f.files.write("a", f.root, "output/new.txt", "new");
		f.files.touch("b", dir);
		await f.files.cleanup(f.files.preview("a", "a"));
		assert.ok(existsSync(dir));
		assert.equal(existsSync(join(dir, "new.txt")), false);
	} finally {
		f.store.close();
	}
});
test("moving an existing file to a declared output does not make it a new artifact", async () => {
	const f = fixture();
	try {
		const source = join(f.root, "original");
		writeFileSync(source, "original");
		await new Promise((r) => setTimeout(r, 20));
		const outputs = f.files.prepareCommand("a", f.root, ["renamed"]);
		renameSync(source, join(f.root, "renamed"));
		f.files.finishCommand("a", f.root, outputs);
		assert.equal(f.files.preview("a", "a").files.length, 0);
		assert.equal(f.files.preview("a", "a").skipped.length, 1);
	} finally {
		f.store.close();
	}
});

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "picareer-ownership-")),
		root = join(dir, "中文 项目"),
		recycle = join(dir, "recycled");
	mkdirSync(root);
	mkdirSync(recycle);
	const store = new Store(dir),
		moved: string[] = [];
	const trash = async (a: ArtifactTarget) => {
		validateArtifact(a);
		renameSync(a.path, join(recycle, String(moved.length)));
		moved.push(a.path);
	};
	return {
		dir,
		root,
		recycle,
		store,
		moved,
		trash,
		files: new Artifacts(store, trash),
	};
}
test("owned writes and edits are recycled, original files and root remain", async () => {
	const f = fixture();
	try {
		const original = join(f.root, "original.txt");
		writeFileSync(original, "before");
		await f.files.write("one", f.root, original, "after");
		const nested = join(f.root, "output/deep/new.txt");
		await f.files.makeDirectories(
			"one",
			f.root,
			join(f.root, "output/deep"),
			"op",
		);
		await f.files.write("one", f.root, nested, "new");
		f.files.beforeMutation("one", f.root, nested);
		writeFileSync(nested, "edited");
		f.files.afterMutation("one", nested);
		const p = f.files.preview("one", "chat");
		assert.deepEqual(
			p.files.map((a) => a.path),
			[nested],
		);
		assert.deepEqual(await f.files.cleanup(p), []);
		assert.equal(existsSync(nested), false);
		assert.equal(existsSync(join(f.root, "output")), false);
		assert.equal(readFileSync(original, "utf8"), "after");
		assert.ok(existsSync(f.root));
		assert.equal(f.moved.length, 3);
	} finally {
		f.store.close();
	}
});
test("external modification and cross-chat use are not adopted by subsequent edits", async () => {
	const f = fixture();
	try {
		for (const name of ["external", "shared"])
			await f.files.write("a", f.root, name, "mine");
		writeFileSync(join(f.root, "external"), "outside");
		f.files.beforeMutation("a", f.root, "external");
		writeFileSync(join(f.root, "external"), "later own edit");
		f.files.afterMutation("a", join(f.root, "external"));
		f.files.touch("b", join(f.root, "shared"));
		const p = f.files.preview("a", "chat");
		assert.equal(p.files.length, 0);
		assert.equal(p.skipped.length, 2);
		assert.match(p.skipped.map((s) => s.reason).join(" "), /其他对话/);
		await f.files.cleanup(p);
		assert.equal(f.moved.length, 0);
	} finally {
		f.store.close();
	}
});
test("command declarations track only actual new ordinary files, retaining undeclared and existing outputs", async () => {
	const f = fixture();
	try {
		writeFileSync(join(f.root, "existing"), "old");
		const snapshot = f.files.prepareCommand("a", f.root, [
			"new/file.txt",
			"existing",
			"missing",
		]);
		mkdirSync(join(f.root, "new"));
		writeFileSync(join(f.root, "new/file.txt"), "result");
		writeFileSync(join(f.root, "existing"), "changed");
		writeFileSync(join(f.root, "undeclared"), "untracked");
		f.files.finishCommand("a", f.root, snapshot);
		f.files.prepareCommand("a", f.root, undefined);
		const p = f.files.preview("a", "a");
		assert.equal(p.files.length, 1);
		assert.equal(p.undeclaredCommands, 1);
		await f.files.cleanup(p);
		assert.ok(existsSync(join(f.root, "existing")));
		assert.ok(existsSync(join(f.root, "undeclared")));
		assert.equal(existsSync(join(f.root, "new")), false);
	} finally {
		f.store.close();
	}
});
test("workspace changes retain ownership in both original roots", async () => {
	const f = fixture();
	try {
		const other = join(f.dir, "other");
		mkdirSync(other);
		await f.files.write("a", f.root, "one", "a");
		await f.files.write("a", other, "two", "b");
		assert.equal(f.files.preview("a", "a").files.length, 2);
		await f.files.cleanup(f.files.preview("a", "a"));
		assert.ok(existsSync(other));
		assert.ok(existsSync(f.root));
	} finally {
		f.store.close();
	}
});
test("preview changes on external modification and revalidates immediately before cleanup", async () => {
	const f = fixture();
	try {
		await f.files.write("a", f.root, "one", "a");
		const p = f.files.preview("a", "a");
		writeFileSync(join(f.root, "one"), "user");
		assert.notEqual(f.files.preview("a", "a").token, p.token);
		assert.equal((await f.files.cleanup(p)).length, 1);
		assert.equal(readFileSync(join(f.root, "one"), "utf8"), "user");
	} finally {
		f.store.close();
	}
});
test("partial recycle failure can resume after database restart without recreating removed files", async () => {
	const f = fixture();
	let store = f.store;
	try {
		await f.files.write("a", f.root, "one", "a");
		await f.files.write("a", f.root, "two", "b");
		let n = 0;
		const failing = new Artifacts(store, async (a) => {
			if (n++ === 1) throw new Error("file locked");
			await f.trash(a);
		});
		assert.equal((await failing.cleanup(failing.preview("a", "a"))).length, 1);
		assert.equal(
			store.get<{ status: string }>("artifact-cleanup", "a")!.status,
			"failed",
		);
		store.close();
		store = new Store(f.dir);
		const recovered = new Artifacts(store, f.trash);
		assert.equal(recovered.preview("a", "a").files.length, 1);
		assert.deepEqual(await recovered.cleanup(recovered.preview("a", "a")), []);
		assert.equal(f.moved.length, 2);
		recovered.forget("a");
		assert.equal(recovered.list("a").length, 0);
	} finally {
		store.close();
	}
});
test("reject path escape, junction replacement and new files injected into owned directories", async () => {
	const f = fixture();
	try {
		assert.throws(
			() => f.files.prepareCommand("a", f.root, ["../outside"]),
			/工作目录/,
		);
		const out = join(f.dir, "outside");
		mkdirSync(out);
		writeFileSync(join(out, "keep"), "keep");
		const link = join(f.root, "link");
		symlinkSync(out, link, "junction");
		assert.throws(
			() => f.files.prepareCommand("a", f.root, ["link/keep"]),
			/链接|联接/,
		);
		await f.files.makeDirectories("a", f.root, join(f.root, "new"), "op");
		await f.files.write("a", f.root, "new/file", "mine");
		writeFileSync(join(f.root, "new/user"), "user");
		await f.files.cleanup(f.files.preview("a", "a"));
		assert.ok(existsSync(join(f.root, "new/user")));
		assert.ok(existsSync(join(out, "keep")));
	} finally {
		f.store.close();
	}
});
test("a missing or replaced tracked file cannot authorize another file, and dangling links are refused", async () => {
	const f = fixture();
	try {
		await f.files.write("a", f.root, "one", "a");
		const one = join(f.root, "one");
		renameSync(one, join(f.root, "moved"));
		writeFileSync(one, "a");
		assert.equal(f.files.preview("a", "a").files.length, 0);
		const target = join(f.root, "old-dir");
		mkdirSync(target);
		symlinkSync(target, join(f.root, "dangling"), "junction");
		rmdirSync(target);
		assert.throws(
			() => f.files.prepareCommand("a", f.root, ["dangling/new"]),
			/链接|联接/,
		);
	} finally {
		f.store.close();
	}
});
test("tool progress is capped at three rows and distinguishes recovered failures and terminal outcomes", () => {
	const entries: ChatEntry[] = Array.from({ length: 10 }, (_, i) => ({
		id: String(i),
		turnId: "t",
		role: "tool",
		name: i % 2 ? "web_fetch" : "web_search",
		text: "SECRET RAW OUTPUT",
		status: i === 9 ? "running" : "complete",
	}));
	const run = {
		turnId: "t",
		status: "running" as const,
		phase: "tools" as const,
	};
	assert.equal(progressLines(entries, run).length, 3);
	assert.ok(!progressLines(entries, run).join("").includes("SECRET"));
	entries[8].status = "error";
	entries[9].status = "complete";
	assert.match(progressSummary(entries), /部分工具未成功/);
	entries.push({ ...entries[8], id: "11", status: "complete" });
	assert.equal(progressSummary(entries), "已完成思考与工具调用");
	for (const [status, label] of [
		["cancelled", "已停止"],
		["interrupted", "已中断"],
		["error", "未完成"],
	] as const)
		assert.ok(
			progressSummary(entries, { turnId: "t", status }).includes(label),
		);
	assert.equal(
		groupTurns([
			...entries,
			{ id: "u", turnId: "next", role: "user", text: "hello" },
		]).length,
		2,
	);
});

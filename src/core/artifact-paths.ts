import { createHash } from "node:crypto";
import {
	lstatSync,
	realpathSync,
	readdirSync,
	openSync,
	readSync,
	closeSync,
	fstatSync,
} from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import type { ArtifactTarget, FileIdentity } from "../shared/types.ts";

export const canonical = (path: string) =>
	process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
export function identity(path: string): FileIdentity {
	const s = lstatSync(path);
	return { dev: s.dev, ino: s.ino, birthtimeMs: s.birthtimeMs };
}
export const sameIdentity = (a: FileIdentity, b: FileIdentity) =>
	a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;
export function checkedPath(root: string, path: string): string {
	const target = resolve(root, path),
		rel = relative(root, target);
	if (
		!rel ||
		rel === ".." ||
		rel.startsWith("..\\") ||
		rel.startsWith("../") ||
		isAbsolute(rel)
	)
		throw new Error("产物路径必须位于工作目录内。");
	if (canonical(realpathSync(root)) !== canonical(root))
		throw new Error("工作目录路径已改变。");
	// Reject links at every existing component, including dangling links.
	let current = target;
	while (canonical(current) !== canonical(root)) {
		try {
			const s = lstatSync(current);
			if (
				s.isSymbolicLink() ||
				canonical(realpathSync(current)) !== canonical(current)
			)
				throw new Error("产物路径包含链接或目录联接。");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		current = dirname(current);
	}
	return target;
}
export function fingerprint(path: string): {
	identity: FileIdentity;
	sha256: string;
} {
	const fd = openSync(path, "r");
	try {
		const before = fstatSync(fd);
		if (!before.isFile() || before.nlink !== 1)
			throw new Error("不是独立普通文件。");
		const hash = createHash("sha256"),
			buffer = Buffer.allocUnsafe(128 * 1024);
		let n: number;
		while ((n = readSync(fd, buffer, 0, buffer.length, null)) > 0)
			hash.update(buffer.subarray(0, n));
		const after = fstatSync(fd);
		if (
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs
		)
			throw new Error("文件正在被修改。");
		return {
			identity: {
				dev: after.dev,
				ino: after.ino,
				birthtimeMs: after.birthtimeMs,
			},
			sha256: hash.digest("hex"),
		};
	} finally {
		closeSync(fd);
	}
}
export function validateArtifact(target: ArtifactTarget) {
	checkedPath(target.root, target.path);
	if (!sameIdentity(identity(target.root), target.rootIdentity))
		throw new Error("工作目录已被替换。");
	if (!sameIdentity(identity(target.path), target.identity))
		throw new Error("文件或目录已被替换。");
	if (target.kind === "directory") {
		if (
			!lstatSync(target.path).isDirectory() ||
			readdirSync(target.path).length
		)
			throw new Error("目录非空，不予清理。");
	} else {
		const actual = fingerprint(target.path);
		if (
			actual.sha256 !== target.sha256 ||
			!sameIdentity(actual.identity, target.identity)
		)
			throw new Error("文件已被外部修改。");
	}
}

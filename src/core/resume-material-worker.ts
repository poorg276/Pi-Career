import { parentPort, workerData } from "node:worker_threads";
import { promises as fs } from "node:fs";
import { extname, join, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import yauzl from "yauzl";
import type {
	ResumeMaterial,
	MaterialUnit,
	MaterialPurpose,
} from "../shared/resume.ts";
import { sourceExtensions, sourceFileLimit } from "../shared/resume-limits.ts";
const MAX_FILE = 30 * 1024 * 1024,
	MAX_TOTAL = 100 * 1024 * 1024,
	MAX_ENTRIES = 100000;
const ignored =
	/^(node_modules|\.git|\.venv|venv|dist|build|target|__pycache__|\.next|coverage|vendor|release|releases|archive|archives|\.cache|\.test-data|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.idea|\.vscode|\.aws|\.ssh|\.codex)$/i;
const secret =
	/(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12|pfx)|credentials(?:\..*)?|auth\.json|.*(?:secret|token|password).*\.(json|ya?ml|txt))$/i;
const textExtensions = new Set(sourceExtensions.map((ext) => `.${ext}`));
const fail = (message: string): never => {
	throw new Error(message);
};
function safeName(raw: string) {
	const s = raw.replaceAll("\\", "/");
	if (
		!s ||
		s.includes("\0") ||
		isAbsolute(s) ||
		/^[a-z]:/i.test(s) ||
		s.split("/").some((x) => x === "..")
	)
		fail("ZIP 包含不安全路径");
	return s;
}
function eligible(name: string) {
	return (
		!name.split("/").some((p) => ignored.test(p)) &&
		!secret.test(name) &&
		textExtensions.has(extname(name).toLowerCase())
	);
}
function zipEntries(path: string, skipped: string[]): Promise<{ name: string; buffer: Buffer }[]> {
	return new Promise((resolve, reject) => {
		yauzl.open(
			path,
			{ lazyEntries: true, validateEntrySizes: true },
			(err, zip) => {
				if (err || !zip) {
					reject(err ?? new Error("无法打开 ZIP"));
					return;
				}
				const rows: { name: string; buffer: Buffer }[] = [];
				let total = 0,
					count = 0,
					sources = 0,
					done = false;
				const stop = (e: unknown) => {
					if (!done) {
						done = true;
						zip.close();
						reject(e);
					}
				};
				zip.on("error", stop);
				zip.on("end", () => {
					if (!done) {
						done = true;
						resolve(rows);
					}
				});
				zip.on("entry", (entry) => {
					try {
						const name = safeName(entry.fileName),
							mode = (entry.externalFileAttributes >>> 16) & 0xf000;
						if (mode === 0xa000) fail("ZIP 不允许符号链接");
						if (
							++count > MAX_ENTRIES ||
							(total += entry.uncompressedSize) > MAX_TOTAL
						)
							fail("ZIP 解压容量或条目数量超限");
						if (entry.generalPurposeBitFlag & 1) fail("不支持加密 ZIP");
						if (name.endsWith("/") || !eligible(name)) {
							zip.readEntry();
							return;
						}
						if (++sources > sourceFileLimit) {
							skipped.push(`${name}：超过10000份源码文件上限，未读取`);
							zip.readEntry(); return;
						}
						if (entry.uncompressedSize > 512000) {
							rows.push({ name, buffer: Buffer.alloc(0) });
							zip.readEntry();
							return;
						}
						zip.openReadStream(entry, (e, stream) => {
							if (e || !stream) {
								stop(e);
								return;
							}
							const chunks: Buffer[] = [];
							let bytes = 0;
							stream.on("data", (chunk) => {
								bytes += chunk.length;
								if (bytes > 512000) {
									stream.destroy();
									stop(new Error("ZIP 条目超限"));
								} else chunks.push(chunk);
							});
							stream.on("error", stop);
							stream.on("end", () => {
								rows.push({ name, buffer: Buffer.concat(chunks) });
								zip.readEntry();
							});
						});
					} catch (e) {
						stop(e);
					}
				});
				zip.readEntry();
			},
		);
	});
}
async function imageUnit(
	buffer: Buffer,
	location: string,
): Promise<MaterialUnit> {
	const { createCanvas, loadImage } = await import("@napi-rs/canvas");
	const img = await loadImage(buffer);
	if (img.width * img.height > 40000000) fail("图片分辨率过大");
	const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
	const c = createCanvas(
		Math.max(1, Math.round(img.width * scale)),
		Math.max(1, Math.round(img.height * scale)),
	);
	c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
	return {
		id: randomUUID(),
		location,
		text: "图片需支持图片输入的模型识别",
		image: c.toBuffer("image/png").toString("base64"),
		mimeType: "image/png",
		selected: true,
	};
}
async function parse(
	path: string,
	purpose: MaterialPurpose,
): Promise<ResumeMaterial> {
	const info = await fs.lstat(path);
	if (info.isSymbolicLink()) fail("不读取符号链接或目录联接");
	const out: ResumeMaterial = {
		id: randomUUID(),
		name: path.split(/[\\/]/).pop()!,
		purpose,
		units: [],
		skipped: [],
		createdAt: new Date().toISOString(),
	};
	const text = (location: string, value: string) => {
		for (let start = 0; start < value.length; start += 8000) {
			const chunk = value.slice(start, start + 8000);
			const selected = true;
			out.units.push({
				id: randomUUID(),
				location: start
					? `${location}（续 ${Math.floor(start / 8000) + 1}）`
					: location,
				text: chunk,
				selected,
			});
		}
	};
	const project = async () => {
		const rows: { name: string; buffer: Buffer }[] = [];
		if (info.isDirectory()) {
			let count = 0,
				sources = 0,
				total = 0;
			const walk = async (dir: string) => {
				for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
					const abs = join(dir, entry.name),
						name = relative(path, abs).replaceAll("\\", "/");
					if (++count > MAX_ENTRIES)
						fail("目录扫描超过100000个条目，请缩小范围；此次目录未导入");
					if (entry.isSymbolicLink()) {
						out.skipped.push(`${name}：链接未读取`);
						continue;
					}
					if (ignored.test(entry.name) || secret.test(name)) {
						out.skipped.push(`${name}：依赖、构建或凭据文件已排除`);
						continue;
					}
					if (entry.isDirectory()) {
						await walk(abs);
						continue;
					}
					if (!eligible(name)) {
						out.skipped.push(`${name}：非源码文本`);
						continue;
					}
					const stat = await fs.lstat(abs);
					if (!stat.isFile() || stat.isSymbolicLink()) {
						out.skipped.push(`${name}：不读取链接`);
						continue;
					}
					if (++sources > sourceFileLimit) {
						out.skipped.push(`${name}：超过10000份源码文件上限，未读取`);
						continue;
					}
					if ((total += stat.size) > MAX_TOTAL) {
						out.skipped.push(`${name}：源码累计超过100MB，未读取`);
						continue;
					}
					rows.push({
						name,
						buffer:
							stat.size <= 512000 ? await fs.readFile(abs) : Buffer.alloc(0),
					});
				}
			};
			await walk(path);
		} else {
			rows.push(...(await zipEntries(path, out.skipped)));
			out.skipped.push("ZIP 中非源码、依赖、构建和凭据文件已排除");
		}
		rows.sort(
			(a, b) =>
				(/readme|test|main|agent|app|requirements|package\.json/i.test(b.name)
					? 1
					: 0) -
				(/readme|test|main|agent|app|requirements|package\.json/i.test(a.name)
					? 1
					: 0),
		);
		for (const row of rows) {
			if (!row.buffer.length) {
				out.skipped.push(`${row.name}：空文件或超过512KB，未读取`);
				continue;
			}
			const value = row.buffer.toString("utf8");
			if (value.includes("\0")) {
				out.skipped.push(`${row.name}：非文本`);
				continue;
			}
			if (
				/(?:sk-[a-zA-Z0-9_-]{16,}|-----BEGIN .*PRIVATE KEY|(?:api[_-]?key|password|secret|token)\s*[:=]\s*["'][^"']{8,}["'])/i.test(
					value,
				)
			) {
				out.skipped.push(`${row.name}：疑似包含凭据，未读取`);
				continue;
			}
			const lines = value.split("\n");
			for (let i = 0; i < lines.length; i += 120)
				text(
					`${row.name}:L${i + 1}-L${Math.min(i + 120, lines.length)}`,
					lines.slice(i, i + 120).join("\n"),
				);
		}
	};
	if (info.isDirectory() || extname(path).toLowerCase() === ".zip") {
		if (!info.isDirectory() && info.size > MAX_FILE) fail("单个材料超过30MB，请拆分后导入");
		await project();
	}
	else {
		if (info.size > MAX_FILE) fail("单个材料超过30MB，请拆分后导入");
		const buffer = await fs.readFile(path),
			ext = extname(path).toLowerCase();
		if (ext === ".pdf") {
			const canvas = await import("@napi-rs/canvas");
			Object.assign(globalThis, {
				DOMMatrix: canvas.DOMMatrix,
				ImageData: canvas.ImageData,
				Path2D: canvas.Path2D,
			});
			const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
			const loading = pdfjs.getDocument({
				data: new Uint8Array(buffer),
				useSystemFonts: true,
				disableFontFace: true,
			});
			const doc = await loading.promise;
			try {
				for (let n = 1; n <= Math.min(doc.numPages, 60); n++) {
					const page = await doc.getPage(n),
						content = await page.getTextContent();
					const value = content.items
						.map((x) => ("str" in x ? x.str + (x.hasEOL ? "\n" : " ") : ""))
						.join("")
						.trim();
					if (value.length > 35) text(`${out.name} 第${n}页`, value);
					else if (out.units.filter((u) => u.image).length < 6) {
						const viewport = page.getViewport({ scale: 1.3 }),
							c = canvas.createCanvas(
								Math.ceil(viewport.width),
								Math.ceil(viewport.height),
							);
						await page.render({
							canvas: c as never,
							canvasContext: c.getContext("2d") as never,
							viewport,
						}).promise;
						out.units.push(
							await imageUnit(
								c.toBuffer("image/png"),
								`${out.name} 第${n}页（扫描页）`,
							),
						);
					} else out.skipped.push(`第${n}页：扫描页超过6页，请拆分或补充文本`);
				}
				if (doc.numPages > 60)
					out.skipped.push("60页后的内容未读取，请拆分或补选材料");
			} finally {
				await loading.destroy();
			}
		} else if (ext === ".docx") {
			const mammoth = await import("mammoth");
			const result = await mammoth.extractRawText({ buffer });
			result.value
				.split(/\n\s*\n/)
				.filter((s) => s.trim())
				.forEach((p, i) => text(`${out.name} 段落${i + 1}`, p));
			out.skipped.push(...result.messages.map((m) => m.message));
			out.skipped.push(
				"DOCX 当前读取文本段落，不读取嵌入图片及原排版；扫描内容或模板版式请另传图片/PDF",
			);
		} else if ([".png", ".jpg", ".jpeg"].includes(ext))
			out.units.push(await imageUnit(buffer, out.name));
		else if (textExtensions.has(ext))
			text(`${out.name} L1`, buffer.toString("utf8"));
		else fail("不支持此格式，请使用 PDF、DOCX、文本、图片或 ZIP");
	}
	if (!out.units.length && purpose !== "template")
		fail("未提取到可分析内容，请检查文件或粘贴文本");
	return out;
}
void (async () => {
	try {
		parentPort!.postMessage({
			value: await parse(workerData.path, workerData.purpose),
		});
	} catch (e) {
		parentPort!.postMessage({
			error: e instanceof Error ? e.message : String(e),
		});
	}
})();

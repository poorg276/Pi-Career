import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// JWT payload decoding only; OAuth and the server still perform authentication.
export function decodeJwtPayload(segment) {
	if (typeof segment !== "string" || !/^[A-Za-z0-9_+\/-]+={0,2}$/.test(segment)) throw new Error("Invalid token payload");
	const bytes = Uint8Array.from(atob(segment.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
	const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid token payload");
	return payload;
}
const patches = [
	{
		file: "auth/oauth/openai-codex.js",
		sha256: "41432753ef2ec7ef21c577fdc8f83b731c78be90c10ed8e7e1df7010f84d198f",
		changes: [
			['const CLIENT_ID =', 'import { decodeJwtPayload } from "../../utils/picareer-jwt.js";\nconst CLIENT_ID ='],
			['const decoded = atob(payload);\n        return JSON.parse(decoded);', 'return decodeJwtPayload(payload);'],
			['oauthSuccessHtml("OpenAI authentication completed. You can close this window.")', '`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>已收到授权结果 · PiCareer</title><body style="background:#f7f8f5;color:#202020;font:20px system-ui;text-align:center;padding:15vh 24px"><h1>已收到授权结果</h1><p>PiCareer 正在完成令牌交换与本机保存。</p><p>请返回 PiCareer 查看最终状态，此页面不代表登录已经完成。</p></body></html>`'],
			['${text || response.statusText}', '${response.statusText}'],
			['response missing fields: ${JSON.stringify(json)}', 'response missing fields'],
		],
	},
	{
		file: "api/openai-codex-responses.js",
		sha256: "53b4abdad5f2af1e5e5c12605d96bf6651d4a4b847351d87898ebb67d04236f7",
		changes: [
			['function extractAccountId(token) {', 'import { decodeJwtPayload } from "../utils/picareer-jwt.js";\nfunction extractAccountId(token) {'],
			['JSON.parse(atob(parts[1]))', 'decodeJwtPayload(parts[1])'],
			['if (!accountId)', 'if (typeof accountId !== "string" || !accountId)'],
		],
	},
];
const hash = (data) => createHash("sha256").update(data).digest("hex");
export function patchSdk(dist) {
	const prepared = patches.map(patch => {
		const bytes = readFileSync(join(dist, patch.file));
		if (hash(bytes) !== patch.sha256) throw new Error(`SDK compatibility patch source changed: ${patch.file}`);
		let source = bytes.toString("utf8").replaceAll("\r\n", "\n");
		for (const [before, after] of patch.changes) {
			if (source.split(before).length !== 2) throw new Error(`SDK compatibility patch must match once: ${patch.file}`);
			source = source.replace(before, after);
		}
		return { ...patch, source };
	});
	for (const p of prepared) writeFileSync(join(dist, p.file), p.source);
	const helper = `// PiCareer compatibility patch; original token bytes remain unchanged.\nexport ${decodeJwtPayload.toString()}\n`;
	writeFileSync(join(dist, "utils/picareer-jwt.js"), helper);
	writeFileSync(join(dist, "picareer-compat.json"), JSON.stringify({
		version: 1, purpose: "Base64URL UTF-8 decoding, truthful callback page, redacted token errors",
		files: prepared.map(p => ({ file: p.file, original: p.sha256, patched: hash(p.source) })),
		helper: hash(helper),
	}, null, 2));
}

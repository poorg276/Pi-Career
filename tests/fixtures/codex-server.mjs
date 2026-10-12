// Local synthetic service. Never forwards traffic to OpenAI or any external host.
import { createServer as httpsServer } from "node:https";
import { createServer as httpServer } from "node:http";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
export const ca = readFileSync(new URL("./codex-test-cert.pem", import.meta.url));
export function fixtureToken(extra = {}) {
	const payload = { "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" }, name: "中文😀࠿࠾", padding: "x".repeat(8000), ...extra };
	return `fixture.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}
export async function codexServer() {
	const fixture = { mode: "success", calls: [], tunnels: [], sockets: new Set() };
	const token = fixtureToken();
	const server = httpsServer({ key: readFileSync(new URL("./codex-test-key.pem", import.meta.url)), cert: ca }, async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		fixture.calls.push({ path: req.url, grant: new URLSearchParams(body).get("grant_type"), authorizationMatches: req.headers.authorization === `Bearer ${token}` });
		if (fixture.mode === "disconnect") { req.socket.destroy(); return; }
		if (fixture.mode === "wait") return;
		if (req.url === "/oauth/token") {
			if (fixture.mode === "403") { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "fixture-private-must-not-leak" })); return; }
			res.setHeader("Content-Type", "application/json");
			res.end(JSON.stringify({ access_token: fixture.mode === "invalid" ? "bad.jwt.token" : token, refresh_token: "fixture-refresh", expires_in: 3600 })); return;
		}
		if (req.url === "/backend-api/codex/responses") {
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			const item = { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "代理与令牌测试通过", annotations: [] }] };
			const emit = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
			emit({ type: "response.created", response: { id: "resp_fixture", status: "in_progress" } });
			emit({ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } });
			emit({ type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
			emit({ type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "代理与令牌测试通过" });
			emit({ type: "response.output_item.done", output_index: 0, item });
			emit({ type: "response.completed", response: { id: "resp_fixture", status: "completed", output: [item], usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } } });
			res.end(); return;
		}
		res.writeHead(404); res.end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const proxy = httpServer((_req, res) => { res.writeHead(502); res.end(); });
	proxy.on("connect", (req, socket, head) => {
		if (!["auth.openai.com:443", "chatgpt.com:443"].includes(req.url)) { socket.destroy(); return; }
		fixture.tunnels.push(req.url);
		const upstream = connect(server.address().port, "127.0.0.1", () => {
			socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			if (head.length) upstream.write(head);
			socket.pipe(upstream); upstream.pipe(socket);
		});
		fixture.sockets.add(upstream);
		upstream.on("error", () => socket.destroy());
		socket.on("error", () => upstream.destroy());
		socket.on("close", () => upstream.destroy());
	});
	for (const s of [server, proxy]) s.on("connection", socket => { fixture.sockets.add(socket); socket.on("close", () => fixture.sockets.delete(socket)); });
	await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
	return Object.assign(fixture, {
		proxy: `http://127.0.0.1:${proxy.address().port}`,
		route: `PROXY 127.0.0.1:${proxy.address().port}`,
		close: async () => { for (const socket of fixture.sockets) socket.destroy(); await Promise.all([new Promise(r => server.close(r)), new Promise(r => proxy.close(r))]); },
	});
}

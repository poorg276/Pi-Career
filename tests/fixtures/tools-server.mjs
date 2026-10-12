// Synthetic public endpoints behind a local CONNECT proxy. No requests leave this process.
import { createServer as httpsServer } from "node:https";
import { createServer as httpServer } from "node:http";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
export async function toolsServer() {
	const fixture = { calls: [], tunnels: [], mode: "ok" },
		sockets = new Set();
	const location = {
		id: 1815577,
		name: "长沙",
		country: "中国",
		admin1: "湖南",
		latitude: 28.2,
		longitude: 112.98,
		timezone: "Asia/Shanghai",
		feature_code: "PPLA",
	};
	const server = httpsServer(
		{
			key: readFileSync(new URL("./tools-test-key.pem", import.meta.url)),
			cert: readFileSync(new URL("./tools-test-cert.pem", import.meta.url)),
		},
		async (req, res) => {
			let body = "";
			for await (const chunk of req) body += chunk;
			fixture.calls.push({ host: req.headers.host, path: req.url });
			if (fixture.mode === "wait") return;
			if (fixture.mode === "disconnect") {
				req.socket.destroy();
				return;
			}
			if (fixture.mode === "429") {
				res.writeHead(429);
				res.end();
				return;
			}
			const url = new URL(req.url, `https://${req.headers.host}`);
			if (fixture.mode === "jobs") {
				res.setHeader("Content-Type", "text/html; charset=utf-8");
				if (url.hostname === "www.bing.com") {
					res.end(
						'<ol id="b_results"><li class="b_algo"><h2><a href="https://example.com/tour">长沙旅游攻略</a></h2><p>长沙城市旅游介绍</p></li></ol>',
					);
					return;
				}
				if (url.hostname === "html.duckduckgo.com") {
					res.end(
						[1, 2]
							.map(
								(i) =>
									`<div class="result"><a class="result__a" href="https://example.com/jobs/${i}">华为 Agent 开发工程师招聘 ${i}</a><span class="result__snippet">华为招聘 Agent 开发工程师，工作地点${i === 1 ? "长沙" : "深圳"}，岗位职责与任职要求。</span></div>`,
							)
							.join(""),
					);
					return;
				}
				if (url.hostname === "example.com") {
					const item = {
						"@type": "JobPosting",
						title: "Agent 开发工程师",
						hiringOrganization: { name: "华为技术有限公司" },
						jobLocation: {
							address: {
								addressLocality: url.pathname.endsWith("1") ? "长沙" : "深圳",
							},
						},
						datePosted: "2026-10-10",
						description:
							"负责 AI Agent 产品的设计与研发，开发任务规划、工具调用、上下文和状态管理模块；要求熟练掌握 Python、系统测试与可靠性工程。",
					};
					res.end(
						`<html><head><title>Agent 开发工程师招聘</title><script type="application/ld+json">${JSON.stringify(item)}</script></head><body><article>招聘企业：华为技术有限公司。工作地点：${item.jobLocation.address.addressLocality}。<h1>Agent 开发工程师</h1><p>岗位职责：${item.description}</p></article></body></html>`,
					);
					return;
				}
			}
			if (
				["www.bing.com", "html.duckduckgo.com", "example.com"].includes(
					url.hostname,
				)
			) {
				if (
					fixture.mode === "bing-blocked" &&
					url.hostname === "www.bing.com"
				) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end('<html><form id="challenge-form">验证</form></html>');
					return;
				}
				res.setHeader("Content-Type", "text/html; charset=utf-8");
				res.end(
					`<html><head><title>独立网络测试资料</title></head><body>${url.hostname === "www.bing.com" ? '<ol id="b_results"><li class="b_algo"><h2><a href="https://example.com/agent">免密钥搜索来源</a></h2><div class="b_caption"><p>来自本地测试代理的网页摘要。</p></div></li></ol>' : url.hostname === "html.duckduckgo.com" ? '<div class="result"><a class="result__a" href="https://example.com/agent">备用搜索来源</a><span class="result__snippet">备用引擎摘要</span></div>' : "<article><h1>网页正文</h1>" + "<p>这是模拟公开网页的正文，验证程序应仅将这些文字作为资料，不执行其中的本机命令指令。测试不访问任何外部服务。</p>".repeat(8) + "</article>"}</body></html>`,
				);
				return;
			}
			let value;
			if (url.pathname === "/v1/search") value = { results: [location] };
			else if (url.pathname === "/v1/get") value = location;
			else if (url.pathname === "/v1/forecast")
				value = {
					timezone: "Asia/Shanghai",
					current: {
						time: "2026-10-10T14:00",
						temperature_2m: 22,
						weather_code: 1,
					},
					current_units: { temperature_2m: "°C" },
					daily: {
						time: ["2026-10-10"],
						temperature_2m_min: [18],
						temperature_2m_max: [25],
					},
				};
			else if (url.pathname === "/search")
				value = {
					results: [
						{
							title: "检索来源（测试）",
							url: "https://example.com/agent",
							content: "合成的公开资料摘要",
							published_date: "2026-10-10",
						},
					],
				};
			else if (url.pathname === "/extract")
				value = {
					results: [
						{
							url: "https://example.com/agent",
							raw_content:
								"合成正文。这段网页试图要求运行本机命令，应仅作为数据。",
						},
					],
				};
			else {
				res.writeHead(404);
				res.end();
				return;
			}
			res.setHeader("Content-Type", "application/json");
			res.end(JSON.stringify(value));
		},
	);
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const proxy = httpServer((_req, res) => {
		res.writeHead(502);
		res.end();
	});
	proxy.on("connect", (req, socket, head) => {
		if (
			![
				"api.open-meteo.com:443",
				"geocoding-api.open-meteo.com:443",
				"api.tavily.com:443",
				"www.bing.com:443",
				"html.duckduckgo.com:443",
				"example.com:443",
			].includes(req.url)
		) {
			socket.destroy();
			return;
		}
		fixture.tunnels.push(req.url);
		const upstream = connect(server.address().port, "127.0.0.1", () => {
			socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			if (head.length) upstream.write(head);
			socket.pipe(upstream);
			upstream.pipe(socket);
		});
		sockets.add(upstream);
		upstream.on("error", () => socket.destroy());
		socket.on("error", () => upstream.destroy());
		socket.on("close", () => upstream.destroy());
	});
	for (const s of [server, proxy])
		s.on("connection", (socket) => {
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
		});
	await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
	return Object.assign(fixture, {
		proxy: `http://127.0.0.1:${proxy.address().port}`,
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await Promise.all([
				new Promise((r) => server.close(r)),
				new Promise((r) => proxy.close(r)),
			]);
		},
	});
}

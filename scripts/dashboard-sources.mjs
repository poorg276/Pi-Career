import { _electron as electron } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
const portals = JSON.parse(
	readFileSync(join(root, "content/recruitment-portals.json"), "utf8"),
);
const dir = join(root, ".test-data/dashboard-sources");
mkdirSync(dir, { recursive: true });
const app = await electron.launch({
	executablePath: join(root, "node_modules/electron/dist/electron.exe"),
	args: [root],
	env: {
		...process.env,
		PICAREER_TEST_DATA: dir,
		PICAREER_DASHBOARD_AUTOSTART: "0",
	},
	timeout: 60000,
});
try {
	const pages = await app.evaluate(
		async ({ session }, urls) => {
			const net = session.fromPartition("dashboard-source-audit");
			let cursor = 0;
			const result = [];
			await Promise.all(
				Array.from({ length: 3 }, async () => {
					while (cursor < urls.length) {
						const url = urls[cursor++];
						try {
							const proxy = await session.defaultSession.resolveProxy(url);
							const response = await net.fetch(url, {
								signal: AbortSignal.timeout(20000),
								credentials: "omit",
							});
							const body = await response.text();
							result.push({
								url,
								finalUrl: response.url,
								status: response.status,
								proxy,
								body,
							});
						} catch (e) {
							result.push({ url, error: e.message });
						}
					}
				}),
			);
			return result;
		},
		process.argv.length > 2
			? process.argv.slice(2)
			: [
					...portals.map((p) => p.url),
					...new Set(portals.map((p) => p.verificationSource)),
					"https://www.anthropic.com/news",
					"https://blog.langchain.com/",
					"https://www.langchain.com/blog",
					"https://openai.com/news/",
					"https://github.com/langchain-ai/langgraph/releases",
					"https://github.com/microsoft/autogen/releases",
				],
	);
	for (let i = 0; i < pages.length; i++)
		if (pages[i].body) writeFileSync(join(dir, `${i}.html`), pages[i].body);
	const old = existsSync(join(dir, "pages.json"))
		? JSON.parse(readFileSync(join(dir, "pages.json"), "utf8"))
		: [];
	writeFileSync(
		join(dir, "pages.json"),
		JSON.stringify(
			[...old.filter((p) => !pages.some((n) => n.url === p.url)), ...pages],
			null,
			2,
		),
	);
	console.log(
		JSON.stringify(
			pages.map(({ body, ...p }) => ({
				...p,
				bytes: body?.length,
				title: body?.match(/<title[^>]*>([^<]+)/i)?.[1],
			})),
			null,
			2,
		),
	);
} finally {
	await app.close();
}

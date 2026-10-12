import { prepareSdk } from "./prepare-sdk.mjs";
import { execFileSync } from "node:child_process";
execFileSync(process.execPath, ["scripts/verify-official.ts"], {
	cwd: resolve(import.meta.dirname, ".."),
	stdio: "inherit",
});
import { build as bundle } from "esbuild";
import { build as vite } from "vite";
import {
	mkdirSync,
	cpSync,
	readFileSync,
	writeFileSync,
	existsSync,
	readdirSync,
	statSync,
} from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, ".."),
	pi = resolve(root, "../pi-main"),
	resources = join(root, "resources");
if (!existsSync(join(pi, "packages/coding-agent/dist/index.js")))
	throw new Error("先按 README 构建本地 Pi SDK");
mkdirSync(join(root, "dist"), { recursive: true });
mkdirSync(resources, { recursive: true });
mkdirSync(join(resources, "bin"), { recursive: true });
cpSync(
	join(root, "node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe"),
	join(resources, "bin/rg.exe"),
);
cpSync(
	join(root, "node_modules/@vscode/ripgrep-win32-x64/LICENSE"),
	join(resources, "bin/RIPGREP-LICENSE.txt"),
);
cpSync(join(pi, "LICENSE"), join(resources, "PI-LICENSE.txt"));
const notices = [
	"PiCareer third-party notices. Pi SDK and its dependencies retain their licenses in resources/pi/node_modules. Electron licenses are shipped beside the executable.",
];
for (const name of [
	"react",
	"react-dom",
	"monaco-editor",
	"pyodide",
	"react-markdown",
	"remark-gfm",
]) {
	const dir = join(root, "node_modules", name);
	const license = readdirSync(dir).find((n) => /^licen[cs]e(?:\.|$)/i.test(n));
	if (license)
		notices.push(
			`\n--- ${name} ---\n${readFileSync(join(dir, license), "utf8")}`,
		);
}
const markdownLicenses = new Set();
function collectMarkdownLicenses(name, from = root) {
	const require = createRequire(join(from, "package.json"));
	const manifest = (require.resolve.paths(name) ?? [])
		.map((p) => join(p, name, "package.json"))
		.find(existsSync);
	if (!manifest) throw new Error(`Missing license package: ${name}`);
	const folder = dirname(manifest),
		pkg = JSON.parse(readFileSync(manifest, "utf8"));
	const id = `${pkg.name}@${pkg.version}`;
	if (markdownLicenses.has(id)) return;
	markdownLicenses.add(id);
	const license = readdirSync(folder).find((n) =>
		/^licen[cs]e(?:\.|$)/i.test(n),
	);
	if (license)
		notices.push(
			`\n--- ${id} ---\n${readFileSync(join(folder, license), "utf8")}`,
		);
	for (const dependency of Object.keys(pkg.dependencies ?? {}))
		collectMarkdownLicenses(dependency, folder);
}
for (const name of [
	"react-markdown",
	"remark-gfm",
	"linkedom",
	"@mozilla/readability",
])
	collectMarkdownLicenses(name);
notices.push(
	"\nLeetCode official Chinese statements and Python3 snippets: https://leetcode.cn/studyplan/top-100-liked/. Personal offline snapshots, source URLs and fetch times are recorded in content/official-source.json. These third-party contents retain their original rights; PiCareer MIT license does not relicense them.",
);
notices.push(
	"\nWeather: Open-Meteo (https://open-meteo.com/), CC BY 4.0; location data: GeoNames (https://www.geonames.org/). Online data is requested at runtime and attributed in tool results.",
);
writeFileSync(join(resources, "THIRD-PARTY-NOTICES.txt"), notices.join("\n"));
const copiedCount = prepareSdk();
const externalPi = {
	name: "local-pi-sdk",
	setup(b) {
		b.onResolve(
			{
				filter:
					/resources\/pi\/node_modules\/@earendil-works\/(pi-coding-agent|pi-ai)\/dist\/index\.js$/,
			},
			(args) => ({
				path: args.path.includes("/pi-ai/")
					? "@earendil-works/pi-ai"
					: "@earendil-works/pi-coding-agent",
				external: true,
			}),
		);
	},
};
await bundle({
	entryPoints: [join(root, "src/desktop/worker.ts")],
	outfile: join(resources, "pi", "worker.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	external: ["electron", "undici", "linkedom", "@mozilla/readability", "docx", "yauzl", "pdfjs-dist", "mammoth", "@napi-rs/canvas"],
	plugins: [externalPi],
});
await bundle({entryPoints:[join(root,"src/core/resume-material-worker.ts")],outfile:join(resources,"pi/resume-material-worker.mjs"),bundle:true,platform:"node",format:"esm",target:"node24",external:["pdfjs-dist/*","mammoth","yauzl","@napi-rs/canvas"]});
for (const file of ["main", "preload"])
	await bundle({
		entryPoints: [join(root, `src/desktop/${file}.ts`)],
		outfile: join(root, `dist/${file}.cjs`),
		bundle: true,
		platform: "node",
		format: "cjs",
		external: ["electron"],
		target: "node24",
	});
await vite({
	root,
	base: "./",
	build: { outDir: "dist/ui", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
	esbuild: { jsx: "automatic" },
});
cpSync(
	join(root, "content/leetcode-assets"),
	join(root, "dist/ui/leetcode-assets"),
	{ recursive: true },
);
const sources = [];
function visit(dir) {
	for (const name of readdirSync(dir).sort()) {
		const p = join(dir, name);
		if (["node_modules", "dist", ".git", "data"].includes(name)) continue;
		if (statSync(p).isDirectory()) visit(p);
		else
			sources.push([
				relative(pi, p).replaceAll("\\", "/"),
				createHash("sha256").update(readFileSync(p)).digest("hex"),
			]);
	}
}
visit(join(pi, "packages"));
sources.push([
	"package-lock.json",
	createHash("sha256")
		.update(readFileSync(join(pi, "package-lock.json")))
		.digest("hex"),
]);
writeFileSync(
	join(resources, "pi-source.json"),
	JSON.stringify(
		{
			sdkVersion: JSON.parse(
				readFileSync(join(pi, "packages/coding-agent/package.json"), "utf8"),
			).version,
			sourceDigest: createHash("sha256")
				.update(JSON.stringify(sources))
				.digest("hex"),
			modelCatalogSource:
				"@earendil-works/pi-ai@0.99.0 official npm artifact; validated by local check-model-data.ts",
			files: sources,
		},
		null,
		2,
	),
);
console.log(
	`Built PiCareer with ${copiedCount} local SDK dependency packages.`,
);

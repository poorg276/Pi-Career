import { mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { patchSdk } from "./patch-sdk.mjs";
const root = resolve(import.meta.dirname, ".."), pi = resolve(root, "../pi-main"), resources = join(root, "resources");
const copied = new Set();
function copyPackage(name, from, parentDestination = join(resources, "pi")) {
	const require = createRequire(join(from, "package.json"));
	let entry;
	for (const directory of require.resolve.paths(name + "/") ?? []) {
		const candidate = join(directory, name, "package.json");
		if (existsSync(candidate)) {
			entry = candidate;
			break;
		}
	}
	if (!entry)
		throw new Error("Cannot locate package " + name + " from " + from);
	const folder = dirname(entry),
		pkg = JSON.parse(readFileSync(entry, "utf8"));
	let dest = join(resources, "pi", "node_modules", name);
	if (
		existsSync(join(dest, "package.json")) &&
		JSON.parse(readFileSync(join(dest, "package.json"), "utf8")).version !==
			pkg.version
	)
		dest = join(parentDestination, "node_modules", name);
	if (copied.has(dest)) return;
	copied.add(dest);
	mkdirSync(dest, { recursive: true });
	for (const file of readdirSync(folder)) {
		if (
			[
				"node_modules",
				".git",
				"test",
				"tests",
				"benchmark",
				"examples",
			].includes(file)
		)
			continue;
		if (
			name.startsWith("@earendil-works/") &&
			["src", "scripts"].includes(file)
		)
			continue;
		cpSync(join(folder, file), join(dest, file), { recursive: true });
	}
	for (const dep of Object.keys(pkg.dependencies ?? {}))
		copyPackage(dep, folder, dest);
}

export function prepareSdk() {
 copied.clear();
 for (const name of ["pdfjs-dist","mammoth","docx","yauzl","@napi-rs/canvas","@napi-rs/canvas-win32-x64-msvc"]) copyPackage(name, root);
 copyPackage("undici", root);
 copyPackage("linkedom", root);
 copyPackage("@mozilla/readability", root);
 copyPackage("@earendil-works/pi-coding-agent", pi);
 patchSdk(join(resources, "pi/node_modules/@earendil-works/pi-ai/dist"));
 return copied.size;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(`Prepared ${prepareSdk()} SDK packages.`);

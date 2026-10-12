// Local release retention. No bundle is overwritten or discarded.
import { promises as fs, createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve, join, relative, isAbsolute, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const VERSION = /^\d+\.\d+\.\d+$/;
const LEGACY = new Set(["使用说明.md", "验收记录.md", "SHA256SUMS.txt"]);
const CATALOG = "archive/releases/catalog.json";
const JOURNALS = "archive/releases/manifests";
export function compareVersions(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b)) throw new Error("Invalid release version");
  const aa = a.split(".").map(Number), bb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return 0;
}
function versionOf(name) {
  return name.match(/^PiCareer-(\d+\.\d+\.\d+)-(?:source\.zip|x64\.(?:exe(?:\.blockmap)?|zip))$/)?.[1]
    ?? name.match(/^SHA256SUMS-(\d+\.\d+\.\d+)\.txt$/)?.[1]
    ?? name.match(/^[^/\\]+-(\d+\.\d+\.\d+)\.md$/)?.[1];
}
function required(version) {
  return [`PiCareer-${version}-x64.exe`, `PiCareer-${version}-x64.zip`, `PiCareer-${version}-source.zip`];
}
async function exists(path) {
  try { await fs.lstat(path); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; }
}
// Reject junctions/symlinks at every existing component, including files.
export async function safePath(root, rel) {
  if (isAbsolute(rel) || rel.split(/[\\/]/).some(p => !p || p === "." || p === "..")) throw new Error("Unsafe archive path");
  const absolute = resolve(root, rel), r = relative(root, absolute);
  if (!r || r.startsWith("..") || isAbsolute(r)) throw new Error("Path escapes project root");
  let cursor = root;
  for (const part of r.split(/[\\/]/)) {
    cursor = join(cursor, part);
    if (await exists(cursor)) {
      const st = await fs.lstat(cursor);
      if (st.isSymbolicLink()) throw new Error(`Linked path is not allowed: ${rel}`);
      if ((await fs.realpath(cursor)).toLowerCase() !== resolve(cursor).toLowerCase()) throw new Error(`Redirected path: ${rel}`);
    }
  }
  return absolute;
}
export async function fingerprint(path) {
  const st = await fs.lstat(path);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error("Release item must be a regular file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const after = await fs.stat(path);
  if (after.size !== st.size || after.mtimeMs !== st.mtimeMs) throw new Error("File changed during hashing");
  return { bytes: st.size, sha256: hash.digest("hex") };
}
async function matches(path, item) {
  const actual = await fingerprint(path);
  if (actual.sha256 !== item.sha256 || actual.bytes !== item.bytes) throw new Error(`Release fingerprint mismatch: ${path}`);
}
async function writeJSON(root, rel, value) {
  const target = await safePath(root, rel);
  await fs.mkdir(dirname(target), { recursive: true });
  await safePath(root, rel);
  const temporary = `${rel}.${randomUUID()}.tmp`, path = await safePath(root, temporary);
  await fs.writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  await fs.rename(path, target);
}
function validateItem(item) {
  if (!item || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new Error("Invalid archive journal item");
  const parts = item.source?.split("/");
  if (parts?.length !== 2 || parts[0] !== "release") throw new Error("Invalid journal source");
  const name = parts[1], version = versionOf(name) ?? (LEGACY.has(name) ? "legacy" : undefined);
  if (!version || item.destination !== `archive/releases/${version}/${name}`) throw new Error("Invalid journal destination");
}
async function moveItem(root, item, recovering = false) {
  validateItem(item);
  const source = await safePath(root, item.source), destination = await safePath(root, item.destination);
  if (!await exists(source)) {
    if (!await exists(destination)) throw new Error(`Both paths missing: ${item.source}`);
    await matches(destination, item);
    return;
  }
  await matches(source, item);
  if (await exists(destination)) {
    await matches(destination, item);
    if (!recovering) throw new Error(`Destination already exists; preserved both copies: ${item.destination}`);
  } else {
    await fs.mkdir(dirname(destination), { recursive: true });
    await safePath(root, item.destination);
    // Same-volume hard link is exclusive: EEXIST never replaces an existing file.
    // Then remove only the old directory entry after both paths are verified.
    await fs.link(source, destination);
  }
  await matches(destination, item);
  await safePath(root, item.source);
  await matches(source, item);
  await fs.unlink(source);
}
async function pending(root, apply) {
  const folder = await safePath(root, JOURNALS);
  if (!await exists(folder)) return { manifests: [], items: [] };
  const unfinished = [], recordedItems = [];
  for (const name of (await fs.readdir(folder)).filter(n => /^archive-[a-f0-9-]+\.json$/.test(n)).sort()) {
    const rel = `${JOURNALS}/${name}`, journal = JSON.parse(await fs.readFile(await safePath(root, rel), "utf8"));
    if (journal.complete) continue;
    if (!Array.isArray(journal.items)) throw new Error("Invalid archive journal");
    for (const item of journal.items) { validateItem(item); await safePath(root, item.source); await safePath(root, item.destination); }
    unfinished.push(rel);
    recordedItems.push(...journal.items);
    if (apply) {
      for (const item of journal.items) {
        await moveItem(root, item, true);
        item.status = "verified";
        await writeJSON(root, rel, journal);
      }
      journal.complete = true; journal.completedAt = new Date().toISOString();
      await writeJSON(root, rel, journal);
    }
  }
  return { manifests: unfinished, items: recordedItems };
}
async function accept(root, version, inventory, expected, reason) {
  if (!VERSION.test(version)) throw new Error("Invalid version");
  const names = inventory.filter(n => versionOf(n) === version);
  for (const name of required(version)) if (!names.includes(name) || !expected.has(name)) throw new Error(`Incomplete release or checksum: ${version} (${name})`);
  const files = [];
  for (const name of names) {
    const fp = await fingerprint(await safePath(root, `release/${name}`));
    if (fp.bytes === 0 || (expected.has(name) && expected.get(name) !== fp.sha256)) throw new Error(`Release checksum mismatch: ${name}`);
    files.push({ name, ...fp });
  }
  return { version, acceptedAt: new Date().toISOString(), reason, files };
}
export async function archiveReleases({ root, apply = false, registerExisting = false, acceptVersion, afterMove } = {}) {
  root = resolve(root ?? join(import.meta.dirname, ".."));
  if ((await fs.lstat(root)).isSymbolicLink() || (await fs.realpath(root)).toLowerCase() !== root.toLowerCase()) throw new Error("Project root is redirected");
  const release = await safePath(root, "release");
  const recovery = await pending(root, apply), recovered = recovery.manifests;
  const names = (await fs.readdir(release, { withFileTypes: true })).filter(e => e.isFile() || e.isSymbolicLink()).map(e => e.name).sort();
  const catalogPath = await safePath(root, CATALOG), hadCatalog = await exists(catalogPath);
  const catalog = hadCatalog ? JSON.parse(await fs.readFile(catalogPath, "utf8")) : { schema: 1, releases: [] };
  if (catalog.schema !== 1 || !Array.isArray(catalog.releases)) throw new Error("Unsupported release catalog");
  for (const entry of catalog.releases) {
    if (!VERSION.test(entry.version) || !Array.isArray(entry.files)) throw new Error("Invalid release catalog");
    for (const file of entry.files) if (versionOf(file.name) !== entry.version || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid catalog file");
  }
  if (registerExisting && hadCatalog) throw new Error("Existing releases already registered; use the normal preview/apply command");
  const expected = new Map();
  for (const name of names.filter(n => /^SHA256SUMS(?:-\d+\.\d+\.\d+)?\.txt$/.test(n))) {
    const body = await fs.readFile(await safePath(root, `release/${name}`), "utf8");
    for (const line of body.split(/\r?\n/).filter(s => s.trim())) {
      const m = line.match(/^([a-f0-9]{64})\s+\*?([^/\\]+)$/i);
      if (!m || !/^PiCareer-\d+\.\d+\.\d+-(?:source\.zip|x64\.(?:exe|zip))$/.test(m[2])) throw new Error(`Invalid checksum line: ${name}`);
      const digest = m[1].toLowerCase();
      if (expected.has(m[2]) && expected.get(m[2]) !== digest) throw new Error(`Conflicting checksum: ${m[2]}`);
      expected.set(m[2], digest);
    }
  }
  if (registerExisting) {
    const current = JSON.parse(await fs.readFile(join(root, "package.json"), "utf8")).version;
    const versions = [...new Set(names.map(versionOf).filter(Boolean))].sort(compareVersions);
    for (const version of versions.filter(v => compareVersions(v, current) <= 0)) catalog.releases.push(await accept(root, version, names, expected, "user-approved existing release baseline"));
  }
  if (acceptVersion) {
    if (catalog.releases.some(e => e.version === acceptVersion)) throw new Error("Version already accepted; do not replace its fingerprint");
    if (!VERSION.test(acceptVersion)) throw new Error("Invalid version");
    const ref = `refs/tags/v${acceptVersion}`;
    if (execFileSync("git", ["cat-file", "-t", ref], { cwd: root, encoding: "utf8" }).trim() !== "tag") throw new Error("Release requires an annotated tag");
    catalog.releases.push(await accept(root, acceptVersion, names, expected, `accepted annotated tag v${acceptVersion}`));
  }
  const accepted = new Map(catalog.releases.map(e => [e.version, e]));
  const kept = [...accepted.keys()].sort(compareVersions).slice(-2);
  if (kept.length < 2) throw new Error("Need at least two accepted complete releases; use --register-existing for the approved baseline");
  // Never count merely complete candidate builds as accepted releases.
  for (const version of kept) for (const name of required(version)) {
    const file = accepted.get(version).files.find(f => f.name === name);
    if (!file || !names.includes(name)) throw new Error(`Retained release missing: ${name}`);
    await matches(await safePath(root, `release/${name}`), file);
  }
  const items = [];
  for (const name of names) {
    const version = versionOf(name);
    if ((!version || kept.includes(version) || !accepted.has(version)) && !LEGACY.has(name)) continue;
    const fp = version ? accepted.get(version)?.files.find(f => f.name === name) : undefined;
    if (version && !fp) throw new Error(`Unregistered file in accepted release: ${name}`);
    const item = { source: `release/${name}`, destination: `archive/releases/${version ?? "legacy"}/${name}`, ...(fp ?? await fingerprint(await safePath(root, `release/${name}`))), status: "pending" };
    delete item.name;
    validateItem(item);
    await matches(await safePath(root, item.source), item);
    const destination = await safePath(root, item.destination);
    if (await exists(destination)) {
      await matches(destination, item);
      const previewRecovery = !apply && recovery.items.some(i => i.source === item.source && i.destination === item.destination && i.sha256 === item.sha256 && i.bytes === item.bytes);
      if (!previewRecovery) throw new Error(`Destination exists; no files overwritten: ${item.destination}`);
    }
    items.push(item);
  }
  const result = { schema: 1, apply, keptVersions: kept, pendingRecovery: recovered, candidates: [...new Set(names.map(versionOf).filter(v => v && !accepted.has(v)))], movedFiles: items.length, bytes: items.reduce((sum, i) => sum + i.bytes, 0), items };
  if (!apply) return result;
  await writeJSON(root, CATALOG, catalog);
  if (items.length) {
    const manifest = `${JOURNALS}/archive-${randomUUID()}.json`;
    const journal = { ...result, startedAt: new Date().toISOString(), complete: false };
    await writeJSON(root, manifest, journal);
    for (const item of items) {
      await moveItem(root, item);
      item.status = "verified";
      await writeJSON(root, manifest, journal);
      await afterMove?.(item); // Fault injection for isolated tests only.
    }
    journal.complete = true; journal.completedAt = new Date().toISOString();
    await writeJSON(root, manifest, journal);
    result.manifest = manifest;
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), allowed = new Set(["--apply", "--register-existing", "--accept-version"]);
  let acceptVersion;
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
    if (args[i] === "--accept-version") { acceptVersion = args[++i]; if (!acceptVersion || !VERSION.test(acceptVersion)) throw new Error("Expected a release version"); }
  }
  try {
    const result = await archiveReleases({ apply: args.includes("--apply"), registerExisting: args.includes("--register-existing"), acceptVersion });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

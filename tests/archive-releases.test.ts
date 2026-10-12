import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { archiveReleases, compareVersions, fingerprint, safePath } from "../scripts/archive-releases.mjs";

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "picareer-archive-"));
  await fs.mkdir(join(root, "release/win-unpacked"), { recursive: true });
  await fs.writeFile(join(root, "release/win-unpacked/PiCareer.exe"), "current launcher");
  await fs.writeFile(join(root, "package.json"), JSON.stringify({ version: "0.1.13" }));
  const version = async (v: string) => {
    const lines = [];
    for (const suffix of ["x64.exe", "x64.zip", "source.zip"]) {
      const name = `PiCareer-${v}-${suffix}`, path = join(root, "release", name);
      await fs.writeFile(path, `accepted fixture ${name}`);
      lines.push(`${(await fingerprint(path)).sha256}  ${name}`);
    }
    await fs.writeFile(join(root, "release", `SHA256SUMS-${v}.txt`), lines.join("\n"));
  };
  for (const v of ["0.1.2", "0.1.10", "0.1.12", "0.1.13"]) await version(v);
  return { root, version, close: async () => {
    assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(root.includes("picareer-archive-"));
    await fs.rm(root, { recursive: true, force: true });
  } };
}
const has = async (p: string) => fs.access(p).then(() => true, () => false);

test("archive preview sorts numeric versions and does not create directories or change files", async () => {
  const f = await fixture();
  try {
    assert.ok(compareVersions("0.1.10", "0.1.2") > 0);
    const before = await fs.readdir(join(f.root, "release"));
    const result = await archiveReleases({ root: f.root, registerExisting: true });
    assert.deepEqual(result.keptVersions, ["0.1.12", "0.1.13"]);
    assert.equal(result.movedFiles, 8);
    assert.equal(await has(join(f.root, "archive")), false);
    assert.deepEqual(await fs.readdir(join(f.root, "release")), before);
  } finally { await f.close(); }
});

test("archive apply verifies every moved byte, keeps launcher and two releases, and is idempotent", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(join(f.root, "release/使用说明.md"), "old docs");
    await fs.writeFile(join(f.root, "release/builder-debug.yml"), "unrelated build output");
    const r = await archiveReleases({ root: f.root, registerExisting: true, apply: true });
    assert.equal(r.movedFiles, 9);
    for (const item of r.items) {
      assert.equal(await has(join(f.root, item.source)), false);
      assert.deepEqual(await fingerprint(join(f.root, item.destination)), { bytes: item.bytes, sha256: item.sha256 });
    }
    assert.equal(await fs.readFile(join(f.root, "release/win-unpacked/PiCareer.exe"), "utf8"), "current launcher");
    assert.ok(await has(join(f.root, "release/PiCareer-0.1.12-x64.exe")));
    assert.ok(await has(join(f.root, "release/PiCareer-0.1.13-x64.exe")));
    assert.ok(await has(join(f.root, "release/builder-debug.yml")));
    assert.equal((await archiveReleases({ root: f.root, apply: true })).movedFiles, 0);
    assert.ok(r.manifest);
    assert.ok(JSON.parse(await fs.readFile(join(f.root, r.manifest), "utf8")).complete);
  } finally { await f.close(); }
});

test("different destination content aborts preflight without overwriting or moving other files", async () => {
  const f = await fixture();
  try {
    await fs.mkdir(join(f.root, "archive/releases/0.1.2"), { recursive: true });
    const dest = join(f.root, "archive/releases/0.1.2/PiCareer-0.1.2-x64.exe");
    await fs.writeFile(dest, "existing different archive");
    const before = await fs.readdir(join(f.root, "release"));
    await assert.rejects(archiveReleases({ root: f.root, registerExisting: true, apply: true }), /fingerprint mismatch/);
    assert.equal(await fs.readFile(dest, "utf8"), "existing different archive");
    assert.deepEqual(await fs.readdir(join(f.root, "release")), before);
    assert.equal(await has(join(f.root, "archive/releases/catalog.json")), false);
  } finally { await f.close(); }
});

test("missing bundle or bad checksum cannot be accepted", async () => {
  const f = await fixture();
  try {
    const path = join(f.root, "release/PiCareer-0.1.2-source.zip");
    await fs.writeFile(path, "tampered");
    await assert.rejects(archiveReleases({ root: f.root, registerExisting: true, apply: true }), /checksum mismatch/);
    assert.equal(await has(join(f.root, "archive")), false);
    await fs.unlink(path);
    await assert.rejects(archiveReleases({ root: f.root, registerExisting: true }), /Incomplete release/);
  } finally { await f.close(); }
});

test("path traversal and a directory junction are blocked", async () => {
  const f = await fixture(), outside = await fs.mkdtemp(join(tmpdir(), "picareer-archive-outside-"));
  try {
    await assert.rejects(safePath(f.root, "../outside"), /Unsafe|escapes/);
    await assert.rejects(safePath(f.root, resolve(outside)), /Unsafe/);
    await fs.writeFile(join(outside, "keep.txt"), "unrelated");
    await fs.symlink(outside, join(f.root, "archive"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(archiveReleases({ root: f.root, registerExisting: true, apply: true }), /Linked|Redirected/);
    assert.equal(await fs.readFile(join(outside, "keep.txt"), "utf8"), "unrelated");
  } finally {
    await f.close();
    assert.equal(dirname(resolve(outside)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("interrupted journal and hard-link-before-unlink interruption recover without losing bytes", async () => {
  const f = await fixture();
  try {
    let moved = 0;
    await assert.rejects(archiveReleases({ root: f.root, registerExisting: true, apply: true, afterMove: () => { if (++moved === 1) throw new Error("simulated interruption"); } }), /simulated interruption/);
    const folder = join(f.root, "archive/releases/manifests"), name = (await fs.readdir(folder))[0];
    const journal = JSON.parse(await fs.readFile(join(folder, name), "utf8"));
    const next = journal.items[1];
    await fs.mkdir(dirname(join(f.root, next.destination)), { recursive: true });
    await fs.link(join(f.root, next.source), join(f.root, next.destination));
    const preview = await archiveReleases({ root: f.root });
    assert.equal(preview.pendingRecovery.length, 1);
    assert.equal(await has(join(f.root, next.source)), true, "dry run does not resume");
    const r = await archiveReleases({ root: f.root, apply: true });
    assert.equal(r.pendingRecovery.length, 1);
    assert.equal(r.movedFiles, 0);
    for (const item of journal.items) {
      assert.equal(await has(join(f.root, item.source)), false);
      assert.equal((await fingerprint(join(f.root, item.destination))).sha256, item.sha256);
    }
    assert.equal(JSON.parse(await fs.readFile(join(folder, name), "utf8")).complete, true);
  } finally { await f.close(); }
});

test("unaccepted candidate does not displace rollback; new release needs annotated tag", async () => {
  const f = await fixture();
  try {
    await f.version("0.1.14");
    await archiveReleases({ root: f.root, registerExisting: true, apply: true });
    const preview = await archiveReleases({ root: f.root });
    assert.deepEqual(preview.keptVersions, ["0.1.12", "0.1.13"]);
    assert.deepEqual(preview.candidates, ["0.1.14"]);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: f.root, stdio: "pipe" });
    git("init", "-b", "main"); git("config", "user.name", "Isolated test"); git("config", "user.email", "test@example.invalid");
    git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture");
    git("tag", "v0.1.14");
    await assert.rejects(archiveReleases({ root: f.root, acceptVersion: "0.1.14" }), /annotated tag/);
    git("tag", "-d", "v0.1.14"); git("-c", "tag.gpgsign=false", "tag", "-a", "v0.1.14", "-m", "accepted fixture");
    const r = await archiveReleases({ root: f.root, acceptVersion: "0.1.14", apply: true });
    assert.deepEqual(r.keptVersions, ["0.1.13", "0.1.14"]);
    assert.equal(await has(join(f.root, "release/PiCareer-0.1.12-x64.exe")), false);
    assert.ok(await has(join(f.root, "release/PiCareer-0.1.13-x64.exe")));
  } finally { await f.close(); }
});

test("tampered journal cannot move a file outside its original release scope", async () => {
  const f = await fixture();
  try {
    await assert.rejects(archiveReleases({ root: f.root, registerExisting: true, apply: true, afterMove: () => { throw new Error("interruption"); } }), /interruption/);
    const folder = join(f.root, "archive/releases/manifests"), name = (await fs.readdir(folder))[0];
    const journal = JSON.parse(await fs.readFile(join(folder, name), "utf8"));
    journal.items[1].source = "../private.txt";
    await fs.writeFile(join(folder, name), JSON.stringify(journal));
    await assert.rejects(archiveReleases({ root: f.root, apply: true }), /Invalid journal source/);
    assert.ok(await has(join(f.root, "release/PiCareer-0.1.12-x64.exe")));
  } finally { await f.close(); }
});

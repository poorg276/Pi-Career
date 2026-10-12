"""Package application sources, public fixtures and acceptance records, excluding user data."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
release = root / "release"
release.mkdir(exist_ok=True)
target = release / f"PiCareer-{version}-source.zip"
top_files = [".gitignore", ".gitattributes", ".npmrc", "AGENTS.md", "index.html", "LICENSE", "package.json", "package-lock.json", "README.md", "tsconfig.json", "启动 PiCareer.cmd"]
files = [root / name for name in top_files]
for folder in ["src", "scripts", "content", "docs", "tests"]:
    files.extend(p for p in (root / folder).rglob("*") if p.is_file()
                 and "__pycache__" not in p.parts
                 and not (folder == "docs" and "screenshots" in p.parts))
files.extend(p for p in (root / "resources").iterdir() if p.is_file())
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(files):
        archive.write(path, "PiCareer/" + path.relative_to(root).as_posix())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(files)
artifacts = [release / f"PiCareer-{version}-x64.exe", release / f"PiCareer-{version}-x64.zip", target]
lines = []
for path in artifacts:
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"Missing release artifact: {path}")
    digest = hashlib.file_digest(path.open("rb"), "sha256").hexdigest()
    lines.append(f"{digest}  {path.name}")
    print(f"{path.name}: {path.stat().st_size} bytes")
(release / f"SHA256SUMS-{version}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Source archive verified: {len(files)} files; no installed dependencies or user database included.")

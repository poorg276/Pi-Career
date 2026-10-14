"""Verify portable CRC and runtime files against the tested unpacked application."""
import hashlib
import json
import os
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
release = Path(os.environ.get("PICAREER_RELEASE_DIR", str(root / "release"))).resolve()
required = [
    "PiCareer.exe", "resources/app.asar", "resources/resources/pi/worker.mjs",
    "resources/resources/pi/resume-material-worker.mjs",
    "resources/resources/pi/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node",
    "resources/resources/pi/node_modules/pdfjs-dist/legacy/build/pdf.mjs",
    "resources/resources/pi/node_modules/mammoth/lib/index.js",
    "resources/resources/pi/node_modules/docx/dist/index.mjs",
]
with zipfile.ZipFile(release / f"PiCareer-{version}-x64.zip") as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert not any(name.endswith(("picareer.sqlite", "picareer.sqlite.backup")) for name in names)
    for name in required:
        expected = (release / "win-unpacked" / name).read_bytes()
        assert hashlib.sha256(archive.read(name)).digest() == hashlib.sha256(expected).digest(), name
result = {"version": version, "passed": True, "portableCRCVerified": True,
          "requiredFiles": required, "entries": len(names), "noUserDatabase": True}
(root / "docs" / "evidence" / f"package-{version}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))

#!/usr/bin/env python3
"""Package the extension for the Chrome Web Store (or manual distribution).

Zips exactly what Chrome loads — manifest.json, src/, icons/ — and nothing
from the repo's dev tooling (.claude/, scripts/, README, etc.). The result is
what you drag into the Developer Dashboard's "Upload new package" flow.

Usage:
    python scripts/package_extension.py
"""

import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT / "dist"
INCLUDE = ["manifest.json", "src", "icons"]


def iter_files():
    for rel in INCLUDE:
        path = ROOT / rel
        if path.is_file():
            yield path, path.relative_to(ROOT)
        elif path.is_dir():
            for f in sorted(path.rglob("*")):
                if f.is_file():
                    yield f, f.relative_to(ROOT)


def main() -> int:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = manifest.get("version", "0.0.0")

    DIST_DIR.mkdir(exist_ok=True)
    out_path = DIST_DIR / f"jira-timesheet-viewer-v{version}.zip"

    count = 0
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for abs_path, rel_path in iter_files():
            zf.write(abs_path, rel_path.as_posix())
            count += 1

    print(f"Packaged {count} files into {out_path}")
    print("Upload this file directly at chrome.google.com/webstore/devconsole.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

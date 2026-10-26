#!/usr/bin/env python3
"""Which files in src/components/ui are imported by nothing, and which packages only they use.
Run from the repository root:

    python3 scripts/audit/unused-ui.py

It looks for import paths (`components/ui/<name>` and `./<name>` inside the folder) and package
imports under src/, so a component loaded in some other way would be reported as unused: read the
list, then delete and run `npm run typecheck`, the tests and the build before trusting it. It only
prints; it never changes a file.
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def grep(pattern: str, *paths: str) -> list[str]:
    out = subprocess.run(["grep", "-rlE", pattern, *paths], capture_output=True, text=True, cwd=ROOT).stdout
    return out.split()


ui_dir = ROOT / "src/components/ui"
files = sorted(p for p in ui_dir.glob("*.tsx"))
unused = set()
for f in files:
    name = f.stem
    outside = [x for x in grep(rf"components/ui/{name}['\"]", "src", "tests") if x != f"src/components/ui/{f.name}"]
    inside = [x for x in grep(rf"from ['\"]\./{name}['\"]", "src/components/ui") if x != f"src/components/ui/{f.name}"]
    if not outside and not inside:
        unused.add(f"src/components/ui/{f.name}")

print(f"unused UI files: {len(unused)} of {len(files)}")
for f in sorted(unused):
    print("  ", f)

deps = json.loads((ROOT / "package.json").read_text())["dependencies"]
only_unused, never = [], []
for dep in deps:
    # `from "x"`, a side-effect `import "x"` and a dynamic `import("x")`, in the app, the build
    # config and the page.
    pattern = rf"(from |import\(|import )['\"]{re.escape(dep)}(/[^'\"]*)?['\"]"
    importers = grep(pattern, "src", "vite.config.ts", "index.html")
    if not importers:
        never.append(dep)
    elif all(x in unused for x in importers):
        only_unused.append(dep)
print(f"\npackages imported only by unused UI files: {len(only_unused)}")
for d in only_unused:
    print("  ", d)
print(f"\ndependencies imported by nothing in src/, vite.config.ts or index.html (check each: one may be loaded another way): {len(never)}")
for d in never:
    print("  ", d)
print(f"\nlines in the unused files: {sum(len((ROOT / f).read_text().splitlines()) for f in unused)}")

#!/usr/bin/env python3
"""Build a self-contained static directory for the Pyodide WebLLM demo.

Produces a directory servable by any static file server (nginx, python -m
http.server, S3, GitHub Pages, etc.).

Usage:
    python bundle.py                          # writes to ./_pyodide_build/
    python bundle.py --output-dir /tmp/build  # custom output directory
"""

import argparse
import json
import os
import shutil
from pathlib import Path

# Root of the inspect_ai package source
PACKAGE_ROOT = Path(__file__).resolve().parent.parent  # src/inspect_ai/
DEMO_DIR = Path(__file__).resolve().parent  # src/inspect_ai/_pyodide/
DEPS_JSON = DEMO_DIR / "deps.json"
VIEW_DIST = PACKAGE_ROOT / "_view" / "www" / "dist"


def collect_source_files() -> dict[str, str]:
    """Collect all .py and data files under src/inspect_ai/ as {relative_path: content}."""
    include_ext = {".py", ".jsonl", ".json", ".csv", ".txt"}
    files: dict[str, str] = {}
    for root, _dirs, filenames in os.walk(PACKAGE_ROOT):
        rel_root = Path(root).relative_to(PACKAGE_ROOT.parent)
        skip = {"__pycache__", ".egg-info", "node_modules", ".venv"}
        if any(part in skip or part.endswith(".egg-info") for part in rel_root.parts):
            continue
        for fname in filenames:
            if not any(fname.endswith(ext) for ext in include_ext):
                continue
            filepath = Path(root) / fname
            rel_path = filepath.relative_to(PACKAGE_ROOT.parent)
            try:
                content = filepath.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            files[str(rel_path)] = content
    return files


def bundle(output_dir: Path) -> None:
    """Build the static bundle into output_dir."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Collect and write inspect_ai_source.json
    source_files = collect_source_files()
    source_json_path = output_dir / "inspect_ai_source.json"
    source_json_path.write_text(json.dumps(source_files), encoding="utf-8")
    print(f"Wrote {len(source_files)} files to inspect_ai_source.json")

    # 2. Copy deps.json
    shutil.copy2(DEPS_JSON, output_dir / "deps.json")
    print("Copied deps.json")

    # 3. Copy demo_webllm.html as index.html
    shutil.copy2(DEMO_DIR / "demo_webllm.html", output_dir / "index.html")
    print("Copied demo_webllm.html → index.html")

    # 4. Copy Inspect View dist assets into view/
    view_out = output_dir / "view"
    if VIEW_DIST.exists():
        if view_out.exists():
            shutil.rmtree(view_out)
        shutil.copytree(VIEW_DIST, view_out)
        print(f"Copied Inspect View assets to view/")
    else:
        print(f"WARNING: View assets not found at {VIEW_DIST} — view/ will be missing")

    print(f"\nBundle ready: {output_dir}")
    print(f"Serve with:  cd {output_dir} && python -m http.server 37575")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a static bundle for the Inspect AI Pyodide WebLLM demo"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path.cwd() / "_pyodide_build",
        help="Output directory (default: ./_pyodide_build/)",
    )
    args = parser.parse_args()
    bundle(args.output_dir)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Local dev server for the Pyodide demo.

Serves demo.html and provides /inspect_ai_source.json — a JSON mapping of
every .py file in src/inspect_ai/ to its contents, which the demo page writes
into Pyodide's virtual filesystem.

Also serves the Inspect View UI for viewing eval results after completion.

Usage:
    python serve.py              # serves on http://localhost:8080
    python serve.py --port 9000  # custom port
"""

import argparse
import json
import mimetypes
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from pathlib import Path

# Root of the inspect_ai package source
PACKAGE_ROOT = Path(__file__).resolve().parent.parent  # src/inspect_ai/
DEMO_DIR = Path(__file__).resolve().parent  # src/inspect_ai/_pyodide/
VIEW_DIST = PACKAGE_ROOT / "_view" / "www" / "dist"  # Inspect View built assets
# Content-type map for view assets
CONTENT_TYPES: dict[str, str] = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".json": "application/json",
}


def collect_source_files() -> dict[str, str]:
    """Collect all .py and data files under src/inspect_ai/ as {relative_path: content}."""
    # Extensions to include beyond .py (data files needed at runtime)
    include_ext = {".py", ".jsonl", ".json", ".csv", ".txt"}
    files: dict[str, str] = {}
    for root, _dirs, filenames in os.walk(PACKAGE_ROOT):
        # Skip __pycache__, .egg-info, _pyodide itself (no need to ship the demo)
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


_cached_source: str | None = None


def get_source_json() -> str:
    global _cached_source
    if _cached_source is None:
        _cached_source = json.dumps(collect_source_files())
    return _cached_source


class DemoHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/" or self.path == "/demo.html":
            self.serve_file(DEMO_DIR / "demo.html", "text/html")
        elif self.path == "/inspect_ai_source.json":
            data = get_source_json().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        elif self.path.startswith("/view/") or self.path == "/view":
            self._serve_view()
        else:
            self.send_error(404)

    def _serve_view(self) -> None:
        # Strip /view prefix to get the asset path
        sub_path = self.path[len("/view") :]
        if sub_path in ("", "/") or sub_path.startswith("/?"):
            file_path = VIEW_DIST / "index.html"
            content_type = "text/html"
        else:
            # e.g. /view/assets/index.js -> assets/index.js
            rel = sub_path.lstrip("/").split("?")[0]
            file_path = VIEW_DIST / rel
            ext = Path(rel).suffix
            content_type = CONTENT_TYPES.get(
                ext, mimetypes.guess_type(rel)[0] or "application/octet-stream"
            )

        # Prevent path traversal
        try:
            file_path.resolve().relative_to(VIEW_DIST.resolve())
        except ValueError:
            self.send_error(403)
            return

        self.serve_file(file_path, content_type)

    def serve_file(self, path: Path, content_type: str) -> None:
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        # Quieter logging
        sys.stderr.write(f"[pyodide-demo] {args[0]} {args[1]}\n")


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    """Handle each request in a new thread so the browser can POST while the page is open."""

    daemon_threads = True


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Inspect AI Pyodide demo")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    # Pre-build the source JSON
    source = collect_source_files()
    print(f"Collected {len(source)} .py files from {PACKAGE_ROOT}")

    if VIEW_DIST.exists():
        print(f"Inspect View assets: {VIEW_DIST}")
    else:
        print(f"WARNING: View assets not found at {VIEW_DIST} — /view/ will 404")

    server = ThreadingHTTPServer((args.host, args.port), DemoHandler)
    print(f"Serving on http://{args.host}:{args.port}/")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()

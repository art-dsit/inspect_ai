#!/usr/bin/env python3
"""Local dev server for the Pyodide demo.

Serves demo.html and provides /inspect_ai_source.json — a JSON mapping of
every .py file in src/inspect_ai/ to its contents, which the demo page writes
into Pyodide's virtual filesystem.

Usage:
    python serve.py              # serves on http://localhost:8080
    python serve.py --port 9000  # custom port
"""

import argparse
import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# Root of the inspect_ai package source
PACKAGE_ROOT = Path(__file__).resolve().parent.parent  # src/inspect_ai/
DEMO_DIR = Path(__file__).resolve().parent  # src/inspect_ai/_pyodide/


def collect_source_files() -> dict[str, str]:
    """Collect all .py files under src/inspect_ai/ as {relative_path: content}."""
    files: dict[str, str] = {}
    for root, _dirs, filenames in os.walk(PACKAGE_ROOT):
        # Skip __pycache__, .egg-info, _pyodide itself (no need to ship the demo)
        rel_root = Path(root).relative_to(PACKAGE_ROOT.parent)
        skip = {"__pycache__", ".egg-info", "node_modules", ".venv"}
        if any(part in skip or part.endswith(".egg-info") for part in rel_root.parts):
            continue
        for fname in filenames:
            if not fname.endswith(".py"):
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
        else:
            self.send_error(404)

    def serve_file(self, path: Path, content_type: str) -> None:
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        # Quieter logging
        sys.stderr.write(f"[pyodide-demo] {args[0]} {args[1]}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Inspect AI Pyodide demo")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    # Pre-build the source JSON
    source = collect_source_files()
    print(f"Collected {len(source)} .py files from {PACKAGE_ROOT}")

    server = HTTPServer((args.host, args.port), DemoHandler)
    print(f"Serving on http://{args.host}:{args.port}/")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()

# Inspect AI in Pyodide

Run Inspect AI evals in the browser via [Pyodide](https://pyodide.org/) (CPython compiled to WebAssembly).

## Goal

Prove the core eval loop works in-browser with `mockllm` — no sandbox, no tools, no real LLM API calls. This establishes a foundation for future work (WebLLM model provider, WASM sandbox, etc.).

## Problem: import-time blockers

When you do `import inspect_ai` in Pyodide, a chain of top-level imports fails because several dependencies are C extensions or platform-specific modules unavailable in Emscripten/WASM:

| Blocker | Where used | Why it fails |
|---------|-----------|-------------|
| `nest_asyncio2` | `_util/_async.py` | C extension |
| `rich` / `textual` | `_display/`, `_util/logger.py`, `_util/error.py` | `rich` is available in Pyodide but `textual` is not; both were eagerly imported |
| `mmh3` | `_util/hash.py`, `model/_message_ids.py` | C extension |
| `platformdirs` | `_util/appdirs.py` | Not available in Pyodide |
| `psutil` | `_view/view.py`, `log/_recorders/buffer/database.py` | C extension |
| `s3fs` / `boto3` / `aiobotocore` | `_util/file.py`, `_util/asyncfiles.py` | Not available in Pyodide |
| `tiktoken` | `model/_tokens.py` | C extension |
| `readline` | `util/_console.py` | Removed from Pyodide stdlib |
| `zipfile_zstd` | `log/__init__.py` | Not available in Pyodide |
| `aiohttp` | `_view/server.py` (via `_view/view.py`) | Not needed in browser |

## Architecture: stub modules + lazy imports

Instead of scattering `try/except ImportError` guards and `sys.platform == "emscripten"` checks throughout the production codebase, Pyodide support uses a two-part approach:

### 1. Shim layer (`shims.py`)

A single file (`_pyodide/shims.py`) that pre-populates `sys.modules` with lightweight stubs for every unavailable dependency **before** `import inspect_ai` runs. When production code does `import mmh3`, it gets the stub transparently — no code changes needed.

Stubbed modules and their behavior:

| Module | Stub behavior |
|--------|--------------|
| `mmh3` | `hash64()` → hashlib.blake2s-based fallback returning `(int, int)` |
| `nest_asyncio2` | `apply()` → no-op (Pyodide's event loop is already re-entrant) |
| `platformdirs` | `user_cache_dir()` etc. → `/tmp/inspect_ai/...` paths |
| `psutil` | `pid_exists()` → False; `Process()` → raises `NotImplementedError` |
| `tiktoken` | `get_encoding()` → object with `.encode()` returning `list(range(len(text)//4))` |
| `s3fs` | `S3FileSystem` → raises on instantiation |
| `boto3`, `aiobotocore`, `botocore` | Empty modules with typed sub-module attributes |
| `textual` + `textual.containers` | `Container` → empty class |
| `zipfile_zstd` | Empty module (just needs to be importable) |
| `readline` | Empty module |

**Note:** `rich` is **NOT** stubbed — it's available in Pyodide natively.

The shims are loaded via `importlib.util.spec_from_file_location()` (not `import inspect_ai._pyodide.shims`) to avoid triggering `inspect_ai.__init__` before stubs are installed.

### 2. Lazy imports (minimal production changes)

A small number of changes move eager top-level imports to lazy (inside function bodies or `TYPE_CHECKING` guards). These are good practice regardless of Pyodide:

| File | Change |
|------|--------|
| `_display/core/active.py` | Display backends lazy-imported inside `display()` |
| `_display/core/display.py` | `rich`/`Console` → `TYPE_CHECKING`; lazy import in `input_screen()` |
| `_view/view.py` | `psutil` → lazy import inside `view_acquire_port()` |
| `approval/_human/approver.py` | `panel_approval` → lazy import inside function body |
| `agent/_human/agent.py` | `HumanAgentPanel` → lazy import inside function body |
| `__init__.py` | `view` → lazy via `__getattr__` |

### Consolidated dependencies (`deps.json`)

All Pyodide dependency lists are defined once in `_pyodide/deps.json`. Both `demo_webllm.html` (fetched as a static asset) and `test_pyodide.mjs` (read from disk) use this single source of truth.

## Bootstrap sequence

In both `demo_webllm.html` and `test_pyodide.mjs`:

1. Load Pyodide, install deps (from `deps.json`)
2. Write source files to virtual FS
3. Create dist-info metadata (for `importlib.metadata`)
4. **Load `shims.py`** via `importlib.util` (installs stubs into `sys.modules`)
5. `import inspect_ai` (works cleanly — stubs found in `sys.modules`)
6. Run eval

## Demo / test infrastructure

| File | Purpose |
|------|---------|
| `_pyodide/shims.py` | Stub module installer — pre-populates `sys.modules` for Pyodide |
| `_pyodide/deps.json` | Single source of truth for Pyodide dependency lists |
| `_pyodide/demo_webllm.html` | Browser demo — loads Pyodide + WebLLM, installs deps, writes source to virtual FS, runs popularity eval with a local WebGPU model, serializes log, and displays results in an embedded Inspect View iframe via blob URL |
| `_pyodide/bundle.py` | Build script — produces a self-contained static directory (index.html, deps.json, inspect_ai_source.json, view/) servable by any static file server |
| `_pyodide/test_pyodide.mjs` | Headless Node.js test — same flow as demo, no browser needed |
| `_pyodide/test_webllm.py` | Headless Playwright test — builds bundle, serves statically, runs eval in headless Chromium with WebGPU |
| `_pyodide/screenshot.py` | Headless Playwright screenshot utility — builds bundle, opens demo in headless Chromium, optionally runs eval, saves screenshot |

## Inspect View integration

After an eval completes, the demo serializes the eval log JSON and passes it directly to Inspect View via a blob URL — no server round-trip. The JSON is wrapped in a `Blob`, a `blob:` URL is created with `URL.createObjectURL()`, and the View is loaded in an inline iframe with `?log_file=<blob_url>`. The View's `fetch()` natively supports blob URLs. Key details:

- **Log serialization** uses `_read_log_from_bytes()` (synchronous `zipfile`) to avoid `asyncio.run()` and thread-spawning failures in Pyodide's single-threaded Emscripten environment.
- **LazyList avoidance:** code never accesses `EvalLog.samples` or `.reductions` directly, since `LazyList.__bool__`/`__len__`/`__iter__` all trigger `asyncio.run()`.
- **Blob URL handling:** `encodePathParts()` in `uri.ts` skips blob URLs to avoid mangling their opaque path structure.
- **Single-file mode navigation fix:** In the View's single-file mode (used by the iframe), the home icon is hidden (no meaningful destination), `LogViewContainer` skips its `unloadLog` cleanup on unmount (the blob-loaded log must stay in the store), and `LogSampleDetailView` navigates to the hash root `/` instead of `logsUrl()` (which would produce a mangled blob URL route).

## Verification

- **Pyodide (Node.js):** `node test_pyodide.mjs` → `status=success` in ~16s
- **Native Python:** `pytest tests/model/test_mock_model_llm.py` → 9/9 passed, 0 regressions
- **Lint:** `ruff check` clean
- **Production diff:** Only 6 files changed outside `_pyodide/` (all lazy import improvements)

## How to test

### Headless (Node.js)

```bash
cd src/inspect_ai/_pyodide
npm install pyodide@0.27.5
node test_pyodide.mjs
```

### Browser (manual)

```bash
cd src/inspect_ai/_pyodide
python bundle.py --output-dir /tmp/pyodide_bundle
cd /tmp/pyodide_bundle && python -m http.server 37575
# Open http://localhost:37575 in Chrome (needs WebGPU — Chrome 113+)
# Select a model and sample count, click "Run Eval with WebLLM"
# After completion, Inspect View loads inline in an iframe
```

### Headless browser (Playwright)

`test_webllm.py` builds the static bundle, serves it, and runs the full eval in headless Chromium with WebGPU. `screenshot.py` does the same but captures a screenshot instead.

**WebLLM test:**

```bash
cd src/inspect_ai/_pyodide
uv run python test_webllm.py
```

**Screenshot tool:**

```bash
cd src/inspect_ai/_pyodide

# Screenshot the landing page only (fast, ~3 s)
python screenshot.py -o /tmp/landing.png

# Run the eval and screenshot the result with Inspect View (~2 min)
python screenshot.py --wait-for-eval -o /tmp/result.png

# High-resolution (2x) with browser console output
python screenshot.py --wait-for-eval --scale 2 --console-log -o /tmp/hires.png
```

**One-time Playwright setup:**

```bash
uv pip install playwright
uv run python -m playwright install chromium
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--wait-for-eval` | off | Click "Run Eval" and wait for Inspect View iframe |
| `-o` / `--output` | `screenshot.png` | Output path |
| `--timeout` | 300 | Max seconds to wait for eval |
| `--width` | 1280 | Viewport width |
| `--height` | 900 | Viewport height |
| `--scale` | 1.0 | Device scale factor (2.0 for retina-like) |
| `--console-log` | off | Print browser console messages to stdout |

## Next steps

### Short-term

- **More test coverage:** Run a broader set of pytest suites natively to catch regressions in less-common code paths (e.g. scoring, solvers, dataset loading).
- **Pyodide CI:** Add a GitHub Actions job that runs `test_pyodide.mjs` to catch future import breakage.

### Medium-term

- **Build a proper wheel:** Instead of writing raw .py files to the virtual FS, build a pure-Python `.whl` (excluding C extensions) that micropip can install directly.
- **Handle more import paths:** Some features (sandboxes, MCP tools, Docker) will hit additional blockers if invoked. Guard or stub them as needed.

### Long-term

- **WASM sandbox environment:** A lightweight sandbox that runs tool code in a separate WASM context, enabling tool use in browser evals.
- **Persistent storage:** Use IndexedDB or the Origin Private File System for log persistence across browser sessions.
- **Deeper View integration:** The View is now embedded inline via iframe + blob URL. A tighter integration could embed the eval runner directly in the View UI.

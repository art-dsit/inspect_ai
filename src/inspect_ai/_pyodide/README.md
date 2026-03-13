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

## Approach: conditional imports with fallbacks

Add `try/except ImportError` guards or `sys.platform == "emscripten"` checks around each blocker, providing lightweight fallbacks. All changes are backward-compatible — native Python is unaffected.

## Completed work

All changes are on the `pyodide-support` branch.

### Import guards (C extensions / unavailable modules)

| File | Change |
|------|--------|
| `_util/_async.py` | `nest_asyncio2` → try/except; `init_nest_asyncio()` no-ops when unavailable |
| `_util/hash.py` | `mmh3` → try/except; falls back to `hashlib.blake2s` |
| `model/_message_ids.py` | `mmh3` → try/except; falls back to `hashlib.blake2s` |
| `_util/appdirs.py` | `platformdirs` → gated on `sys.platform`; falls back to `/tmp`-based paths |
| `_util/file.py` | `s3fs` → try/except |
| `_util/asyncfiles.py` | `boto3`/`aiobotocore`/`botocore` → try/except; `TransferConfig` guarded |
| `log/_recorders/buffer/database.py` | `psutil` → try/except |
| `model/_tokens.py` | `tiktoken` → try/except; falls back to `len(text) // 4` estimate |
| `util/_console.py` | `readline` → try/except (removed from Pyodide stdlib) |
| `log/__init__.py` | `zipfile_zstd` → try/except |

### Lazy imports (break eager import chains)

| File | Change |
|------|--------|
| `_display/core/active.py` | All four display backends lazy-imported inside `display()` |
| `_display/core/display.py` | `rich`/`Console` moved to `TYPE_CHECKING`; lazy import in `input_screen()` |
| `_util/logger.py` | Split `LogHandler` into rich-based (normal) and stdlib-based (Emscripten) variants |
| `util/_panel.py` | `textual.containers.Container` gated on `sys.platform`; stub base class for Emscripten |
| `approval/_human/approver.py` | `panel_approval` import moved inside function body |
| `agent/_human/agent.py` | `HumanAgentPanel` import moved inside function body |
| `__init__.py` | `view` made lazy via `__getattr__`; `__version__` has fallback for missing metadata |
| `_view/view.py` | `psutil` moved inside `view_acquire_port()` |
| `_util/platform.py` | Added `is_emscripten()` utility |

### Demo / test infrastructure

| File | Purpose |
|------|---------|
| `_pyodide/demo.html` | Browser demo — loads Pyodide, installs deps, writes source to virtual FS, runs popularity eval (100 samples), serializes log, and displays results in an embedded Inspect View iframe via blob URL |
| `_pyodide/serve.py` | Threaded local dev server — serves demo.html, `/inspect_ai_source.json` (all .py + data files as JSON), and `/view/*` (Inspect View UI assets) |
| `_pyodide/test_pyodide.mjs` | Headless Node.js test — same flow as demo.html, no browser needed |
| `_pyodide/screenshot.py` | Headless Playwright screenshot utility — starts serve.py, opens demo in headless Chromium, optionally runs eval, saves screenshot. Designed for AI agent iteration loops (see "How to test" below) |

### Inspect View integration

After an eval completes, the demo serializes the eval log JSON and passes it directly to Inspect View via a blob URL — no server round-trip. The JSON is wrapped in a `Blob`, a `blob:` URL is created with `URL.createObjectURL()`, and the View is loaded in an inline iframe with `?log_file=<blob_url>`. The View's `fetch()` natively supports blob URLs. Key details:

- **Log serialization** uses `_read_log_from_bytes()` (synchronous `zipfile`) to avoid `asyncio.run()` and thread-spawning failures in Pyodide's single-threaded Emscripten environment.
- **LazyList avoidance:** code never accesses `EvalLog.samples` or `.reductions` directly, since `LazyList.__bool__`/`__len__`/`__iter__` all trigger `asyncio.run()`.
- **Blob URL handling:** `encodePathParts()` in `uri.ts` skips blob URLs to avoid mangling their opaque path structure.
- **Single-file mode navigation fix:** In the View's single-file mode (used by the iframe), the home icon is hidden (no meaningful destination), `LogViewContainer` skips its `unloadLog` cleanup on unmount (the blob-loaded log must stay in the store), and `LogSampleDetailView` navigates to the hash root `/` instead of `logsUrl()` (which would produce a mangled blob URL route). This lets users click into a sample and back out without errors.

### Verification

- **Pyodide (Node.js):** `node test_pyodide.mjs` → `status=success` in ~12s
- **Native Python:** `pytest tests/model/test_mock_model_llm.py` → 9/9 passed, 0 regressions
- **Lint:** `ruff check` clean
- **Format:** `ruff format` clean

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
python serve.py
# Open http://localhost:8080 in Chrome
# Click "Run Eval" — runs popularity (100 samples) with mockllm
# After completion, Inspect View loads inline in an iframe
```

### Headless browser (Playwright — for AI agents)

`screenshot.py` launches serve.py, opens the demo in headless Chromium via [Playwright](https://playwright.dev/python/), optionally runs the eval, and saves a full-page screenshot. This lets AI coding agents (Claude Code, etc.) iterate on the demo visually without a real browser window.

**One-time setup:**

```bash
pip install playwright            # Python bindings
playwright install chromium       # Download headless Chromium
playwright install-deps chromium  # System libraries (needs sudo/root)
```

**Usage:**

```bash
cd src/inspect_ai/_pyodide

# Screenshot the landing page only (fast, ~3 s)
python screenshot.py -o /tmp/landing.png

# Run the eval and screenshot the result with Inspect View (~2 min)
python screenshot.py --wait-for-eval -o /tmp/result.png

# High-resolution (2x) with browser console output
python screenshot.py --wait-for-eval --scale 2 --console-log -o /tmp/hires.png
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

**Typical agent workflow:** make a change to `demo.html` or View code, rebuild the View (`cd _view/www && npx yarn build`), run `screenshot.py --wait-for-eval`, then read the screenshot to verify the result. The iframe content (Inspect View) can also be inspected programmatically via `page.evaluate()` on the iframe's `contentDocument` (same-origin).

## Next steps

### Short-term

- **More test coverage:** Run a broader set of pytest suites natively to catch regressions in less-common code paths (e.g. scoring, solvers, dataset loading).
- **Pyodide CI:** Add a GitHub Actions job that runs `test_pyodide.mjs` to catch future import breakage.
- **Clean up demo deps:** Audit which micropip packages are actually needed vs. transitively pulled. Consider generating the dep list from pyproject.toml.

### Medium-term

- **WebLLM model provider:** Add a model provider that uses [WebLLM](https://webllm.mlc.ai/) to run small LLMs entirely in the browser via WebGPU. This would allow real (not mocked) evals without any server.
- **Build a proper wheel:** Instead of writing raw .py files to the virtual FS, build a pure-Python `.whl` (excluding C extensions) that micropip can install directly.
- **Handle more import paths:** Some features (sandboxes, MCP tools, Docker) will hit additional blockers if invoked. Guard or stub them as needed.

### Long-term

- **WASM sandbox environment:** A lightweight sandbox that runs tool code in a separate WASM context, enabling tool use in browser evals.
- **Persistent storage:** Use IndexedDB or the Origin Private File System for log persistence across browser sessions.
- **Deeper View integration:** The View is now embedded inline via iframe + blob URL. A tighter integration could embed the eval runner directly in the View UI.

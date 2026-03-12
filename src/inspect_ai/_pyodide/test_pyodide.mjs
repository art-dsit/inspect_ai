/**
 * Headless test of inspect_ai in Pyodide (Node.js, no browser needed).
 * Replicates what demo.html does: load Pyodide, install deps, write source, run eval.
 */

import { loadPyodide } from "pyodide";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Collect all .py files under src/inspect_ai/
function collectSourceFiles(rootDir) {
  const files = {};
  const skip = new Set(["__pycache__", "node_modules", ".venv", "_pyodide"]);

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.name.endsWith(".egg-info")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".py")) {
        const rel = relative(join(rootDir, ".."), full); // relative to src/
        files[rel] = readFileSync(full, "utf-8");
      }
    }
  }
  walk(rootDir);
  return files;
}

async function main() {
  const t0 = Date.now();

  console.log("[1/5] Loading Pyodide…");
  const pyodide = await loadPyodide();
  console.log(`       Done (${Date.now() - t0}ms)`);

  console.log("[2/5] Installing dependencies…");
  await pyodide.loadPackage(["micropip", "pydantic", "numpy", "sqlite3", "pygments", "rich", "zstandard", "regex"]);
  const micropip = pyodide.pyimport("micropip");
  await micropip.install([
    "anyio",
    "sniffio",
    "docstring-parser",
    "jsonlines",
    "jsonpatch",
    "jsonpath-ng",
    "jsonref",
    "jsonschema",
    "python-dotenv",
    "pyyaml",
    "semver",
    "shortuuid",
    "tenacity",
    "typing_extensions",
    "httpx",
    "click",
    "beautifulsoup4",
    "fsspec",
    "ijson",
    "zipp",
    "python-dateutil",
    "markdown-it-py",
    "mdurl",
    "httpcore",
    "h11",
    "certifi",
    "idna",
    "charset-normalizer",
    "docstring-parser",
    "jsonpatch",
    "jsonpointer",
    "jsonpath-ng",
    "ply",
  ]);
  console.log(`       Done (${Date.now() - t0}ms)`);

  console.log("[3/5] Collecting source files…");
  const packageRoot = join(__dirname, "..");  // src/inspect_ai/
  const sourceFiles = collectSourceFiles(packageRoot);
  console.log(`       Collected ${Object.keys(sourceFiles).length} .py files`);

  console.log("[4/5] Writing source into Pyodide virtual FS…");
  const sitePackages = pyodide.runPython(`
import site, sys
paths = site.getsitepackages()
paths[0] if paths else sys.prefix + '/lib/python' + '.'.join(map(str, sys.version_info[:2])) + '/site-packages'
  `);

  let written = 0;
  for (const [relPath, content] of Object.entries(sourceFiles)) {
    const fullPath = `${sitePackages}/${relPath}`;
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    // Ensure directory exists
    pyodide.runPython(`
import os
os.makedirs(${JSON.stringify(dir)}, exist_ok=True)
    `);
    pyodide.FS.writeFile(fullPath, content);
    written++;
  }
  console.log(`       Wrote ${written} files to ${sitePackages}`);

  // Create minimal package metadata so importlib.metadata.version("inspect_ai") works
  pyodide.runPython(`
import os
dist_info = "${sitePackages}/inspect_ai-0.0.0.dev0.dist-info"
os.makedirs(dist_info, exist_ok=True)
with open(os.path.join(dist_info, "METADATA"), "w") as f:
    f.write("Metadata-Version: 2.1\\nName: inspect_ai\\nVersion: 0.0.0.dev0\\n")
with open(os.path.join(dist_info, "RECORD"), "w") as f:
    f.write("")
  `);

  console.log("[5/5] Running eval with mockllm…");
  try {
    const result = await pyodide.runPythonAsync(`
import os, sys
os.environ["INSPECT_LOG_DIR"] = "/tmp/inspect_logs"
os.environ["INSPECT_DISPLAY"] = "none"
os.environ.setdefault("INSPECT_LOG_LEVEL", "warning")

from inspect_ai import Task, eval_async
from inspect_ai.dataset import Sample
from inspect_ai.scorer import includes
from inspect_ai.solver import generate

task = Task(
    dataset=[Sample(input="What is 2+2?", target="4")],
    solver=[generate()],
    scorer=includes(),
)

results = await eval_async(task, model="mockllm/model", display="none")
r = results[0]
status = r.status
scores = str(r.results.scores) if r.results else "None"
f"status={status}, scores={scores}"
    `);
    console.log("");
    console.log("=== RESULT ===");
    console.log(result);
    console.log(`\nTotal time: ${Date.now() - t0}ms`);
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}

main();

#!/usr/bin/env python3
"""Headless browser test of the WebLLM + Inspect AI demo.

Builds the static bundle via bundle.py, serves it with python -m http.server,
opens demo_webllm.html in headless Chromium with WebGPU enabled, runs the eval,
and captures output.
"""

import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BUNDLE_SCRIPT = Path(__file__).resolve().parent / "bundle.py"


def main() -> None:
    # Build the static bundle into a temp directory
    with tempfile.TemporaryDirectory() as tmpdir:
        bundle_dir = Path(tmpdir) / "bundle"
        print(f"Building bundle into {bundle_dir}...")
        subprocess.run(
            [sys.executable, str(BUNDLE_SCRIPT), "--output-dir", str(bundle_dir)],
            check=True,
        )

        # Start a static file server on the bundle directory
        server = subprocess.Popen(
            [sys.executable, "-m", "http.server", "37575", "--bind", "127.0.0.1"],
            cwd=str(bundle_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        time.sleep(2)

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    headless=True,
                    args=[
                        "--enable-unsafe-webgpu",
                        "--enable-features=Vulkan",
                        "--use-angle=vulkan",
                        "--enable-gpu",
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--enable-dawn-features=allow_unsafe_apis",
                    ],
                )
                context = browser.new_context(viewport={"width": 1280, "height": 900})
                page = context.new_page()

                # Collect console messages
                console_messages = []
                page.on("console", lambda msg: (
                    console_messages.append(f"[{msg.type}] {msg.text}"),
                    print(f"  BROWSER [{msg.type}]: {msg.text}"),
                ))
                page.on("pageerror", lambda err: print(f"  BROWSER ERROR: {err}"))

                print("Loading demo page...")
                page.goto("http://127.0.0.1:37575/")
                page.wait_for_load_state("networkidle")

                # Check if WebGPU is available
                has_webgpu = page.evaluate("!!navigator.gpu")
                print(f"WebGPU available: {has_webgpu}")

                if not has_webgpu:
                    print("WebGPU not available in headless Chrome on this machine.")
                    print("Checking GPU adapter...")
                    adapter_info = page.evaluate("""
                        async () => {
                            if (!navigator.gpu) return 'no navigator.gpu';
                            try {
                                const adapter = await navigator.gpu.requestAdapter();
                                if (!adapter) return 'no adapter';
                                const info = await adapter.requestAdapterInfo();
                                return JSON.stringify(info);
                            } catch (e) {
                                return 'error: ' + e.message;
                            }
                        }
                    """)
                    print(f"Adapter info: {adapter_info}")
                    page.screenshot(path="/tmp/webllm_no_webgpu.png", full_page=True)
                    print("Screenshot saved to /tmp/webllm_no_webgpu.png")
                    browser.close()
                    return

                # Select default model (Qwen3-0.6B, no shader-f16 needed)
                page.select_option("#model-select", "Qwen3-0.6B-q4f32_1-MLC")
                page.select_option("#sample-limit", "5")

                print("Clicking Run Eval...")
                page.click("#run")

                # Wait for completion — this could take a while (model download + eval)
                print("Waiting for eval to complete (timeout: 10 min)...")
                try:
                    page.wait_for_function(
                        """() => document.getElementById('status').textContent.includes('RESULT')
                            || document.getElementById('status').textContent.includes('ERROR')""",
                        timeout=600_000,
                    )
                except Exception as e:
                    print(f"Timeout or error waiting for result: {e}")

                # Get status text
                status_text = page.evaluate("document.getElementById('status').textContent")
                print("\n=== STATUS OUTPUT ===")
                print(status_text)

                page.screenshot(path="/tmp/webllm_result.png", full_page=True)
                print("\nScreenshot saved to /tmp/webllm_result.png")

                browser.close()

        finally:
            server.terminate()
            server.wait()


if __name__ == "__main__":
    main()

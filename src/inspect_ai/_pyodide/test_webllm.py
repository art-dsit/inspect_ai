#!/usr/bin/env python3
"""Headless browser test of the WebLLM + Inspect AI demo.

Starts serve.py, opens demo_webllm.html in headless Chromium with WebGPU enabled,
runs the eval, and captures output.
"""

import subprocess
import sys
import time

from playwright.sync_api import sync_playwright


def main() -> None:
    # Start the dev server
    server = subprocess.Popen(
        [sys.executable, "serve.py", "--port", "8091"],
        cwd="/home/ubuntu/src/inspect_ai/src/inspect_ai/_pyodide",
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
            page.goto("http://127.0.0.1:8091/webllm")
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
                # Take screenshot anyway
                page.screenshot(path="/tmp/webllm_no_webgpu.png", full_page=True)
                print("Screenshot saved to /tmp/webllm_no_webgpu.png")
                browser.close()
                return

            # Select a model that doesn't need shader-f16
            page.select_option("#model-select", "SmolLM2-360M-Instruct-q4f32_1-MLC")
            page.select_option("#sample-limit", "5")

            print("Clicking Run Eval...")
            page.click("#run")

            # Wait for completion — this could take a while (model download + eval)
            # Look for "=== RESULT ===" in the status div
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

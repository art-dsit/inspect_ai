"""Headless browser screenshot utility for iterating on the Pyodide demo.

Usage:
    python screenshot.py [--wait-for-eval] [--output screenshot.png]

Starts serve.py in the background, launches headless Chromium via Playwright,
navigates to the demo, optionally waits for the eval to complete, and saves
a full-page screenshot.
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Screenshot the Pyodide demo")
    parser.add_argument(
        "--wait-for-eval",
        action="store_true",
        help="Click 'Run Eval' and wait for completion before screenshotting",
    )
    parser.add_argument(
        "--output", "-o",
        default="screenshot.png",
        help="Output screenshot path (default: screenshot.png)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Max seconds to wait for eval completion (default: 300)",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=1280,
        help="Viewport width (default: 1280)",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=900,
        help="Viewport height (default: 900)",
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=1.0,
        help="Device scale factor (default: 1.0, use 2.0 for retina-like)",
    )
    parser.add_argument(
        "--console-log",
        action="store_true",
        help="Print browser console messages to stdout",
    )
    args = parser.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: playwright not importable. Install with: pip install playwright")
        sys.exit(1)

    # Start the dev server
    server_proc = subprocess.Popen(
        [sys.executable, "serve.py"],
        cwd=Path(__file__).parent,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        # Give the server a moment to start
        time.sleep(2)

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(
                viewport={"width": args.width, "height": args.height},
                device_scale_factor=args.scale,
            )

            if args.console_log:
                page.on("console", lambda msg: print(f"  [browser {msg.type}] {msg.text}"))

            print("Navigating to http://localhost:8080 ...")
            page.goto("http://localhost:8080", wait_until="networkidle")

            if args.wait_for_eval:
                print("Clicking 'Run Eval' ...")
                page.click("button")

                print(f"Waiting for eval to complete (timeout: {args.timeout}s) ...")
                # Wait for the iframe to appear (signals eval completion + View loaded)
                page.wait_for_selector("iframe[style*='block']", timeout=args.timeout * 1000)
                # Give the iframe content time to render
                time.sleep(5)

            # Take screenshot
            output_path = Path(args.output)
            page.screenshot(path=str(output_path), full_page=True)
            print(f"Screenshot saved to {output_path}")

            browser.close()

    finally:
        server_proc.terminate()
        server_proc.wait(timeout=5)


if __name__ == "__main__":
    main()

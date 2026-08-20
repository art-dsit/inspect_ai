#!/usr/bin/env python3
"""Check every quiz excerpt against the source files it claims to quote.

Run from the repo root: python3 adversarial-agent-quiz/check-excerpts.py

A numbered excerpt row plus any continuation rows ("  |") that soft-wrap it must
reproduce the source line: "..." marks an elision, and the text may run past the
end of the line it is numbered with (the overflow lands on following lines, which
carry no number of their own and so cannot be checked). A blank continuation row
ends a wrap group.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = Path(__file__).resolve().parent / "app.js"

# The terminating backtick must not be an escaped one — excerpt rows quote
# backticks out of docstrings.
BLOCK = re.compile(
    r'route: "([^"]+)",.*?file: "([^"]+)",\n\s*lines: "[^"]*",\n\s*code: `\n(.*?)(?<!\\)`,\n',
    re.S,
)


def resolve(path: str, previous: Path | None) -> Path | None:
    """Map a path as displayed in the chrome bar onto a file in the tree.

    Two display conveniences have to be undone: a path abbreviated with "..."
    (matched by globbing its tail), and a bare filename in a second `file:`
    entry (a sibling of the first).
    """
    if "..." in path:
        matches = list(ROOT.glob("**/" + path.split(".../")[-1]))
        return matches[0] if len(matches) == 1 else None
    if "/" not in path and previous is not None:
        return previous.parent / path
    return ROOT / path


def matches(text: str, line: str) -> bool:
    """Does an excerpt (a numbered row plus its wrapped continuations) quote this
    source line? Fragments split on "..." must appear in order; the excerpt is
    allowed to overrun the end of the line."""
    pieces = text.split("...")
    pos = 0
    for i, fragment in enumerate(pieces):
        # the elision marker is usually written with a space either side of it
        fragment = fragment.rstrip() if i == 0 else fragment.strip()
        if pos >= len(line):
            return True
        start = 0 if i == 0 else line.find(fragment, pos)
        if start < 0 or not line.startswith(fragment, start):
            return fragment.startswith(line[pos:]) and bool(line[pos:])
        pos = start + len(fragment)
    return pos == len(line) or text.endswith("...")


SUBMODULE = "src/inspect_ai/_view/ts-mono"


def sources(files: str) -> list[list[str] | None]:
    out: list[list[str] | None] = []
    resolved: Path | None = None
    for path in (f.strip() for f in files.split("·")):
        resolved = resolve(path, resolved)
        if resolved is None:
            print(f"  cannot resolve {path}")
            out.append(None)
            continue
        try:
            out.append(resolved.read_text().split("\n"))
        except OSError as ex:
            print(f"  cannot open {path}: {ex}")
            out.append(None)
    return out


def main() -> int:
    failures = 0
    skipped = 0
    ts_mono_present = any((ROOT / SUBMODULE).glob("*"))
    for route, files, code in BLOCK.findall(APP.read_text()):
        srcs = sources(files)
        if any(s is None for s in srcs):
            # Nothing here is checkable, and the rows from the file we do have
            # would be reported as mismatches against the wrong source.
            skipped += 1
            print(f"{route}: SKIPPED — a source file could not be read")
            if not ts_mono_present:
                print(f"  ts-mono is a submodule: git submodule update --init {SUBMODULE}")
            continue
        excerpts: list[list] = []
        wrapping = False
        for row in code.replace("\\`", "`").split("\n"):
            num, _, text = (row[1:] if row.startswith(">") else row).partition("|")
            text = text.rstrip()
            if num.strip().isdigit():
                excerpts.append([int(num), text])
                wrapping = True
            elif not text.strip():
                wrapping = False
            elif wrapping:
                excerpts[-1][1] += " " + text.strip()

        bad = []
        for n, text in excerpts:
            if not any(
                lines and n <= len(lines) and matches(text, lines[n - 1].rstrip())
                for lines in srcs
            ):
                bad.append((n, text, [lines[n - 1] for lines in srcs if lines and n <= len(lines)]))
        if bad:
            failures += len(bad)
            print(f"{route} — {files}")
            for n, text, actual in bad:
                print(f"  line {n}\n    excerpt: {text!r}")
                for a in actual:
                    print(f"    actual : {a!r}")
        else:
            print(f"{route}: ok")
    tail = f", {skipped} block{'s' if skipped != 1 else ''} skipped" if skipped else ""
    print(f"\n{failures} mismatched rows{tail}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

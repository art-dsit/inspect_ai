# Adversarial-agent quiz — development notes

A working doc for continuing the interactive quiz in this directory. Read this
before editing `app.js` / `index.html` / `styles.css`.

## What this is

An interactive multiple-choice quiz website that gently walks a developer with
**no prior Inspect knowledge** around the Inspect codebase. The goal is a
**generalised mental model of the tree** — each question lands in a different
subsystem. Security is the *lens*, not the subject: "who holds the authority at
this boundary" is used because it is the fastest way to make a subsystem's
design legible, not because the quiz is a vulnerability tour.

The two source reviews supply the surfaces and the vocabulary:

- `../adversarial-agent-attack-types.md` — organised by attack class.
- `../adversarial-agent-security-surface-review.md` — organised by the Inspect
  component/boundary under attack. Uses labels **Observed / Conditional /
  Possible / Existing control**.

Labels shown on the answer panel extend that set with **Foundation**,
**Architecture** and **By design** (an explicit evaluator grant — e.g. bridged
host tools, the bridge endpoint, a published sandbox service). Do not label a
deliberate grant as a risk; several of these questions exist precisely to
teach the difference between a grant, a condition and a defect.

## Hard constraints (do not regress these)

- **Runs from local files in VS Code.** Open `index.html` directly (`file://`).
  No server, no build step, no network, no dependencies, no `fetch`, no
  `localStorage`/`sessionStorage`.
- **Single self-contained trio**: `index.html`, `styles.css`, `app.js`. Keep it
  that way.
- Questions are defined as data in `app.js`; the render/flow logic is generic.
  Add a question by adding a data entry, not by touching flow code.

## Navigation state

Position lives in the URL fragment (`#04-lifecycle`, plus `#welcome` and
`#summary`), written by `render()` and read by `routeFromHash()`. It has to be
the fragment: `history.pushState()` throws on `file://`, where the document's
origin is `null`. `routeFromHash()` is idempotent, so the `hashchange` that our
own writes provoke is a no-op — that is what makes Back/Forward work without a
re-entrancy flag. `#14` and `#mcp` are accepted as shorthand and normalise to
`#14-mcp`; anything unrecognised falls back to the welcome screen.

Nothing else is persisted (no storage APIs), so a reload resets the score. The
summary says so rather than showing a tally that quietly excludes the questions
you answered before the reload — `attempts` counts answers given since load, and
only `attempts === TOTAL` gets the "N of 21" sentence. Reordering questions
changes the fragments, so any links people have saved point elsewhere.

## Layout

Three width bands in `styles.css`: base (up to 1499px), `min-width: 1500px`
(1440px container), `min-width: 2000px` (1680px container, type one step
larger), plus the existing `max-width: 940px` single-column fallback. The
container stops growing at 1680 — past that, extra width only lengthens the
lines you have to read.

Two things to preserve when editing widths:

- The header's horizontal padding is `max(28px, calc((100% - <container>) / 2))`
  so the brand and the content share a left edge. Change one, change the other.
- Prose measure is capped separately from the column (`.brief p`, `.task p`,
  `details p` at 76ch) so the article can grow wide for code excerpts without
  the paragraphs following it. The question column is capped by `minmax()`
  rather than `fr` for the same reason.

## Tone and pedagogy (the bar to hold)

- **Gentle, plain, beginner-facing.** Full sentences, warm and encouraging.
  Assume the reader has never seen Inspect. Introduce each term before using it.
- **No jargon-y chrome.** Avoid terse all-caps labels, shorthand tags, arrow
  chains, and instructions phrased as commands to the reader's reasoning
  ("predict", "trace the branches", "enumerate"). Ask plainly what the code does
  and why it matters.
- **Logical sequence, not a grab-bag.** Each question builds on the previous
  one. Follow one agent request outward from its first command to the final
  score.
- **Difficulty ramps up.** Q1 orients; later questions require reading and
  reasoning about real code.
- **Every question earns its answer.** After answering, explain *why* — and
  preserve the review's confidence distinction (Observed vs Conditional vs
  Possible). Don't present hypotheses as confirmed vulnerabilities.
- **Hints point at where to look** (a file/symbol) and how to think, without
  giving away the answer.

## The welcome diagram

The `<aside>` on the welcome screen names **four** places code runs: the
operator's browser, the Inspect process, the agent's sandbox, and the host the
sandbox runs on. An earlier version showed two (trusted process / hostile box)
and was wrong by omission — `inspect view` renders agent-authored text in a
browser that runs JavaScript, and a container sits on a node whose kernel,
runtime and disk are shared with other samples. HOST and BROWSER are the
questions that pay those two boxes off; if you redraw the diagram, keep them in
step.

## Current state — 21 questions, one per subsystem

Each row is a different part of the tree. The narrative thread is one agent
request followed outward from its first command to the number in your results
table; the last question deliberately returns to `scorer=includes()`, which the
first question's excerpt already showed.

Step numbers are **derived from array position** in `QUESTIONS` — `route` and
`stage` carry no numbers, so a question can be inserted mid-arc without
renumbering. Prose that refers to another question ("as you saw in step 6")
is hardcoded: grep for `step ` before reordering.

| # | Route | Code | Lesson | Label |
|---|-------|------|--------|-------|
| 01 | ORIENT | `examples/tool_use.py` | Task = data + solver + scorer + sandbox; tool bodies are host Python | Foundation |
| 02 | LOOP | `agent/_react.py` | `submit` is a tool like any other; its argument becomes the completion | Foundation |
| 03 | PROVIDERS | `util/_sandbox/registry.py` | Inspect owns the interface, the provider owns the isolation | Architecture |
| 04 | HOST | `util/_sandbox/docker/config.py` | Your compose file is used as-is; `network_mode: none` is only the generated default | Conditional |
| 05 | LIFECYCLE | `_eval/task/sandbox.py` | One sandbox per sample, created before the solver, torn down after | Architecture |
| 06 | LOCAL | `util/_sandbox/local.py` | `local` = host subprocess, same UID, `user` ignored | Observed |
| 07 | TRANSFER | `util/_sandbox/environment.py` | `exec` may truncate silently; `read_file` always raises | Observed |
| 08 | TOOLS | `inspect_sandbox_tools/_cli/server.py` | Injected binary + in-container server; `0o700` only when root | Conditional |
| 09 | CALLBACK | `util/_sandbox/service.py` | Inward RPC over a `1777` request directory | By design |
| 10 | CHECKPOINT | `util/_checkpoint/_sandbox_restic/egress.py` | Read cap lifted to `sys.maxsize`; `filter="data"` bounds paths, not size | Possible |
| 11 | MODELS | `model/_model.py` | Providers are plug-ins; keys resolve host-side via hooks | Existing control |
| 12 | HOOKS | `hooks/_hooks.py`, `_startup.py` | Host extension code, instantiated on import, may replace the API key | By design |
| 13 | BRIDGE | `agent/_bridge/sandbox/bridge.py`, `proxy.py` | In-container endpoint on 13131; reachability is the authorisation | By design |
| 14 | ROUTING | `agent/_bridge/util.py` | `resolve_inspect_model`: aliases first, fallback only sometimes | By design |
| 15 | MCP | `tool/_mcp/_local.py` | Tool names, descriptions and schemas fetched at runtime into context | Conditional |
| 16 | CONTROL | `approval/_apply.py` | Approval sees arguments; an allowlist sees names | Existing control |
| 17 | LIMITS | `util/_limit.py` | Eight budget types; `time`/`working` raise at the scope, not the call | Existing control |
| 18 | RECORD | `event/_sandbox.py` | Host-written events (provenance holds) truncated to 100 lines | Existing control |
| 19 | VIEWER | `_view/network.py` | Non-loopback binds refused without a token; content is still agent text | Existing control |
| 20 | BROWSER | `_view/network.py`, ts-mono `renderedHtmlSanitizer.ts` | DOMPurify allowlist is the control; the server's CSP only forbids framing | Existing control |
| 21 | SCORING | `scorer/_common.py`, `_match.py` | `target in completion` — containment ≠ a trustworthy number | Conditional |

Difficulty is non-decreasing: 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4,
4, 4, 5, 5.

Answer keys are spread A5 / B6 / C5 / D5 with no two adjacent questions sharing
one, so "always pick B" scores badly. Check the spread after adding a question:
`--eval "QUESTIONS.map(q=>'ABCD'[q.correct]).join('')"`.

Two things this version deliberately does **not** do, after review feedback:

- It does not present the bridged-host-tool `**arguments` path as a
  vulnerability. Bridging host tools into an eval is an explicit decision that
  they are not sandboxed. CONTROL keeps the useful half of that material —
  *which layer holds argument policy* — with no risk label.
- It does not spend multiple questions inside one subsystem. Breadth over
  depth: a reader should finish able to navigate the tree, not able to recite
  one finding.

## Not yet covered (candidate later questions)

Kept off the arc to hold breadth. The finish screen names these as where to go
next:

- The rest of `_eval/` and the task runner — retries, epochs, sample
  concurrency, what happens when a sample errors. LIFECYCLE only covers the
  per-sample sandbox bracket.
- `log/_recorders/` (eval/json/buffer/chunked) — RECORD covers event
  construction, not how the bytes land on disk or in S3.
- What samples sharing a host can do to each other (§27): shared caches, reused
  networks and ports, competition for host resources, stale cleanup. HOST names
  the shared node; nothing follows it up.
- The rest of the viewer frontend — BROWSER covers the sanitiser on the
  rendering path only.
- The browser and computer-use sidecars, which put a second untrusted surface
  (rendered web content) inside the sandbox.

## Verifying a change

1. `node --check app.js`.
2. `python3 check-excerpts.py` — every numbered excerpt row must still match the
   file it claims to quote (rows may be truncated or elided with `...`, and may
   soft-wrap onto `  |` continuation rows). This is what makes the welcome
   screen's "quoted from a real file, with real line numbers" promise true, so
   keep it at zero. Sanity-check it by perturbing a line number: it should fail.
   BROWSER quotes a file inside the `ts-mono` submodule, so it needs
   `git submodule update --init src/inspect_ai/_view/ts-mono` — without it that
   block reports SKIPPED rather than failing. Never commit a gitlink change.
3. Open `index.html` from `file://` and walk all 21, confirming answer keys.
   Check the fragment router too: reload mid-walk (same question), edit the
   fragment by hand, and press Back.
4. Check for excerpt overflow — every code block should fit without horizontal
   scroll, in all four width bands:
   `--eval "begin(); const pre=document.querySelector('.source pre'); QUESTIONS.map((q,i)=>{index=i;render();return (i+1)+':'+(pre.scrollWidth-pre.clientWidth)}).join(' ')"`
5. Confirm no network requests in devtools.

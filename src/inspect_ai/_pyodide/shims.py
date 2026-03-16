"""Pyodide stub module installer.

When executed in Pyodide (Emscripten), this module pre-populates sys.modules
with lightweight stubs for every native/unavailable dependency that inspect_ai
imports at module level.  This lets the rest of the codebase use normal
``import foo`` statements — the stubs are found first in sys.modules so no
try/except ImportError guards are needed in production code.

Usage (from JavaScript, before ``import inspect_ai``):

    pyodide.runPython("import inspect_ai._pyodide.shims")

The stubs are intentionally minimal: they satisfy import-time attribute access
but raise ``NotImplementedError`` (or return safe defaults) if actually called
in a code path that shouldn't execute in the browser.
"""

from __future__ import annotations

import hashlib
import sys
import types
from typing import Any


def _make_module(name: str, attrs: dict[str, Any] | None = None) -> types.ModuleType:
    """Create a stub module and register it in sys.modules."""
    mod = types.ModuleType(name)
    mod.__file__ = f"<pyodide-stub:{name}>"
    mod.__loader__ = None
    mod.__spec__ = None
    if attrs:
        for k, v in attrs.items():
            setattr(mod, k, v)
    sys.modules[name] = mod
    return mod


def _install_stubs() -> None:
    """Install all stub modules.  Safe to call multiple times."""
    if "mmh3" not in sys.modules:
        # mmh3 — hash64() fallback via blake2s
        def _hash64(data: bytes, signed: bool = True) -> tuple[int, int]:
            h = hashlib.blake2s(data, digest_size=16).digest()
            h1 = int.from_bytes(h[:8], "little")
            h2 = int.from_bytes(h[8:], "little")
            if signed:
                if h1 >= (1 << 63):
                    h1 -= 1 << 64
                if h2 >= (1 << 63):
                    h2 -= 1 << 64
            return (h1, h2)

        def _hash_bytes(data: bytes | str, *_args: Any, **_kwargs: Any) -> bytes:
            if isinstance(data, str):
                data = data.encode("utf-8")
            return hashlib.blake2s(data, digest_size=16).digest()

        _make_module("mmh3", {"hash64": _hash64, "hash_bytes": _hash_bytes})

    if "nest_asyncio2" not in sys.modules:
        # nest_asyncio2 — apply() is a no-op in Pyodide (already re-entrant)
        _make_module("nest_asyncio2", {"apply": lambda: None})

    if "platformdirs" not in sys.modules:
        # platformdirs — return /tmp-based paths
        from pathlib import Path

        def _user_cache_dir(appname: str = "", *_a: Any, **_kw: Any) -> str:
            return str(Path("/tmp") / appname / "cache")

        def _user_data_dir(appname: str = "", *_a: Any, **_kw: Any) -> str:
            return str(Path("/tmp") / appname / "data")

        def _user_cache_path(appname: str = "", *_a: Any, **_kw: Any) -> Path:
            return Path("/tmp") / appname / "cache"

        def _user_data_path(appname: str = "", *_a: Any, **_kw: Any) -> Path:
            return Path("/tmp") / appname / "data"

        _make_module(
            "platformdirs",
            {
                "user_cache_dir": _user_cache_dir,
                "user_data_dir": _user_data_dir,
                "user_cache_path": _user_cache_path,
                "user_data_path": _user_data_path,
            },
        )

    if "psutil" not in sys.modules:
        # psutil — enough surface for net_connections / Process / pid_exists

        class _Process:
            def __init__(self, pid: int | None = None) -> None:
                raise NotImplementedError("psutil.Process is not available in Pyodide")

        def _net_connections(*_a: Any, **_kw: Any) -> list[Any]:
            return []

        def _pid_exists(pid: int) -> bool:
            return False

        _make_module(
            "psutil",
            {
                "Process": _Process,
                "net_connections": _net_connections,
                "pid_exists": _pid_exists,
            },
        )

    if "tiktoken" not in sys.modules:
        # tiktoken — rough ~4 chars/token estimator

        class _FakeEncoding:
            def encode(self, text: str) -> list[int]:
                return list(range(len(text) // 4))

        def _get_encoding(name: str = "") -> _FakeEncoding:
            return _FakeEncoding()

        _make_module("tiktoken", {"get_encoding": _get_encoding})

    if "s3fs" not in sys.modules:
        # s3fs — S3FileSystem raises on instantiation

        class _S3FileSystem:
            def __init__(self, *_a: Any, **_kw: Any) -> None:
                raise NotImplementedError("S3 is not available in Pyodide")

        _make_module("s3fs", {"S3FileSystem": _S3FileSystem})

    # boto3 / aiobotocore / botocore — empty modules (never called in Pyodide)
    for mod_name in ("boto3", "aiobotocore", "botocore"):
        if mod_name not in sys.modules:
            _make_module(mod_name)
    # Sub-modules that are imported directly
    for sub in (
        "aiobotocore.config",
        "aiobotocore.response",
        "boto3.s3",
        "boto3.s3.transfer",
        "botocore.config",
    ):
        if sub not in sys.modules:
            mod = _make_module(sub)
            # Provide the specific names that production code imports
            if sub == "aiobotocore.config":
                mod.AioConfig = type("AioConfig", (), {})  # type: ignore[attr-defined]
            elif sub == "aiobotocore.response":
                mod.StreamingBody = type("StreamingBody", (), {})  # type: ignore[attr-defined]
            elif sub == "boto3.s3.transfer":
                mod.TransferConfig = type(  # type: ignore[attr-defined]
                    "TransferConfig",
                    (),
                    {"__init__": lambda self, **kw: None},
                )
            elif sub == "botocore.config":
                mod.Config = type("Config", (), {})  # type: ignore[attr-defined]

    if "textual" not in sys.modules:
        # textual + textual.containers — empty Container class
        _make_module("textual")

    if "textual.containers" not in sys.modules:

        class _Container:
            def __init__(self, *_a: Any, **_kw: Any) -> None:
                pass

        _make_module("textual.containers", {"Container": _Container})

    if "zipfile_zstd" not in sys.modules:
        # zipfile_zstd — just needs to be importable
        _make_module("zipfile_zstd")

    if "readline" not in sys.modules:
        # readline — empty module
        _make_module("readline")


# Auto-install stubs on import
_install_stubs()

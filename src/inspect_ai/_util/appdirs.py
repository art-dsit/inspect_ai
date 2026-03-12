import sys
from pathlib import Path

if sys.platform == "emscripten":
    from typing import Callable

    def _emscripten_path_factory(subdir: str) -> Callable[[str], Path]:
        def _path(appname: str) -> Path:
            return Path("/tmp") / appname / subdir

        return _path

    user_cache_path: Callable[..., Path] = _emscripten_path_factory("cache")
    user_data_path: Callable[..., Path] = _emscripten_path_factory("data")
else:
    from platformdirs import user_cache_path, user_data_path

from inspect_ai._util.constants import PKG_NAME


def inspect_data_dir(subdir: str | None) -> Path:
    return package_data_dir(PKG_NAME, subdir)


def package_data_dir(package_name: str, subdir: str | None) -> Path:
    data_dir = user_data_path(package_name)
    if subdir:
        data_dir = data_dir / subdir
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def inspect_cache_dir(subdir: str | None) -> Path:
    cache_dir = user_cache_path(PKG_NAME)
    if subdir:
        cache_dir = cache_dir / subdir
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir

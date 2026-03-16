import sys
from contextvars import ContextVar

from inspect_ai.util._display import display_type

from .display import Display, TaskScreen

_active_display: Display | None = None


def active_display() -> Display | None:
    global _active_display
    return _active_display


def display() -> Display:
    global _active_display
    if _active_display is None:
        dtype = display_type()
        if dtype == "log":
            from ..log.display import LogDisplay

            _active_display = LogDisplay()
        elif dtype == "plain":
            from ..plain.display import PlainDisplay

            _active_display = PlainDisplay()
        elif dtype == "full" and sys.stdout.isatty():
            import rich

            if not rich.get_console().is_jupyter:
                from ..textual.display import TextualDisplay

                _active_display = TextualDisplay()
            else:
                from ..rich.display import RichDisplay

                _active_display = RichDisplay()
        else:
            from ..rich.display import RichDisplay

            _active_display = RichDisplay()

    return _active_display


def task_screen() -> TaskScreen:
    screen = _active_task_screen.get(None)
    if screen is None:
        raise RuntimeError(
            "console input function called outside of running evaluation."
        )
    return screen


def init_task_screen(screen: TaskScreen) -> None:
    _active_task_screen.set(screen)


def clear_task_screen() -> None:
    _active_task_screen.set(None)


_active_task_screen: ContextVar[TaskScreen | None] = ContextVar(
    "task_screen", default=None
)

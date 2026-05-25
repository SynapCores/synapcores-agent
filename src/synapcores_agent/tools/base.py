"""Tool base classes."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass
class ToolResult:
    """The output of running a tool."""

    summary: str  # short, human-readable line for the trace
    payload: Any = None  # structured result (rows, text, ...)
    grounding: str = ""  # text to feed into the final GENERATE prompt


class Tool:
    """Base class for an agent tool.

    Subclasses set ``name`` and ``description`` (the description is what the
    semantic router matches the user's request against) and implement ``run``.
    """

    name: str = "tool"
    description: str = ""

    def run(self, query: str, brain, ctx: Dict[str, Any]) -> ToolResult:  # noqa: ANN001
        raise NotImplementedError

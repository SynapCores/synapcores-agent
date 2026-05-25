"""Agent tools.

A tool is just a callable with a name, a natural-language description (used by
the semantic router), and an ``run(query, brain, ctx)`` method. Tools are the
agent's hands; the brain is what they reach into.
"""

from .base import Tool, ToolResult
from .support_tools import (
    DraftReplyTool,
    SearchKnowledgeBaseTool,
    SimilarTicketsTool,
    default_tools,
)

__all__ = [
    "Tool",
    "ToolResult",
    "SearchKnowledgeBaseTool",
    "SimilarTicketsTool",
    "DraftReplyTool",
    "default_tools",
]

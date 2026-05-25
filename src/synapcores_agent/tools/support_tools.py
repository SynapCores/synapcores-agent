"""The customer-support agent's concrete tools.

Three real tools, each backed by a verified SynapCores surface:

  1. ``search_knowledge_base`` — semantic KB search          (recipe: rag-ground-any-agent)
  2. ``find_similar_tickets``  — episodic recall of past fixes (recipe: agentic-memory)
  3. ``draft_reply``           — grounded GENERATE             (recipe: customer-support-agent)
"""

from __future__ import annotations

from typing import Any, Dict, List

from .base import Tool, ToolResult


def _format_docs(docs: List[Dict[str, Any]]) -> str:
    lines = []
    for d in docs:
        title = d.get("title") or d.get("subject") or "doc"
        body = d.get("body") or d.get("resolution") or d.get("problem") or ""
        score = d.get("score")
        score_s = f" (score {score:.2f})" if isinstance(score, (int, float)) else ""
        lines.append(f"- {title}{score_s}: {body}")
    return "\n".join(lines)


class SearchKnowledgeBaseTool(Tool):
    name = "search_knowledge_base"
    description = (
        "How-to questions, instructions, settings, billing, refunds, policies, "
        "account setup, exporting data, plans, pricing, and documentation. Use "
        "when the customer asks how to do something or wants information."
    )

    def run(self, query: str, brain, ctx: Dict[str, Any]) -> ToolResult:
        docs = brain.search_kb(query, k=3)
        if not docs:
            return ToolResult(summary="KB: no relevant articles found.")
        grounding = "Knowledge base articles:\n" + _format_docs(docs)
        return ToolResult(
            summary=f"KB: found {len(docs)} relevant article(s).",
            payload=docs,
            grounding=grounding,
        )


class SimilarTicketsTool(Tool):
    name = "find_similar_tickets"
    description = (
        "Something is broken or failing: an error message, a crash, a bug, "
        "cannot log in, password rejected, locked out, double charged, missing "
        "email. Use to recall how a similar past incident was resolved."
    )

    def run(self, query: str, brain, ctx: Dict[str, Any]) -> ToolResult:
        tickets = brain.find_similar_tickets(query, k=3)
        if not tickets:
            return ToolResult(summary="Tickets: no similar past tickets found.")
        grounding = "Similar past tickets and how they were resolved:\n" + _format_docs(tickets)
        return ToolResult(
            summary=f"Tickets: found {len(tickets)} similar past ticket(s).",
            payload=tickets,
            grounding=grounding,
        )


class DraftReplyTool(Tool):
    """A fallback / explicit drafting tool.

    The agent loop always drafts a final reply, but this exposes drafting as an
    addressable tool too (useful when wiring the agent into another framework
    that wants discrete tool calls).
    """

    name = "draft_reply"
    description = (
        "Draft a polished, grounded reply to the customer using whatever "
        "context has been gathered. Use for general questions, thank-yous, "
        "or when no other tool is a strong match."
    )

    def run(self, query: str, brain, ctx: Dict[str, Any]) -> ToolResult:
        return ToolResult(summary="Draft: composing a direct reply.")


def default_tools() -> List[Tool]:
    return [SearchKnowledgeBaseTool(), SimilarTicketsTool(), DraftReplyTool()]

"""Semantic tool routing — recipe: semantic-tool-routing.

Instead of asking the LLM "which tool?" (slow, an extra round-trip) or matching
keywords (brittle), we embed each tool's natural-language description once and
embed the incoming request, then pick the tool whose description is the closest
match by cosine similarity. This is the same EMBED + COSINE_SIMILARITY surface
the memory and RAG steps use — the router *is* a semantic search over tools.

One SQL statement does the whole route: we build an inline relation of
(tool_name, description) pairs and rank them against the embedded query.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from .client import SynapCoresClient, sql_quote
from .tools.base import Tool


class SemanticRouter:
    def __init__(self, client: SynapCoresClient, tools: List[Tool]) -> None:
        self.c = client
        self.tools = {t.name: t for t in tools}

    def route(self, query: str, min_score: float = 0.15) -> Tuple[Optional[Tool], float, List[Tuple[str, float]]]:
        """Return (best_tool, score, ranked) for the query.

        ``ranked`` is the full [(tool_name, score), ...] list, useful for traces.
        If nothing clears ``min_score`` the best tool is still returned so the
        agent always has a hand to use, but the caller can inspect the score.
        """
        if not self.tools:
            return None, 0.0, []

        q = sql_quote(query)
        # One single-row SELECT with one COSINE_SIMILARITY column per tool, then
        # rank in Python. We deliberately do NOT use a per-tool UNION ALL: in the
        # CE engine, EMBED() of the same query text across UNION branches can be
        # de-duplicated/cached such that every branch returns an identical score.
        # A single row sidesteps that and embeds each description once.
        names = list(self.tools.keys())
        cols = []
        for i, name in enumerate(names):
            desc = sql_quote(self.tools[name].description or name)
            cols.append(
                f"COSINE_SIMILARITY(EMBED('{desc}'), EMBED('{q}')) AS s{i}"
            )
        sql = "SELECT " + ", ".join(cols)
        res = self.c.execute(sql)
        row = res.dicts()[0] if res.rows else {}
        ranked: List[Tuple[str, float]] = sorted(
            ((names[i], float(row.get(f"s{i}") or 0.0)) for i in range(len(names))),
            key=lambda kv: kv[1],
            reverse=True,
        )
        if not ranked:
            return None, 0.0, []
        best_name, best_score = ranked[0]
        return self.tools.get(best_name), best_score, ranked

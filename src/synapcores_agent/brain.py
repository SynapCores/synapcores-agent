"""The brain — SynapCores as the agent's memory + RAG + generation substrate.

Each method here corresponds to a *certified recipe*. The mapping:

  - ``ensure_schema``        — sets up the tables the recipes assume
  - ``write_memory`` /
    ``recall_memory``        — long-term conversation memory (vector recall)
        recipe: give-any-agent-long-term-memory
  - ``add_kb_doc`` /
    ``search_kb``            — retrieval-augmented grounding over a KB
        recipe: rag-ground-any-agent
  - ``find_similar_tickets`` — episodic recall over past resolved tickets
        recipe: agentic-memory-graph / build-a-customer-support-agent
  - ``generate_reply``       — grounded generation with the bundled LLM
        recipe: build-a-customer-support-agent

All recall is real semantic search: text → ``EMBED`` → ``COSINE_SIMILARITY``
ranking, the same primitives a vector DB gives you, but co-located with the
rows and the LLM so there is no glue service.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from .client import QueryResult, SynapCoresClient, sql_quote

EMBED_DIM = 384  # MiniLM, the CE default embedding model


class Brain:
    def __init__(self, client: SynapCoresClient, namespace: str = "support_agent") -> None:
        self.c = client
        self.ns = namespace

    # ----------------------------------------------------------------- tables
    @property
    def t_memory(self) -> str:
        return f"{self.ns}_memory"

    @property
    def t_kb(self) -> str:
        return f"{self.ns}_kb"

    @property
    def t_tickets(self) -> str:
        return f"{self.ns}_tickets"

    def ensure_schema(self) -> None:
        """Create the agent's tables if they don't exist (idempotent)."""
        self.c.execute(
            f"""CREATE TABLE IF NOT EXISTS {self.t_memory} (
                id INTEGER PRIMARY KEY,
                user_id VARCHAR(128),
                role VARCHAR(16),
                content TEXT,
                embedding VECTOR({EMBED_DIM}),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        self.c.execute(
            f"""CREATE TABLE IF NOT EXISTS {self.t_kb} (
                id INTEGER PRIMARY KEY,
                title VARCHAR(255),
                body TEXT,
                embedding VECTOR({EMBED_DIM}),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        self.c.execute(
            f"""CREATE TABLE IF NOT EXISTS {self.t_tickets} (
                id INTEGER PRIMARY KEY,
                subject VARCHAR(255),
                problem TEXT,
                resolution TEXT,
                embedding VECTOR({EMBED_DIM}),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )"""
        )

    # -------------------------------------------------------- id allocation
    def _next_id(self, table: str) -> int:
        res = self.c.execute(f"SELECT COALESCE(MAX(id), 0) + 1 AS nid FROM {table}")
        return int(res.scalar() or 1)

    # ---------------------------------------------- recipe: long-term memory
    def write_memory(self, role: str, content: str, user_id: str) -> int:
        """Persist one conversation turn, embedded for future semantic recall."""
        nid = self._next_id(self.t_memory)
        q = sql_quote(content)
        self.c.execute(
            f"""INSERT INTO {self.t_memory} (id, user_id, role, content, embedding)
                VALUES ({nid}, '{sql_quote(user_id)}', '{sql_quote(role)}',
                        '{q}', EMBED('{q}'))"""
        )
        return nid

    def recall_memory(self, query: str, user_id: str, k: int = 4, min_score: float = 0.25) -> List[Dict[str, Any]]:
        """Recall the most semantically relevant past turns for this user."""
        q = sql_quote(query)
        res: QueryResult = self.c.execute(
            f"""SELECT role, content,
                       COSINE_SIMILARITY(embedding, EMBED('{q}')) AS score
                FROM {self.t_memory}
                WHERE user_id = '{sql_quote(user_id)}'
                ORDER BY score DESC
                LIMIT {int(k)}"""
        )
        return [r for r in res.dicts() if (r.get("score") or 0) >= min_score]

    # --------------------------------------------------- recipe: RAG grounding
    def add_kb_doc(self, title: str, body: str) -> int:
        """Add a knowledge-base article, embedded for semantic retrieval."""
        nid = self._next_id(self.t_kb)
        qb = sql_quote(body)
        self.c.execute(
            f"""INSERT INTO {self.t_kb} (id, title, body, embedding)
                VALUES ({nid}, '{sql_quote(title)}', '{qb}', EMBED('{qb}'))"""
        )
        return nid

    def search_kb(self, query: str, k: int = 3, min_score: float = 0.2) -> List[Dict[str, Any]]:
        """Semantic search over the knowledge base (the RAG retrieval step)."""
        q = sql_quote(query)
        res = self.c.execute(
            f"""SELECT title, body,
                       COSINE_SIMILARITY(embedding, EMBED('{q}')) AS score
                FROM {self.t_kb}
                ORDER BY score DESC
                LIMIT {int(k)}"""
        )
        return [r for r in res.dicts() if (r.get("score") or 0) >= min_score]

    # --------------------------------------- recipe: episodic ticket recall
    def add_ticket(self, subject: str, problem: str, resolution: str) -> int:
        """Store a past resolved ticket for similarity-based recall."""
        nid = self._next_id(self.t_tickets)
        # Embed the problem text — that's what we match incoming queries against.
        qp = sql_quote(problem)
        self.c.execute(
            f"""INSERT INTO {self.t_tickets} (id, subject, problem, resolution, embedding)
                VALUES ({nid}, '{sql_quote(subject)}', '{qp}',
                        '{sql_quote(resolution)}', EMBED('{qp}'))"""
        )
        return nid

    def find_similar_tickets(self, query: str, k: int = 3, min_score: float = 0.25) -> List[Dict[str, Any]]:
        """Find past tickets whose problem is semantically similar to ``query``."""
        q = sql_quote(query)
        res = self.c.execute(
            f"""SELECT subject, problem, resolution,
                       COSINE_SIMILARITY(embedding, EMBED('{q}')) AS score
                FROM {self.t_tickets}
                ORDER BY score DESC
                LIMIT {int(k)}"""
        )
        return [r for r in res.dicts() if (r.get("score") or 0) >= min_score]

    # ----------------------------------------------- recipe: grounded reply
    def generate_reply(self, prompt: str) -> str:
        """Generate a grounded reply with the bundled LLM (zero external key)."""
        return self.c.generate(prompt)

    # ----------------------------------------------------------- maintenance
    def wipe(self) -> None:
        """Drop the agent's tables (used by tests / fresh demos)."""
        for t in (self.t_memory, self.t_kb, self.t_tickets):
            self.c.execute(f"DROP TABLE IF EXISTS {t}")

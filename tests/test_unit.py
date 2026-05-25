"""Unit tests that need NO live SynapCores.

These cover the pure-Python pieces: SQL quoting, envelope unwrapping, config
parsing, and the router's SQL construction (against a fake client). The live
end-to-end test lives in test_live.py and is skipped unless a gateway is
reachable.
"""

from __future__ import annotations

import os

from synapcores_agent.client import QueryResult, sql_quote
from synapcores_agent.config import Config
from synapcores_agent.router import SemanticRouter
from synapcores_agent.tools import default_tools


def test_sql_quote_escapes_single_quotes():
    assert sql_quote("it's a test") == "it''s a test"
    assert sql_quote("no quotes") == "no quotes"


def test_queryresult_helpers():
    qr = QueryResult(columns=["a", "b"], rows=[[1, 2], [3, 4]])
    assert qr.dicts() == [{"a": 1, "b": 2}, {"a": 3, "b": 4}]
    assert QueryResult(columns=["x"], rows=[[42]]).scalar() == 42
    assert QueryResult(columns=["x"], rows=[]).scalar() is None


def test_config_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("SYNAPCORES_URL", "http://example:9000")
    monkeypatch.setenv("SYNAPCORES_USERNAME", "bob")
    monkeypatch.setenv("SYNAPCORES_PASSWORD", "pw")
    cfg = Config.from_env(dotenv_path=str(tmp_path / "missing.env"))
    assert cfg.base_url == "http://example:9000"
    assert cfg.username == "bob"
    assert cfg.password == "pw"


def test_dotenv_parsing(tmp_path):
    env = tmp_path / ".env"
    env.write_text('SYNAPCORES_URL="http://from-dotenv:1"\n# comment\nSYNAPCORES_NAMESPACE=ns1\n')
    # Ensure real env doesn't shadow what we're testing.
    for k in ("SYNAPCORES_URL", "SYNAPCORES_NAMESPACE"):
        os.environ.pop(k, None)
    cfg = Config.from_env(dotenv_path=str(env))
    assert cfg.base_url == "http://from-dotenv:1"
    assert cfg.namespace == "ns1"


class _FakeClient:
    """Captures the SQL the router builds and returns a canned ranking."""

    def __init__(self):
        self.last_sql = None

    def execute(self, sql):
        self.last_sql = sql
        # The router builds a single-row SELECT with one s<i> column per tool,
        # in tool registration order. default_tools() order is:
        #   search_knowledge_base, find_similar_tickets, draft_reply
        return QueryResult(
            columns=["s0", "s1", "s2"],
            rows=[[0.40, 0.81, 0.10]],
        )


def test_router_single_row_and_picks_best():
    fake = _FakeClient()
    router = SemanticRouter(fake, default_tools())
    tool, score, ranked = router.route("my app crashes with an error")
    assert tool is not None and tool.name == "find_similar_tickets"
    assert score == 0.81
    assert ranked[0] == ("find_similar_tickets", 0.81)
    # The router must use EMBED + COSINE_SIMILARITY, one column per tool.
    assert "COSINE_SIMILARITY" in fake.last_sql
    assert "EMBED(" in fake.last_sql
    assert fake.last_sql.count("COSINE_SIMILARITY") == 3
    # Single-row form: no UNION needed.
    assert "UNION" not in fake.last_sql

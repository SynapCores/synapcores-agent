"""Live end-to-end test against a real SynapCores gateway.

Skipped automatically unless SYNAPCORES_URL is set and reachable. Set:

    SYNAPCORES_URL, and (SYNAPCORES_USERNAME + SYNAPCORES_PASSWORD) or SYNAPCORES_TOKEN

then run:  pytest tests/test_live.py -v

Note: the FIRST GENERATE call can take ~30s while the bundled GGUF model loads
on CPU; the gateway's request_timeout must be >= that (see README).
"""

from __future__ import annotations

import os
import uuid

import pytest

from synapcores_agent import Config, SupportAgent, SynapCoresError
from synapcores_agent.seed import seed


def _have_gateway() -> bool:
    cfg = Config.from_env()
    if not cfg.base_url:
        return False
    if not (cfg.token or (cfg.username and cfg.password)):
        return False
    try:
        SupportAgent(cfg).client.execute("SELECT 1 AS x")
        return True
    except SynapCoresError:
        return False


pytestmark = pytest.mark.skipif(
    not _have_gateway(),
    reason="no reachable SynapCores gateway (set SYNAPCORES_URL + creds)",
)


@pytest.fixture(scope="module")
def agent():
    cfg = Config.from_env()
    # Isolate this test run in its own namespace so it never clobbers real data.
    cfg.namespace = "test_" + uuid.uuid4().hex[:8]
    a = SupportAgent(cfg)
    a.setup()
    seed(a.brain)
    yield a
    a.brain.wipe()


def test_embed_and_cosine_rank(agent):
    related = agent.client.execute(
        "SELECT COSINE_SIMILARITY(EMBED('cannot log in'), EMBED('password reset')) AS s"
    ).scalar()
    unrelated = agent.client.execute(
        "SELECT COSINE_SIMILARITY(EMBED('cannot log in'), EMBED('sunny weather')) AS s"
    ).scalar()
    assert related > unrelated  # semantic ranking is real


def test_kb_semantic_retrieval(agent):
    hits = agent.brain.search_kb("I forgot my password", k=3)
    assert hits, "expected at least one KB hit"
    assert any("password" in (h["title"] + h["body"]).lower() for h in hits)


def test_similar_ticket_recall(agent):
    tickets = agent.brain.find_similar_tickets("charged twice on my credit card", k=3)
    assert tickets
    assert any("charge" in (t["problem"] + t["resolution"]).lower() for t in tickets)


def test_memory_persists_and_recalls(agent):
    uid = "live-user-" + uuid.uuid4().hex[:6]
    agent.brain.write_memory("user", "My order number is 88421 and it is late.", uid)
    recalled = agent.brain.recall_memory("what was my order number", uid, k=3)
    assert recalled
    assert any("88421" in m["content"] for m in recalled)


def test_semantic_route(agent):
    tool, score, ranked = agent.router.route("there's a bug, the app shows an error on login")
    assert tool is not None
    assert tool.name in {"find_similar_tickets", "search_knowledge_base"}


def test_full_turn_generates_grounded_reply(agent):
    uid = "live-turn-" + uuid.uuid4().hex[:6]
    turn = agent.respond("I can't log in, it says my password is wrong.", user_id=uid)
    assert turn.reply, "GENERATE produced no reply"
    assert turn.chosen_tool is not None
    # The turn should have been written to memory (both sides).
    mem = agent.brain.recall_memory("login password problem", uid, k=4)
    assert any(m["role"] == "user" for m in mem)

"""Browser-based customer-support chat widget — aiohttp + WebSockets.

Serves a polished two-pane chat UI (``web/``) and runs the *real* agent loop per
turn over a WebSocket, streaming the brain's work so the UI can render it live:

    {type:"thinking"}                       — the agent picked up the turn
    {type:"brain", recalled_memory, kb_hits, route, chosen_tool, source, embed_dim}
    {type:"reply", text}                    — the grounded reply

Every step is a genuine SynapCores call (recall memory, RAG, semantic routing,
tool run, memory writeback). Only the final word-generation is pluggable
(see ``llm.py``): zero-key bundled ``GENERATE`` by default, OpenAI ``gpt-4o``
when ``AGENT_GENERATOR=openai``.

The synchronous agent runs in a thread-pool executor so the event loop stays
responsive.
"""

from __future__ import annotations

import asyncio
import json
import os
import webbrowser
from pathlib import Path
from typing import Any, Dict, List, Tuple

from aiohttp import WSMsgType, web

from .agent import SupportAgent
from .config import Config, _load_dotenv
from .llm import make_generator
from .seed import seed
from .tools.support_tools import _format_docs

WEB_DIR = Path(__file__).resolve().parent.parent.parent / "web"
COMPANY_NAME = os.environ.get("COMPANY_NAME") or _load_dotenv().get("COMPANY_NAME", "Northwind")


# ---------------------------------------------------------------------------
# One real agent turn, decomposed so we can stream the brain trace as we go.
# This mirrors SupportAgent.respond() step-for-step but yields intermediate
# state to the websocket. Run synchronously inside an executor.
# ---------------------------------------------------------------------------
def _run_brain(agent: SupportAgent, generate, user_id: str, text: str) -> Tuple[Dict[str, Any], str]:
    """Execute the full agent loop. Returns (brain_trace, reply)."""
    # 1. recall memory (vector) — what has this user told us before?
    recalled = agent.brain.recall_memory(text, user_id, k=4)

    # 2. retrieve knowledge (RAG) — ground in the KB.
    kb_hits = agent.brain.search_kb(text, k=3)

    # 3. semantic tool-route — pick the best tool by meaning.
    tool, score, ranked = agent.router.route(text)
    chosen_tool = tool.name if tool else None

    # 4. act — run the chosen tool to gather grounding.
    grounding_blocks: List[str] = []
    if kb_hits:
        grounding_blocks.append("Knowledge base articles:\n" + _format_docs(kb_hits))
    if tool is not None:
        result = tool.run(text, agent.brain, {"user_id": user_id})
        if result.grounding:
            grounding_blocks.append(result.grounding)

    # 5. GENERATE reply — grounded generation (pluggable LLM).
    prompt = agent._build_prompt(text, recalled, grounding_blocks)
    reply = generate(prompt)

    # 6. write memory back — persist both sides of the turn.
    agent.brain.write_memory("user", text, user_id)
    if reply:
        agent.brain.write_memory("assistant", reply, user_id)

    trace = {
        "recalled_memory": [
            {
                "role": m.get("role", ""),
                "content": m.get("content", ""),
                "score": round(float(m.get("score") or 0.0), 3),
            }
            for m in recalled
        ],
        "kb_hits": [
            {"title": d.get("title", ""), "score": round(float(d.get("score") or 0.0), 3)}
            for d in kb_hits
        ],
        "route": [[name, round(float(s), 3)] for name, s in ranked],
        "chosen_tool": chosen_tool,
    }
    return trace, reply


# ---------------------------------------------------------------------------
# HTTP + WebSocket handlers
# ---------------------------------------------------------------------------
async def index(request: web.Request) -> web.Response:
    return web.FileResponse(WEB_DIR / "index.html")


async def api_info(request: web.Request) -> web.Response:
    app = request.app
    return web.json_response(
        {
            "company": app["company"],
            "embed_dim": app["embed_dim"],
            "source": app["source_label"],
        }
    )


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)

    app = request.app
    agent: SupportAgent = app["agent"]
    generate = app["generate"]
    loop = asyncio.get_event_loop()

    async for msg in ws:
        if msg.type != WSMsgType.TEXT:
            continue
        try:
            data = json.loads(msg.data)
        except (ValueError, TypeError):
            continue
        if data.get("type") != "turn":
            continue

        user_id = (data.get("user_id") or app["default_user"]).strip() or app["default_user"]
        text = (data.get("text") or "").strip()
        if not text:
            continue

        # Tell the UI to show the typing indicator.
        await ws.send_json({"type": "thinking"})

        # Run the (synchronous) real agent loop off the event loop.
        try:
            trace, reply = await loop.run_in_executor(
                None, _run_brain, agent, generate, user_id, text
            )
        except Exception as exc:  # surface gracefully in the widget
            await ws.send_json(
                {
                    "type": "reply",
                    "text": "Sorry — I hit a problem reaching my brain. Please try again.",
                    "error": str(exc),
                }
            )
            continue

        # Stream the brain trace, then the reply.
        await ws.send_json(
            {
                "type": "brain",
                "recalled_memory": trace["recalled_memory"],
                "kb_hits": trace["kb_hits"],
                "route": trace["route"],
                "chosen_tool": trace["chosen_tool"],
                "source": app["source_label"],
                "embed_dim": app["embed_dim"],
            }
        )
        await ws.send_json({"type": "reply", "text": reply})

    return ws


# ---------------------------------------------------------------------------
# App construction
# ---------------------------------------------------------------------------
def build_app() -> web.Application:
    """Build the SupportAgent once, seed if empty, wire routes + static."""
    config = Config.from_env()
    agent = SupportAgent(config)
    agent.setup()

    # Seed the brain if the KB is empty (idempotent for the demo / first boot).
    try:
        existing = agent.brain.search_kb("password reset refund billing", k=1)
        if not existing:
            seed(agent.brain)
    except Exception:
        # If the probe fails for any reason, seed anyway — ensure_schema is idempotent.
        seed(agent.brain)

    generate, source_label = make_generator(agent)

    app = web.Application()
    app["agent"] = agent
    app["generate"] = generate
    app["source_label"] = source_label
    app["company"] = COMPANY_NAME
    app["default_user"] = config.user_id or "acme-customer"
    app["embed_dim"] = agent.brain.embed_dim

    app.router.add_get("/", index)
    app.router.add_get("/api/info", api_info)
    app.router.add_get("/ws", ws_handler)
    app.router.add_static("/", WEB_DIR, show_index=False)
    return app


def serve(port: int = 8810, open_browser: bool = True) -> None:
    """Start the chat server, print the URL, optionally open a browser."""
    app = build_app()
    url = f"http://127.0.0.1:{port}/"
    print("=" * 64)
    print(f"  {app['company']} — Customer Support chat widget")
    print(f"  brain = SynapCores  |  embeddings = {app['embed_dim']}-dim  "
          f"|  reply = {app['source_label']}")
    print(f"  open: {url}")
    print("=" * 64)
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    web.run_app(app, host="127.0.0.1", port=port, print=None)

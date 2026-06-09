"""Mock v1 backend for Sprint 0 widget verification.

Speaks the exact v1 WS protocol from web.py so the widget can be smoke-tested
without spinning up the engine + agent + KB seed. Drop-in replacement for
`python -m synapcores_agent.web` when you only want to prove the wire works.

    {type:"turn", user_id, text}                   --> client to server
    {type:"thinking"}                              <-- canned
    {type:"brain", recalled_memory, ...}           <-- canned
    {type:"reply", text}                           <-- canned

Run:
    cd /home/devops/IP/GPT/synapcores-agent
    .venv/bin/python widget/dev/mock_backend.py
    # serves ws://localhost:8810/ws

Then open the widget dev page at http://localhost:5050/ (npm run dev in
widget/) and chat — every message echoes a fixed reply after 400ms.
"""
from __future__ import annotations

import asyncio
import json
import logging
from aiohttp import web, WSMsgType

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mock_backend")


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    peer = request.remote
    log.info("WS open from %s", peer)
    async for msg in ws:
        if msg.type != WSMsgType.TEXT:
            continue
        try:
            data = json.loads(msg.data)
        except json.JSONDecodeError:
            continue
        if data.get("type") != "turn":
            continue
        user_id = data.get("user_id", "?")
        text = (data.get("text") or "").strip()
        log.info("turn from %s: %r", user_id, text)
        await ws.send_json({"type": "thinking"})
        await asyncio.sleep(0.4)
        await ws.send_json(
            {
                "type": "brain",
                "recalled_memory": [],
                "kb_hits": [],
                "route": [],
                "chosen_tool": None,
                "source": "mock",
                "embed_dim": 384,
            }
        )
        await ws.send_json(
            {
                "type": "reply",
                "text": f"(mock) You said: {text or '(empty)'}",
            }
        )
    log.info("WS close from %s", peer)
    return ws


async def health(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "mock": True})


def main() -> None:
    app = web.Application()
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/health", health)
    log.info("Mock backend on http://localhost:8810  (WS at /ws)")
    web.run_app(app, host="127.0.0.1", port=8810, print=None)


if __name__ == "__main__":
    main()

"""Sprint 0 wire-shape smoke test.

Drives the same WS protocol the widget bundle drives, end-to-end, against the
mock backend. If this passes, the widget's transport contract is correct — the
only remaining variable is the browser DOM, which is verified manually with
the dev page.

Run (with mock_backend.py running on :8810):

    .venv/bin/python widget/dev/smoke_client.py
"""
from __future__ import annotations

import asyncio
import json
import sys

import aiohttp


async def smoke() -> int:
    url = "ws://127.0.0.1:8810/ws"
    visitor = "smoke-visitor-uuid-0001"
    text = "hello from smoke_client"
    print(f"connect: {url}")
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(url) as ws:
            await ws.send_json({"type": "turn", "user_id": visitor, "text": text})
            print(f"sent:  turn from {visitor!r} text={text!r}")
            seen = {"thinking": False, "brain": False, "reply": None}
            async for msg in ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                data = json.loads(msg.data)
                t = data.get("type")
                print(f"recv:  {t}")
                if t == "thinking":
                    seen["thinking"] = True
                elif t == "brain":
                    seen["brain"] = True
                elif t == "reply":
                    seen["reply"] = data.get("text")
                    break
            ok = seen["thinking"] and seen["brain"] and isinstance(seen["reply"], str)
            print()
            print(f"thinking: {'OK' if seen['thinking'] else 'MISS'}")
            print(f"brain:    {'OK' if seen['brain'] else 'MISS'}")
            print(f"reply:    {seen['reply']!r}")
            return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(smoke()))

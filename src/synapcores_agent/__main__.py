"""CLI entrypoint: ``python -m synapcores_agent``.

Usage:
    python -m synapcores_agent              # interactive chat (REPL)
    python -m synapcores_agent --seed       # load the demo KB + tickets, then chat
    python -m synapcores_agent --reset      # drop the agent's tables, then exit
    python -m synapcores_agent --ask "..."  # single question, print reply, exit
    python -m synapcores_agent --trace      # print each loop step (memory/RAG/route)

Configuration comes from .env / environment (see config.py and .env.example).
"""

from __future__ import annotations

import argparse
import sys

from .agent import SupportAgent, Turn
from .client import SynapCoresError
from .config import Config
from .seed import seed


def _print_trace(turn: Turn) -> None:
    print("  ── trace ──────────────────────────────────────────")
    if turn.recalled_memory:
        print("  recall (memory):")
        for m in turn.recalled_memory:
            print(f"    [{m.get('score', 0):.2f}] ({m['role']}) {m['content'][:80]}")
    else:
        print("  recall (memory): (none)")
    if turn.kb_hits:
        print("  retrieve (RAG):")
        for d in turn.kb_hits:
            print(f"    [{d.get('score', 0):.2f}] {d['title']}")
    else:
        print("  retrieve (RAG): (none)")
    if turn.route:
        ranked = ", ".join(f"{n}={s:.2f}" for n, s in turn.route)
        print(f"  route: {ranked}")
    print(f"  chosen tool: {turn.chosen_tool}  ({turn.tool_summary})")
    print("  ───────────────────────────────────────────────────")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="synapcores_agent")
    parser.add_argument("--seed", action="store_true", help="load demo KB + tickets first")
    parser.add_argument("--reset", action="store_true", help="drop the agent's tables and exit")
    parser.add_argument("--ask", metavar="TEXT", help="ask one question and exit")
    parser.add_argument("--trace", action="store_true", help="print each loop step")
    parser.add_argument("--user", default=None, help="user id for memory scope")
    args = parser.parse_args(argv)

    config = Config.from_env()
    try:
        agent = SupportAgent(config)
    except SynapCoresError as exc:
        print(f"Could not connect to SynapCores at {config.base_url}: {exc}", file=sys.stderr)
        print("Check SYNAPCORES_URL and credentials in your .env.", file=sys.stderr)
        return 2

    if args.reset:
        agent.brain.wipe()
        print("Agent tables dropped.")
        return 0

    agent.setup()

    if args.seed:
        counts = seed(agent.brain)
        print(f"Seeded {counts['kb_articles']} KB articles and {counts['tickets']} past tickets.")

    uid = args.user or config.user_id

    if args.ask:
        turn = agent.respond(args.ask, user_id=uid)
        if args.trace:
            _print_trace(turn)
        print(turn.reply)
        return 0

    # Interactive REPL.
    print("synapcores-agent — customer support. Type 'exit' to quit, '/trace' to toggle traces.")
    print(f"Connected to {config.base_url} as user '{uid}'. Brain = SynapCores.\n")
    trace = args.trace
    while True:
        try:
            msg = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not msg:
            continue
        if msg.lower() in ("exit", "quit"):
            break
        if msg == "/trace":
            trace = not trace
            print(f"(trace {'on' if trace else 'off'})")
            continue
        try:
            turn = agent.respond(msg, user_id=uid)
        except SynapCoresError as exc:
            print(f"agent error: {exc}", file=sys.stderr)
            continue
        if trace:
            _print_trace(turn)
        print(f"agent> {turn.reply}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

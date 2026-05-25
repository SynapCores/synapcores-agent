"""End-to-end demo: seed the brain, then run a multi-turn support session.

Run against a local SynapCores (see .env.example):

    python examples/demo_session.py

This exercises every step of the loop with real SynapCores calls:
recall (vector) → retrieve (RAG) → semantic route → act → GENERATE → write back,
and shows memory persisting across turns.
"""

from __future__ import annotations

from synapcores_agent import Config, SupportAgent
from synapcores_agent.seed import seed


def show(turn) -> None:
    print(f"\nyou> {turn.user_message}")
    route = ", ".join(f"{n}={s:.2f}" for n, s in turn.route)
    print(f"   recall={len(turn.recalled_memory)} kb={len(turn.kb_hits)} route=[{route}] -> {turn.chosen_tool}")
    print(f"agent> {turn.reply}")


def main() -> None:
    config = Config.from_env()
    agent = SupportAgent(config)
    agent.setup()

    counts = seed(agent.brain)
    print(f"Seeded {counts['kb_articles']} KB articles + {counts['tickets']} past tickets.")

    uid = "demo-customer"

    # Turn 1 — a problem that should hit a similar past ticket + KB article.
    show(agent.respond("I can't log in, it keeps saying my password is wrong.", user_id=uid))

    # Turn 2 — a follow-up; the agent should recall the prior turn from memory.
    show(agent.respond("I tried that and the reset email never came.", user_id=uid))

    # Turn 3 — a different topic that should route to the KB.
    show(agent.respond("Also, how do I get a refund on my annual plan?", user_id=uid))

    # Turn 4 — recall test: reference the earlier login problem by meaning.
    show(agent.respond("Remind me what we were troubleshooting earlier with my account?", user_id=uid))


if __name__ == "__main__":
    main()

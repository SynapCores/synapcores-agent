"""Pluggable reply generation — the LLM is a swappable component.

Every cognitive step of the agent (recall memory, RAG retrieval, semantic tool
routing, memory writeback) runs *in SynapCores* as real vector SQL. The only
piece that is provider-pluggable is the final word-generation step. This module
isolates that choice behind one factory, ``make_generator``, which returns a
``callable(prompt) -> str`` plus a short human-readable source label.

Two backends, selected by ``AGENT_GENERATOR``:

  * ``engine`` (default, ZERO external key) — the gateway's bundled ``GENERATE``
    LLM, via ``brain.generate_reply``. This is what runs out of the box.
  * ``openai`` — OpenAI Chat Completions (default model ``gpt-4o``), called
    directly with the standard library. Production-prose quality for demos /
    deployments that want a hosted LLM. The cognition layer is unchanged.

The key is read once from ``OPENAI_API_KEY`` in the environment and is never
logged or echoed.
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Callable, Tuple

from .agent import SYSTEM_PERSONA
from .config import _load_dotenv

# A generator is just: prompt -> reply text.
Generator = Callable[[str], str]


def _env(name: str, default: str = "") -> str:
    """Read a setting from the real environment, falling back to ``.env``.

    Mirrors ``Config.from_env`` precedence (real env wins) so generator settings
    in ``.env`` (``AGENT_GENERATOR`` / ``AGENT_LLM_MODEL``) take effect even when
    they're not exported into the process environment.
    """
    val = os.environ.get(name)
    if val:
        return val
    return _load_dotenv().get(name, default)

DEFAULT_OPENAI_MODEL = "gpt-4o"
_OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"


def openai_generator(
    model: str = DEFAULT_OPENAI_MODEL,
    *,
    api_key: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 220,
    timeout: float = 120.0,
) -> Generator:
    """Build a generator that calls OpenAI Chat Completions directly.

    Lifts the ``gpt4o()`` pattern from ``examples/record_session.py`` into a
    reusable, configurable function. The key comes from the environment
    (``OPENAI_API_KEY``) and is captured at build time; it is never printed.
    """
    key = api_key or os.environ.get("OPENAI_API_KEY", "")
    if not key:
        raise RuntimeError(
            "AGENT_GENERATOR=openai requires OPENAI_API_KEY in the environment."
        )

    def _generate(prompt: str) -> str:
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_PERSONA},
                {"role": "user", "content": prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        req = urllib.request.Request(
            _OPENAI_CHAT_URL,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        raw = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8")
        data = json.loads(raw)
        return data["choices"][0]["message"]["content"].strip()

    return _generate


def make_generator(agent) -> Tuple[Generator, str]:
    """Resolve a ``(generator, source_label)`` for a live ``SupportAgent``.

    Selection (env-driven, so the default is zero-key):
      * ``AGENT_GENERATOR=openai`` (+ ``OPENAI_API_KEY``) → OpenAI direct, using
        ``AGENT_LLM_MODEL`` (default ``gpt-4o``). A pure prompt->text call.
      * anything else → the engine's bundled ``GENERATE`` via the brain, with
        zero external keys.

    ``source_label`` is a short string for the brain trace / UI, e.g.
    ``"OpenAI gpt-4o"`` or ``"SynapCores GENERATE (bundled)"``.
    """
    backend = _env("AGENT_GENERATOR", "engine").strip().lower()
    if backend == "openai":
        model = _env("AGENT_LLM_MODEL", DEFAULT_OPENAI_MODEL).strip() or DEFAULT_OPENAI_MODEL
        return openai_generator(model), f"OpenAI {model}"
    return agent.brain.generate_reply, "SynapCores GENERATE (bundled)"

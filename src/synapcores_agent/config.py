"""Configuration — loaded from environment / .env.

Keep this boring: a dataclass of strings, populated from os.environ. We do a
tiny, dependency-free ``.env`` parse so ``python -m synapcores_agent`` works
out of the box without requiring python-dotenv.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional


def _load_dotenv(path: str = ".env") -> Dict[str, str]:
    """Minimal .env reader: KEY=VALUE lines, ``#`` comments, optional quotes.

    Does NOT override variables already present in the real environment.
    """
    out: Dict[str, str] = {}
    p = Path(path)
    if not p.exists():
        return out
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key:
            out[key] = val
    return out


@dataclass
class Config:
    base_url: str = "http://127.0.0.1:8080"
    username: Optional[str] = None
    password: Optional[str] = None
    token: Optional[str] = None
    # Namespace for this agent's tables, so it can coexist with other data.
    namespace: str = "support_agent"
    # User/agent identity used to scope conversation memory.
    user_id: str = "default-user"
    # Request timeout (seconds). The bundled GGUF LLM is slow on a cold start;
    # GENERATE can take ~30s on first call on CPU, so default generously.
    timeout: float = 300.0
    # Optional BYO external LLM. If set, we configure GENERATE to use it via
    # the gateway by setting these on the server side is out of scope here;
    # this flag is surfaced in the README's BYO section.
    llm_provider: Optional[str] = None
    llm_api_key: Optional[str] = None
    extras: Dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_env(cls, dotenv_path: str = ".env") -> "Config":
        env = dict(_load_dotenv(dotenv_path))
        env.update(os.environ)  # real env wins over .env

        def get(*names: str, default: Optional[str] = None) -> Optional[str]:
            for n in names:
                if env.get(n):
                    return env[n]
            return default

        timeout_raw = get("SYNAPCORES_TIMEOUT", default="300")
        return cls(
            base_url=get("SYNAPCORES_URL", "SYNAPCORES_BASE_URL", default="http://127.0.0.1:8080"),
            username=get("SYNAPCORES_USERNAME"),
            password=get("SYNAPCORES_PASSWORD"),
            token=get("SYNAPCORES_TOKEN"),
            namespace=get("SYNAPCORES_NAMESPACE", default="support_agent"),
            user_id=get("AGENT_USER_ID", default="default-user"),
            timeout=float(timeout_raw),
            llm_provider=get("LLM_PROVIDER"),
            llm_api_key=get("LLM_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"),
        )

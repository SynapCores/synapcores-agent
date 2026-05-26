"""Thin SynapCores client — the agent's connection to its brain.

Everything the agent does (recall memory, retrieve knowledge, route tools,
generate replies, persist memory) ultimately goes through a small number of
*verified* SynapCores surfaces:

  - ``POST /v1/auth/login``     → mint a JWT
  - ``POST /v1/query/execute``  → run SQL  (EMBED, COSINE_SIMILARITY, GENERATE)
                                   and Cypher (MERGE / MATCH) on the same route
  - ``POST /v1/mcp``            → the JSON-RPC MCP surface (optional, see mcp.py)

This module deliberately depends only on the Python standard library so the
agent has *zero* runtime dependencies and is trivially forkable. Drop in
``requests`` / ``httpx`` if you prefer; the surface area is tiny.

The gateway wraps every successful response as ``{"data": ..., "meta": ...}``
and every failure as ``{"error": {...}, "meta": ...}``. We unwrap ``data``
centrally so callers never see the envelope.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


class SynapCoresError(RuntimeError):
    """Raised when the gateway returns an error envelope or a transport fails."""


@dataclass
class QueryResult:
    """A normalized SQL/Cypher result: column names + row tuples."""

    columns: List[str]
    rows: List[List[Any]]
    execution_time_ms: int = 0

    def dicts(self) -> List[Dict[str, Any]]:
        """Rows as a list of column-keyed dicts."""
        return [dict(zip(self.columns, row)) for row in self.rows]

    def scalar(self) -> Any:
        """The single value of a 1x1 result (or None)."""
        if self.rows and self.rows[0]:
            return self.rows[0][0]
        return None


def sql_quote(value: str) -> str:
    """Escape a Python string for safe use as a single-quoted SQL literal.

    SynapCores SQL uses single quotes for string literals; a bare double-quoted
    token is parsed as an *identifier* (column name), which is the #1 footgun
    when hand-building queries. Always route user text through this.
    """
    return value.replace("'", "''")


class SynapCoresClient:
    """A minimal, dependency-free REST client for SynapCores."""

    def __init__(
        self,
        base_url: str,
        token: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        timeout: float = 300.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._token = token
        self._username = username
        self._password = password
        if not self._token and username and password:
            self.login(username, password)

    # ------------------------------------------------------------------ auth
    def login(self, username: str, password: str) -> str:
        """Exchange username/password for a JWT and remember it."""
        body = self._post(
            "/v1/auth/login",
            {"username": username, "password": password},
            authed=False,
        )
        token = body.get("access_token") or body.get("token")
        if not token:
            raise SynapCoresError(f"login returned no token: {body!r}")
        self._token = token
        return token

    @property
    def token(self) -> Optional[str]:
        return self._token

    # --------------------------------------------------------------- transport
    def _post(self, path: str, payload: Dict[str, Any], authed: bool = True) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        data = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if authed and self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            raw = urllib.request.urlopen(req, timeout=self.timeout).read().decode("utf-8")
        except urllib.error.HTTPError as exc:  # 4xx/5xx carry a JSON error body
            detail = exc.read().decode("utf-8", "replace")
            # Re-login once on a stale token, then retry.
            if exc.code == 401 and authed and self._username and self._password:
                self.login(self._username, self._password)
                return self._post(path, payload, authed=True)
            raise SynapCoresError(f"{path} -> HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise SynapCoresError(f"{path} -> transport error: {exc}") from exc

        body = json.loads(raw)
        if isinstance(body, dict) and "error" in body:
            raise SynapCoresError(f"{path} -> {body['error']}")
        # Unwrap the {data, meta} success envelope when present.
        if isinstance(body, dict) and "data" in body:
            return body["data"]
        return body

    # ------------------------------------------------------------------ sql
    def execute(self, sql: str) -> QueryResult:
        """Run a SQL or Cypher statement via /v1/query/execute.

        Both SQL (with EMBED / COSINE_SIMILARITY / GENERATE) and Cypher
        (MERGE / MATCH) go through this single verified route.
        """
        data = self._post("/v1/query/execute", {"sql": sql})
        cols = [c.get("name", "") for c in data.get("columns", [])]
        rows = data.get("rows", [])
        return QueryResult(
            columns=cols,
            rows=rows,
            execution_time_ms=data.get("execution_time_ms", 0),
        )

    # ----------------------------------------------------------- convenience
    def embedding_dim(self, text: str = "probe") -> int:
        """Return the live embedding dimensionality of the configured model.

        Probes the gateway directly with ``vector_dims(EMBED(...))`` so the
        agent can size its vector columns to whatever embedding model the
        gateway is configured to use: the bundled MiniLM (384) out of the box,
        or 1536 if the operator points ``[query.ai_service]`` at OpenAI, etc.
        This is what makes the agent embedding-model-agnostic (BYO model /
        production). Also doubles as an EMBED-works sanity check — it raises if
        EMBED is misconfigured.
        """
        res = self.execute(f"SELECT vector_dims(EMBED('{sql_quote(text)}')) AS d")
        return int(res.scalar())

    def generate(self, prompt: str) -> str:
        """Run the bundled GENERATE LLM against a prompt; returns the text.

        We source the prompt from a ``FROM (SELECT ... AS p) r`` scan rather
        than a bare literal. Bare-literal calls to AI functions (notably
        AUTOML.PREDICT) can trip a ``duplicate 'value'`` planner error; the
        scan form is the robust pattern across all of SynapCores' AI SQL fns.
        """
        p = sql_quote(prompt)
        res = self.execute(f"SELECT GENERATE(p) AS reply FROM (SELECT '{p}' AS p) r")
        return (res.scalar() or "").strip()

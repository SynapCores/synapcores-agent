"""Optional MCP client — the framework-agnostic path to the same brain.

SynapCores exposes its tools over the Model Context Protocol as JSON-RPC 2.0:

    POST /v1/mcp          — single JSON-RPC request
    POST /v1/mcp/batch    — batch
    GET  /v1/mcp/info     — server info

The original 6 SQL-mediated tools are:
    query, execute, list_tables, describe_table, validate_query, sql_manual
(v1.6.5.1 added 8 more: AutoML, semantic_search, embed_text, graph_query,
generate_text — see the README's MCP section.)

This means *any* MCP-speaking client — Claude Desktop, Claude Code, or your own
framework — can use SynapCores as its brain without this Python package at all.
The class below is a tiny convenience wrapper for calling those tools from code;
the agent loop itself uses the REST client directly for clarity.

Note on transports: as of the v1.6.5/1.6.6 line the gateway speaks JSON-RPC
over HTTP POST. Claude Desktop/Code expect stdio (or SSE / streamable HTTP), so
a small stdio->HTTP bridge ships in the engine repo
(``scripts/integrations/synapcores-mcp-bridge.js``). A future release adds the
native SSE / streamable-HTTP transports for direct ``ws://host/mcp?token=...``
style connections.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

from .client import SynapCoresError


class MCPClient:
    def __init__(self, base_url: str, token: str, timeout: float = 300.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self._id = 0

    def _rpc(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        self._id += 1
        body = {"jsonrpc": "2.0", "method": method, "id": self._id}
        if params is not None:
            body["params"] = params
        req = urllib.request.Request(
            f"{self.base_url}/v1/mcp",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
            method="POST",
        )
        try:
            raw = urllib.request.urlopen(req, timeout=self.timeout).read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raise SynapCoresError(f"MCP {method} -> HTTP {exc.code}: {exc.read().decode()}") from exc
        resp = json.loads(raw)
        if "error" in resp:
            raise SynapCoresError(f"MCP {method} -> {resp['error']}")
        return resp.get("result")

    def initialize(self, client_name: str = "synapcores-agent") -> Any:
        return self._rpc(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": client_name, "version": "1.0"},
            },
        )

    def list_tools(self) -> Any:
        return self._rpc("tools/list")

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        return self._rpc("tools/call", {"name": name, "arguments": arguments})

    # Convenience wrappers over the SQL-mediated tools.
    def query(self, sql: str) -> Any:
        return self.call_tool("query", {"sql": sql})

    def execute(self, sql: str) -> Any:
        return self.call_tool("execute", {"sql": sql})

    def list_tables(self) -> Any:
        return self.call_tool("list_tables", {})

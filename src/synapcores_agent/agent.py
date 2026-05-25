"""The agent loop — framework-free.

    input
      → recall memory       (vector recall of past turns)        [give-any-agent-long-term-memory]
      → retrieve knowledge  (RAG over the KB)                    [rag-ground-any-agent]
      → semantic tool-route (pick a tool by meaning)            [semantic-tool-routing]
      → act                 (run the chosen tool)               [build-a-customer-support-agent]
      → GENERATE reply      (grounded generation, bundled LLM)  [build-a-customer-support-agent]
      → write memory back   (persist the turn for next time)    [give-any-agent-long-term-memory]

Every step is a real SynapCores call. No LangChain, no vector-DB client, no
graph-DB client — SynapCores is the whole brain.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .brain import Brain
from .client import SynapCoresClient
from .config import Config
from .router import SemanticRouter
from .tools import Tool, default_tools

SYSTEM_PERSONA = (
    "You are a calm, concise customer-support agent. Answer the customer's "
    "question directly using ONLY the provided context (knowledge base, similar "
    "past tickets, and conversation history). If the context does not contain "
    "the answer, say so honestly and offer to escalate. Keep replies to 2-4 "
    "sentences, friendly and professional. Do not invent policies or steps."
)


@dataclass
class Turn:
    """A full record of one agent turn, for tracing / debugging."""

    user_message: str
    recalled_memory: List[Dict[str, Any]] = field(default_factory=list)
    kb_hits: List[Dict[str, Any]] = field(default_factory=list)
    route: List[Tuple[str, float]] = field(default_factory=list)
    chosen_tool: Optional[str] = None
    tool_summary: str = ""
    reply: str = ""


class SupportAgent:
    def __init__(self, config: Optional[Config] = None, tools: Optional[List[Tool]] = None) -> None:
        self.config = config or Config.from_env()
        self.client = SynapCoresClient(
            base_url=self.config.base_url,
            token=self.config.token,
            username=self.config.username,
            password=self.config.password,
            timeout=self.config.timeout,
        )
        self.brain = Brain(self.client, namespace=self.config.namespace)
        self.tools = tools or default_tools()
        self.router = SemanticRouter(self.client, self.tools)

    def setup(self) -> None:
        """Ensure the brain's tables exist."""
        self.brain.ensure_schema()

    # ------------------------------------------------------------------ loop
    def respond(self, user_message: str, user_id: Optional[str] = None) -> Turn:
        uid = user_id or self.config.user_id
        turn = Turn(user_message=user_message)

        # 1. recall memory (vector) — what has this user told us before?
        turn.recalled_memory = self.brain.recall_memory(user_message, uid, k=4)

        # 2. retrieve knowledge (RAG) — ground in the KB.
        turn.kb_hits = self.brain.search_kb(user_message, k=3)

        # 3. semantic tool-route — pick the best tool by meaning.
        tool, score, ranked = self.router.route(user_message)
        turn.route = ranked
        turn.chosen_tool = tool.name if tool else None

        # 4. act — run the chosen tool to gather grounding.
        grounding_blocks: List[str] = []
        if turn.kb_hits:
            from .tools.support_tools import _format_docs

            grounding_blocks.append("Knowledge base articles:\n" + _format_docs(turn.kb_hits))
        if tool is not None:
            result = tool.run(user_message, self.brain, {"user_id": uid})
            turn.tool_summary = result.summary
            if result.grounding:
                grounding_blocks.append(result.grounding)

        # 5. GENERATE reply — grounded generation with the bundled LLM.
        prompt = self._build_prompt(user_message, turn.recalled_memory, grounding_blocks)
        turn.reply = self.brain.generate_reply(prompt)

        # 6. write memory back — persist both sides of the turn.
        self.brain.write_memory("user", user_message, uid)
        if turn.reply:
            self.brain.write_memory("assistant", turn.reply, uid)

        return turn

    # --------------------------------------------------------------- prompt
    def _build_prompt(
        self,
        user_message: str,
        memory: List[Dict[str, Any]],
        grounding_blocks: List[str],
    ) -> str:
        parts: List[str] = [SYSTEM_PERSONA, ""]
        if memory:
            mem_lines = [f"- ({m['role']}) {m['content']}" for m in memory]
            parts.append("Relevant conversation history:\n" + "\n".join(mem_lines))
            parts.append("")
        if grounding_blocks:
            parts.append("\n\n".join(grounding_blocks))
            parts.append("")
        else:
            parts.append("(No grounding context was found.)")
            parts.append("")
        parts.append(f"Customer: {user_message}")
        parts.append("Support agent reply:")
        return "\n".join(parts)

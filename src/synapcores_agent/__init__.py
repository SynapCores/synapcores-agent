"""synapcores-agent — a framework-free AI agent whose brain is SynapCores.

input → recall memory → retrieve knowledge (RAG) → semantic tool-route → act
→ GENERATE reply → write memory back. Each step is a real SynapCores call.
"""

from .agent import SupportAgent, Turn
from .brain import Brain
from .client import SynapCoresClient, SynapCoresError
from .config import Config
from .router import SemanticRouter

__version__ = "0.1.0"

__all__ = [
    "SupportAgent",
    "Turn",
    "Brain",
    "SynapCoresClient",
    "SynapCoresError",
    "Config",
    "SemanticRouter",
    "__version__",
]

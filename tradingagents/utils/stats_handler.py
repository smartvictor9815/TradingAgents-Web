"""LLM/tool usage stats for API and CLI.

Token counts come from provider metadata (not from model text). Different stacks
put usage in ``AIMessage.usage_metadata``, ``response_metadata``, ``generation_info``,
or ``LLMResult.llm_output`` with varying key names — we normalize all common shapes.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional, Tuple

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage
from langchain_core.outputs import LLMResult


def _as_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return max(0, value)
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return None


def _first_int_in(d: dict, keys: Tuple[str, ...]) -> Optional[int]:
    """Use the first present key only (avoid double-counting prompt + cache breakdown)."""
    for key in keys:
        if key in d:
            v = _as_int(d.get(key))
            if v is not None:
                return v
    return None


def _tokens_from_flat_mapping(d: Any) -> Optional[Tuple[int, int]]:
    """Parse a dict with known input/output token key aliases. Returns None if unusable."""
    if not isinstance(d, dict) or not d:
        return None

    tin = _first_int_in(
        d,
        (
            "input_tokens",
            "prompt_tokens",
            "promptTokenCount",
            "input_token_count",
        ),
    )
    tout = _first_int_in(
        d,
        (
            "output_tokens",
            "completion_tokens",
            "candidatesTokenCount",
            "output_token_count",
            "generated_tokens",
        ),
    )

    # OpenAI-style cache-only breakdown when top-level prompt count is missing
    if tin is None:
        tin = _first_int_in(
            d,
            ("cache_read_input_tokens", "cache_creation_input_tokens"),
        )

    # Some providers only expose total_tokens
    total = _as_int(d.get("total_tokens"))
    if tin is None and tout is None and total is not None and total > 0:
        return (0, total)

    if tin is not None or tout is not None:
        return (tin or 0, tout or 0)
    return None


def _tokens_from_usage_metadata(usage: Any) -> Optional[Tuple[int, int]]:
    if usage is None:
        return None
    if isinstance(usage, dict):
        return _tokens_from_flat_mapping(usage)
    return None


def _tokens_from_llm_output(llm_output: Any) -> Optional[Tuple[int, int]]:
    if not isinstance(llm_output, dict):
        return None
    for key in ("token_usage", "usage", "usage_metadata"):
        inner = llm_output.get(key)
        if isinstance(inner, dict):
            t = _tokens_from_flat_mapping(inner)
            if t and (t[0] or t[1]):
                return t
    return _tokens_from_flat_mapping(llm_output)


def _tokens_from_generation(gen: Any) -> Optional[Tuple[int, int]]:
    """Best-effort extraction from a single Generation / ChatGeneration."""
    # LangChain chat: generation.message (AIMessage)
    message = getattr(gen, "message", None)
    if isinstance(message, AIMessage):
        t = _tokens_from_usage_metadata(getattr(message, "usage_metadata", None))
        if t and (t[0] or t[1]):
            return t
        meta = getattr(message, "response_metadata", None) or {}
        if isinstance(meta, dict):
            for key in ("token_usage", "usage"):
                inner = meta.get(key)
                if isinstance(inner, dict):
                    t = _tokens_from_flat_mapping(inner)
                    if t and (t[0] or t[1]):
                        return t
            t = _tokens_from_flat_mapping(meta)
            if t and (t[0] or t[1]):
                return t

    info = getattr(gen, "generation_info", None)
    if isinstance(info, dict):
        t = _tokens_from_llm_output(info) or _tokens_from_flat_mapping(info)
        if t and (t[0] or t[1]):
            return t

    return None


def _accumulate_tokens_from_llm_result(response: LLMResult) -> Tuple[int, int]:
    """Sum tokens across all generations; fall back to llm_output if still zero."""
    total_in = 0
    total_out = 0
    found = False

    for gen_list in response.generations or []:
        if not gen_list:
            continue
        for gen in gen_list:
            t = _tokens_from_generation(gen)
            if t and (t[0] or t[1]):
                total_in += t[0]
                total_out += t[1]
                found = True

    if not found and getattr(response, "llm_output", None):
        t = _tokens_from_llm_output(response.llm_output)
        if t and (t[0] or t[1]):
            total_in, total_out = t[0], t[1]

    return total_in, total_out


class StatsCallbackHandler(BaseCallbackHandler):
    """Callback handler that tracks LLM calls, tool calls, and token usage."""

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self.llm_calls = 0
        self.tool_calls = 0
        self.tokens_in = 0
        self.tokens_out = 0

    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        **kwargs: Any,
    ) -> None:
        """Increment LLM call counter when an LLM starts."""
        with self._lock:
            self.llm_calls += 1

    def on_chat_model_start(
        self,
        serialized: Dict[str, Any],
        messages: List[List[Any]],
        **kwargs: Any,
    ) -> None:
        """Increment LLM call counter when a chat model starts."""
        with self._lock:
            self.llm_calls += 1

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        """Extract token usage from LLM response (multiple provider shapes)."""
        try:
            tin, tout = _accumulate_tokens_from_llm_result(response)
        except (TypeError, AttributeError):
            return
        if tin or tout:
            with self._lock:
                self.tokens_in += tin
                self.tokens_out += tout

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        **kwargs: Any,
    ) -> None:
        """Increment tool call counter when a tool starts."""
        with self._lock:
            self.tool_calls += 1

    def get_stats(self) -> Dict[str, Any]:
        """Return current statistics."""
        with self._lock:
            return {
                "llm_calls": self.llm_calls,
                "tool_calls": self.tool_calls,
                "tokens_in": self.tokens_in,
                "tokens_out": self.tokens_out,
            }

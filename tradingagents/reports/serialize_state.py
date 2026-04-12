"""Turn LangGraph / agent state into JSON-serializable dicts for SQLite."""

from __future__ import annotations

from typing import Any, Dict, Mapping, Union


def _message_like_to_dict(obj: Any) -> Dict[str, Any]:
    if hasattr(obj, "type") and hasattr(obj, "content"):
        content = getattr(obj, "content", "")
        if isinstance(content, list):
            content = str(content)
        return {"role": str(getattr(obj, "type", "unknown")), "content": str(content)}
    return {"role": "unknown", "content": str(obj)}


def _serialize_value(value: Any, depth: int = 0) -> Any:
    if depth > 24:
        return str(value)[:8000]
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")[:8000]
    if isinstance(value, Mapping):
        out: Dict[str, Any] = {}
        for k, v in value.items():
            out[str(k)] = _serialize_value(v, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [_serialize_value(x, depth + 1) for x in value]

    mod = type(value).__module__
    name = type(value).__name__
    if mod.startswith("langchain_core.") or mod.startswith("langchain."):
        return _message_like_to_dict(value)

    if hasattr(value, "keys") and hasattr(value, "__getitem__") and callable(getattr(value, "keys", None)):
        try:
            return {str(k): _serialize_value(value[k], depth + 1) for k in value.keys()}
        except Exception:
            pass

    return str(value)[:80000]


def serialize_graph_state(state: Union[Dict[str, Any], Any]) -> Dict[str, Any]:
    """
    Produce a JSON-friendly snapshot of the graph ``final_state`` dict.

    LangChain message objects and debate TypedDicts are normalized to plain structures.
    """
    if not isinstance(state, dict):
        return {"_non_dict_state": str(state)[:80000]}
    return _serialize_value(state, 0)  # type: ignore[return-value]

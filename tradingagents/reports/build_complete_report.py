"""Build a single Markdown document from a persisted ``final_state_snapshot``."""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Tuple

# Order aligned with ``TradingAgentsGraph.REPORT_SECTIONS`` / CLI narrative flow
_SECTIONS: List[Tuple[str, str]] = [
    ("market_report", "Market analyst"),
    ("sentiment_report", "Social / sentiment analyst"),
    ("news_report", "News analyst"),
    ("fundamentals_report", "Fundamentals analyst"),
    ("investment_plan", "Research team (bull / bear / manager)"),
    ("trader_investment_plan", "Trader"),
    ("final_trade_decision", "Risk team & portfolio manager"),
]


def _as_str(blob: Any) -> str:
    if blob is None:
        return ""
    if isinstance(blob, str):
        return blob.strip()
    if isinstance(blob, dict):
        parts: List[str] = []
        for key in (
            "judge_decision",
            "history",
            "bull_history",
            "bear_history",
            "aggressive_history",
            "conservative_history",
            "neutral_history",
        ):
            chunk = blob.get(key)
            if isinstance(chunk, str) and chunk.strip():
                parts.append(f"**{key}:**\n\n{chunk.strip()}")
        return "\n\n".join(parts).strip()
    return str(blob).strip()


def build_cli_style_markdown(
    snap: Dict[str, Any],
    ticker: str,
    *,
    generated_at: datetime.datetime,
) -> str:
    """
    Render analyst sections from ``snap`` (serialized graph state or legacy minimal dict).
    """
    lines: List[str] = []
    lines.append(f"# TradingAgents report — {ticker}")
    lines.append("")
    lines.append(f"_Generated {generated_at.strftime('%Y-%m-%d %H:%M:%S')}_")
    lines.append("")

    coi = str(snap.get("company_of_interest") or ticker).strip()
    td = str(snap.get("trade_date") or "").strip()
    lines.append(f"**Company / ticker:** {coi}")
    lines.append("")
    lines.append(f"**Analysis date:** {td or '—'}")
    lines.append("")

    for key, title in _SECTIONS:
        body = _as_str(snap.get(key))
        if body:
            lines.append(f"## {title}")
            lines.append("")
            lines.append(body)
            lines.append("")

    inv = snap.get("investment_debate_state")
    risk = snap.get("risk_debate_state")
    extra = ""
    if isinstance(inv, dict) and not snap.get("investment_plan"):
        extra = _as_str(inv)
        if extra:
            lines.append("## Investment debate (raw state)")
            lines.append("")
            lines.append(extra)
            lines.append("")
    if isinstance(risk, dict) and not snap.get("final_trade_decision"):
        extra_r = _as_str(risk)
        if extra_r:
            lines.append("## Risk debate (raw state)")
            lines.append("")
            lines.append(extra_r)
            lines.append("")

    if len(lines) <= 6:
        lines.append("## Summary")
        lines.append("")
        lines.append("_No structured sections were stored for this run; see stored decision text if any._")

    return "\n".join(lines).rstrip() + "\n"

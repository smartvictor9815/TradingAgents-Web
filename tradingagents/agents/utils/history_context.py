"""Build historical analysis context for agent prompts.

Queries the report_store SQLite database for past completed analyses of the
same ticker and formats concise summaries for injection into debate and
decision prompts.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

_log = logging.getLogger(__name__)


def _db_path() -> Path:
    root = Path(__file__).resolve().parents[3]
    data_dir = Path(os.environ.get("TRADINGAGENTS_DATA_DIR", str(root / "data")))
    return data_dir / "analysis_reports.db"


def _fetch_ticker_history(ticker: str, limit: int = 5) -> List[Dict[str, Any]]:
    db = _db_path()
    if not db.exists():
        return []
    try:
        conn = sqlite3.connect(str(db), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT report_json
            FROM analysis_reports
            WHERE ticker = ? AND status = 'completed'
            ORDER BY datetime(completed_at) DESC
            LIMIT ?
            """,
            (ticker, limit),
        )
        rows = []
        for r in cur.fetchall():
            try:
                rows.append(json.loads(r["report_json"]))
            except (json.JSONDecodeError, TypeError):
                continue
        conn.close()
        return rows
    except Exception as exc:
        _log.debug("history_context query failed: %s", exc)
        return []


def _extract_summary(report: Dict[str, Any], max_chars: int = 300) -> Optional[str]:
    results = report.get("results")
    if not isinstance(results, dict):
        return None
    decision = results.get("decision", "")
    if not decision:
        return None
    if len(decision) > max_chars:
        decision = decision[:max_chars] + "…"
    return decision


def build_historical_context(ticker: str, limit: int = 5) -> str:
    """Return a formatted string of past analysis summaries for *ticker*.

    If no history is found, returns an empty string so prompts degrade
    gracefully (the ``{historical_context}`` slot simply disappears).
    """
    rows = _fetch_ticker_history(ticker, limit=limit)
    if not rows:
        return ""

    lines: list[str] = []
    for row in rows:
        date = row.get("analysis_date", "?")
        results = row.get("results")
        if not isinstance(results, dict):
            continue
        signal = results.get("signal", "?")
        summary = _extract_summary(row, max_chars=250)
        if not summary:
            continue
        lines.append(f"- {date}: {ticker} → {signal.upper()} — {summary}")

    if not lines:
        return ""

    header = f"**Historical analyses for {ticker} (most recent first):**"
    return header + "\n" + "\n".join(lines)


def build_portfolio_manager_history(ticker: str, limit: int = 5) -> str:
    """Richer history block for Portfolio Manager with dimension confidence."""
    rows = _fetch_ticker_history(ticker, limit=limit)
    if not rows:
        return ""

    lines: list[str] = []
    for row in rows:
        date = row.get("analysis_date", "?")
        results = row.get("results")
        if not isinstance(results, dict):
            continue
        signal = results.get("signal", "?")
        dim_conf = results.get("dimension_confidence")

        summary = _extract_summary(row, max_chars=200)
        if not summary:
            continue

        entry = f"- {date}: {ticker} → **{signal.upper()}**"
        if isinstance(dim_conf, dict):
            scores = ", ".join(f"{k}={v}%" for k, v in dim_conf.items() if isinstance(v, (int, float)))
            if scores:
                entry += f" (confidence: {scores})"
        entry += f"\n  {summary}"
        lines.append(entry)

    if not lines:
        return ""

    header = f"**Historical analyses for {ticker} (most recent first):**"
    return header + "\n" + "\n".join(lines)

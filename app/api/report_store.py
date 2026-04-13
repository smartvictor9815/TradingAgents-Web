"""
Persist analysis reports (JSON) to SQLite for listing and download by task_id.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

_lock = threading.Lock()


def _db_path() -> Path:
    root = Path(__file__).resolve().parents[2]
    data_dir = Path(os.environ.get("TRADINGAGENTS_DATA_DIR", str(root / "data")))
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "analysis_reports.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS analysis_reports (
                    task_id TEXT PRIMARY KEY,
                    ticker TEXT NOT NULL,
                    analysis_date TEXT NOT NULL,
                    status TEXT NOT NULL,
                    report_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    completed_at TEXT
                )
                """
            )
            conn.commit()
        finally:
            conn.close()


def events_to_messages(history: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for h in history:
        ev = h.get("event")
        data = h.get("data") or {}
        ts = data.get("timestamp")
        if isinstance(ts, (int, float)):
            tstr = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%H:%M:%S")
        else:
            tstr = datetime.now(timezone.utc).strftime("%H:%M:%S")
        if ev == "task_start":
            out.append(
                {
                    "time": tstr,
                    "type": "System",
                    "content": f"Started {data.get('ticker', '')} on {data.get('date', '')}",
                }
            )
        elif ev in ("agent_progress", "agent_thought"):
            agent = data.get("agent", "Agent")
            content = (data.get("content") or data.get("message") or "").strip()
            typ = "Thought" if ev == "agent_thought" else "Agent"
            text = f"[{agent}] {content}" if content else f"[{agent}]"
            out.append({"time": tstr, "type": typ, "content": text[:4000]})
        elif ev == "tool_call":
            tool = data.get("tool", "tool")
            args = data.get("args", {})
            out.append({"time": tstr, "type": "Tool", "content": f"{tool}: {args}"[:4000]})
        elif ev == "data_message":
            c = str(data.get("content", ""))[:2000]
            out.append({"time": tstr, "type": "Data", "content": c})
        elif ev == "agent_error":
            out.append(
                {
                    "time": tstr,
                    "type": "Error",
                    "content": str(data.get("error", "")),
                }
            )
        elif ev == "task_complete":
            st = data.get("status", "")
            out.append({"time": tstr, "type": "System", "content": f"Task complete ({st})"})
        elif ev == "task_cancelled":
            out.append({"time": tstr, "type": "System", "content": "Analysis cancelled"})
    return out


def save_running(task_id: str, ticker: str, analysis_date: str, config: Dict[str, Any]) -> None:
    payload = {
        "task_id": task_id,
        "ticker": ticker,
        "analysis_date": analysis_date,
        "configuration": config,
        "status": "running",
        "messages": [],
        "results": None,
        "event_history": [],
    }
    created = datetime.now(timezone.utc).isoformat()
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO analysis_reports (task_id, ticker, analysis_date, status, report_json, created_at, completed_at)
                VALUES (?, ?, ?, 'running', ?, ?, NULL)
                ON CONFLICT(task_id) DO UPDATE SET
                    ticker = excluded.ticker,
                    analysis_date = excluded.analysis_date,
                    status = 'running',
                    report_json = excluded.report_json
                """,
                (task_id, ticker, analysis_date, json.dumps(payload, default=str), created),
            )
            conn.commit()
        finally:
            conn.close()


def save_final(
    task_id: str,
    task: Dict[str, Any],
    event_history: List[Dict[str, Any]],
    final_state_snapshot: Optional[Dict[str, Any]] = None,
) -> None:
    messages = events_to_messages(event_history)
    report: Dict[str, Any] = {
        "task_id": task_id,
        "ticker": task.get("ticker"),
        "analysis_date": task.get("analysis_date"),
        "configuration": task.get("config"),
        "status": task.get("status"),
        "messages": messages,
        "results": task.get("final_decision"),
        "error_message": task.get("error_message"),
        "event_history": event_history,
        "created_at": task.get("created_at"),
        "completed_at": task.get("completed_at"),
        "analysisDate": task.get("analysis_date"),
        "final_state_snapshot": final_state_snapshot,
    }
    body = json.dumps(report, default=str)
    completed_at = task.get("completed_at") or datetime.now(timezone.utc).isoformat()
    created_at = task.get("created_at") or completed_at
    status = str(task.get("status", "unknown"))
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO analysis_reports (task_id, ticker, analysis_date, status, report_json, created_at, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    ticker = excluded.ticker,
                    analysis_date = excluded.analysis_date,
                    status = excluded.status,
                    report_json = excluded.report_json,
                    completed_at = excluded.completed_at
                """,
                (
                    task_id,
                    task.get("ticker", ""),
                    task.get("analysis_date", ""),
                    status,
                    body,
                    created_at,
                    completed_at,
                ),
            )
            conn.commit()
        finally:
            conn.close()


def list_completed(limit: int = 200) -> List[Dict[str, Any]]:
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(
                """
                SELECT task_id, ticker, analysis_date, status, created_at, completed_at, report_json
                FROM analysis_reports
                WHERE status = 'completed'
                ORDER BY datetime(completed_at) DESC
                LIMIT ?
                """,
                (limit,),
            )
            rows = []
            for r in cur.fetchall():
                try:
                    full = json.loads(r["report_json"])
                except json.JSONDecodeError:
                    full = {}
                fd = full.get("results") or {}
                dec = fd.get("decision") if isinstance(fd, dict) else None
                preview = (dec[:280] + "…") if isinstance(dec, str) and len(dec) > 280 else dec
                rows.append(
                    {
                        "task_id": r["task_id"],
                        "ticker": r["ticker"],
                        "analysis_date": r["analysis_date"],
                        "status": r["status"],
                        "created_at": r["created_at"],
                        "completed_at": r["completed_at"],
                        "summary_preview": preview or "",
                        "signal": fd.get("signal") if isinstance(fd, dict) else None,
                    }
                )
            return rows
        finally:
            conn.close()


def update_report_json(task_id: str, updates: Dict[str, Any]) -> bool:
    """Merge ``updates`` into stored report_json. Returns False if task missing."""
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(
                "SELECT report_json FROM analysis_reports WHERE task_id = ?",
                (task_id,),
            )
            row = cur.fetchone()
            if not row:
                return False
            try:
                data = json.loads(row["report_json"])
            except json.JSONDecodeError:
                data = {}
            data.update(updates)
            body = json.dumps(data, default=str, ensure_ascii=False)
            conn.execute(
                "UPDATE analysis_reports SET report_json = ? WHERE task_id = ?",
                (body, task_id),
            )
            conn.commit()
            return True
        finally:
            conn.close()


def get_report(task_id: str) -> Optional[Dict[str, Any]]:
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(
                "SELECT report_json FROM analysis_reports WHERE task_id = ?",
                (task_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return json.loads(row["report_json"])
        except json.JSONDecodeError:
            return None
        finally:
            conn.close()


def delete_report(task_id: str) -> bool:
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute("DELETE FROM analysis_reports WHERE task_id = ?", (task_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

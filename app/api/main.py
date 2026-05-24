from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import datetime
import logging
import time
import uuid
import asyncio
import json
import os
import urllib.parse
import re
import socket
import requests
from typing import Dict, Any, Optional, List

from app.api import report_export
from app.api import report_store
from app.api.structured_log import ta_info, ta_warning

# Load .env file
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../.env'))

from tradingagents.core.api_adapter import TradingAgentAPIAdapter
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.utils.stats_handler import StatsCallbackHandler


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    report_store.init_db()
    yield


app = FastAPI(
    title="TradingAgents Orchestrator API",
    description=(
        "Orchestrates multi-agent analysis. **Secrets:** `runtime.api_key` and "
        "`runtime.alpha_vantage_api_key` are sent by the browser like any JSON field—the "
        "server process can read and use them. Do not expose this API to untrusted networks "
        "without TLS and access control. Task metadata and API responses use "
        "`_sanitize_runtime_config()` (keys redacted as `***`); never log or print raw "
        "request bodies or the full in-memory config dict."
    ),
    lifespan=_lifespan,
)
_log = logging.getLogger("uvicorn.error")

# Setup CORS to allow frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory task store
tasks: Dict[str, Dict[str, Any]] = {}
adapters: Dict[str, TradingAgentAPIAdapter] = {}

class AnalysisRuntime(BaseModel):
    llm_provider: Optional[str] = None
    backend_url: Optional[str] = None
    quick_think_llm: Optional[str] = None
    deep_think_llm: Optional[str] = None
    api_key: Optional[str] = Field(
        default=None,
        description="Provider API key (server-visible). Prefer env-based keys in production; never log raw values.",
    )
    selected_analysts: Optional[List[str]] = None
    output_language: Optional[str] = None
    research_depth: Optional[str] = None
    alpha_vantage_api_key: Optional[str] = Field(
        default=None,
        description="Alpha Vantage key if used (server-visible). Redacted in stored task config and API responses.",
    )
    # Per tradingagents.default_config["data_vendors"] (yfinance | alpha_vantage)
    data_vendors: Optional[Dict[str, str]] = None


class AnalysisRequest(BaseModel):
    ticker: str
    analysis_date: Optional[str] = None
    runtime: Optional[AnalysisRuntime] = None

# Map from frontend provider IDs / names to backend provider keys
PROVIDER_ID_MAP = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "google",
    "deepseek": "deepseek",
    "volcengine": "volcengine",
    "volc": "volcengine",
    "xai": "xai",
    "ollama": "ollama",
    "openrouter": "openrouter",
}

# Map provider key to env var name for API key fallback
PROVIDER_API_KEY_ENV = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GOOGLE_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "volcengine": "VOLCENGINE_API_KEY",
    "xai": "XAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


def _normalize_provider(provider_value: Optional[str]) -> Optional[str]:
    if not provider_value:
        return None

    provider_base = provider_value.lower().strip()
    for prefix, mapped in PROVIDER_ID_MAP.items():
        if provider_base.startswith(prefix):
            return mapped
    return provider_base


def _sanitize_runtime_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return a shallow copy safe to persist on task rows, return to clients, or log.

    Strips `api_key` and `alpha_vantage_api_key` to placeholders. The live in-memory
    graph config keeps real secrets—do not pass that dict to loggers, tracebacks,
    or `print()`. When adding fields that hold credentials, redact them here too.
    """
    safe = dict(config)
    if safe.get("api_key"):
        safe["api_key"] = "***"
    if safe.get("alpha_vantage_api_key"):
        safe["alpha_vantage_api_key"] = "***"
    return safe


def _merge_data_vendors(
    base: Dict[str, Any], partial: Optional[Dict[str, str]]
) -> None:
    """Merge validated vendor choices into config['data_vendors'] (partial updates OK)."""
    if not partial:
        return
    defaults = DEFAULT_CONFIG.get("data_vendors") or {}
    merged = dict(defaults)
    allowed_keys = frozenset(merged.keys())
    allowed_vals = frozenset({"yfinance", "alpha_vantage"})
    for key, val in partial.items():
        if key in allowed_keys and val in allowed_vals:
            merged[key] = val
    base["data_vendors"] = merged


def _build_runtime_config(request: AnalysisRequest) -> Dict[str, Any]:
    """Build per-task runtime config without mutating process environment."""
    config = {**DEFAULT_CONFIG}

    if not request.runtime:
        return config

    runtime = request.runtime.model_dump(exclude_none=True)

    normalized_provider = _normalize_provider(runtime.get("llm_provider"))
    if normalized_provider:
        runtime["llm_provider"] = normalized_provider
        if not runtime.get("api_key"):
            env_key = PROVIDER_API_KEY_ENV.get(normalized_provider)
            if env_key:
                env_value = os.environ.get(env_key)
                if env_value:
                    runtime["api_key"] = env_value

    selected_analysts = runtime.pop("selected_analysts", None)
    if selected_analysts:
        runtime["analyst_agent"] = selected_analysts

    data_vendors_partial = runtime.pop("data_vendors", None)
    config.update(runtime)
    _merge_data_vendors(config, data_vendors_partial)

    return config


@app.post("/api/analyze")
async def start_analysis(request: AnalysisRequest):
    """
    Create a new analysis task. Returns a task_id for tracking.
    """
    task_id = str(uuid.uuid4())
    trade_date = request.analysis_date or datetime.date.today().isoformat()
    
    config = _build_runtime_config(request)

    
    adapter = TradingAgentAPIAdapter(
        config=config,
        event_loop=asyncio.get_running_loop(),
    )
    adapters[task_id] = adapter
    
    tasks[task_id] = {
        "id": task_id,
        "status": "pending",
        "ticker": request.ticker,
        "analysis_date": trade_date,
        "config": _sanitize_runtime_config(config),
        "final_decision": None,
        "error_message": None,
        "created_at": datetime.datetime.now().isoformat(),
        "started_at": None,
        "completed_at": None,
    }
    try:
        report_store.save_running(
            task_id, request.ticker, trade_date, tasks[task_id]["config"]
        )
    except Exception as exc:
        ta_warning(
            _log,
            "save_running_failed",
            task_id=task_id,
            ticker=request.ticker,
            analysis_date=trade_date,
            error=str(exc),
        )

    # Start the analysis in background
    asyncio.create_task(_run_analysis(task_id, adapter, request.ticker, trade_date))
    
    return {"task_id": task_id, "status": "pending"}

async def _run_analysis(task_id: str, adapter: TradingAgentAPIAdapter, ticker: str, trade_date: str):
    """Background task runner"""
    final_state = None
    state_snapshot = None
    persisted = False
    _t0 = time.perf_counter()

    if tasks[task_id].get("status") == "cancelled":
        ta_info(
            _log,
            "analysis_run_skipped_already_cancelled",
            task_id=task_id,
            ticker=ticker,
            analysis_date=trade_date,
        )
        adapter._progress_callback("internal_adapter_complete", {})
        return

    tasks[task_id]["status"] = "running"
    tasks[task_id]["started_at"] = datetime.datetime.now().isoformat()

    adapter._progress_callback("task_start", {"ticker": ticker, "date": trade_date})

    try:
        loop = asyncio.get_running_loop()
        from tradingagents.graph.trading_graph import TradingAgentsGraph
        from tradingagents.reports.serialize_state import serialize_graph_state

        stats_handler = StatsCallbackHandler()
        selected_analysts = adapter.config.get("analyst_agent")
        graph = TradingAgentsGraph(
            selected_analysts=selected_analysts if selected_analysts else ["market", "social", "news", "fundamentals"],
            debug=False,
            config=adapter.config,
            callbacks=[stats_handler],
            progress_callback=adapter._progress_callback,
        )

        adapter.attach_running_graph(graph)
        try:
            if tasks[task_id].get("status") == "cancelled":
                tasks[task_id]["completed_at"] = datetime.datetime.now().isoformat()
                tasks[task_id]["final_decision"] = None
                try:
                    hist = list(adapter.event_history)
                    report_store.save_final(task_id, tasks[task_id], hist, final_state_snapshot=None)
                    persisted = True
                except Exception as exc:
                    ta_warning(
                        _log,
                        "save_final_failed",
                        task_id=task_id,
                        ticker=ticker,
                        analysis_date=trade_date,
                        phase="pre_propagate_cancelled",
                        error=str(exc),
                    )
                adapter._progress_callback("task_complete", {
                    "status": "cancelled",
                    "final_decision": None,
                    "error_message": None,
                })
                return

            result = await loop.run_in_executor(None, graph.propagate, ticker, trade_date)
        finally:
            adapter.detach_running_graph()

        # Extract final decision from result returned by graph.propagate
        signal = "neutral"
        if isinstance(result, tuple):
            final_state, signal = result
        else:
            final_state = result

        if signal == "CANCELLED" or tasks[task_id].get("status") == "cancelled":
            tasks[task_id]["status"] = "cancelled"
            tasks[task_id]["completed_at"] = datetime.datetime.now().isoformat()
            tasks[task_id]["final_decision"] = None
            try:
                hist = list(adapter.event_history)
                report_store.save_final(task_id, tasks[task_id], hist, final_state_snapshot=None)
                persisted = True
            except Exception as exc:
                ta_warning(
                    _log,
                    "save_final_failed",
                    task_id=task_id,
                    ticker=ticker,
                    analysis_date=trade_date,
                    phase="after_cancelled_propagate",
                    error=str(exc),
                )
            adapter._progress_callback("task_complete", {
                "status": "cancelled",
                "final_decision": None,
                "error_message": None,
            })
            return

        final_decision = None
        if isinstance(final_state, dict):
            decision_text = final_state.get("final_trade_decision") or final_state.get("decision")
            fallback_confidence = _extract_analyst_dimension_confidence(final_state)
            if decision_text:
                rendered_decision, dimension_confidence = _extract_structured_decision(
                    str(decision_text)
                )
                merged_confidence = _merge_dimension_confidence(
                    dimension_confidence, fallback_confidence
                )
                final_decision = {
                    "decision": rendered_decision or str(decision_text),
                    "signal": signal or "neutral",
                }
                if merged_confidence:
                    final_decision["dimension_confidence"] = merged_confidence
            state_snapshot = serialize_graph_state(final_state)
        elif final_state:
            rendered_decision, dimension_confidence = _extract_structured_decision(
                str(final_state)
            )
            final_decision = {
                "decision": rendered_decision or str(final_state),
                "signal": signal or "neutral",
            }
            if dimension_confidence:
                final_decision["dimension_confidence"] = dimension_confidence

        tasks[task_id]["status"] = "completed"
        tasks[task_id]["completed_at"] = datetime.datetime.now().isoformat()
        tasks[task_id]["final_decision"] = final_decision

        # Persist before task_complete so /api/history/{id}/export is ready when the UI unlocks.
        try:
            hist = list(adapter.event_history)
            report_store.save_final(
                task_id,
                tasks[task_id],
                hist,
                final_state_snapshot=state_snapshot,
            )
            persisted = True
        except Exception as exc:
            ta_warning(
                _log,
                "save_final_failed",
                task_id=task_id,
                ticker=ticker,
                analysis_date=trade_date,
                phase="completed_path",
                error=str(exc),
            )

        adapter._progress_callback("task_complete", {
            "status": "completed",
            "final_decision": final_decision,
            "error_message": None,
        })

        # Auto-reflect so agents accumulate lessons across runs
        try:
            graph.self_reflect()
            ta_info(
                _log,
                "self_reflect_completed",
                task_id=task_id,
                ticker=ticker,
            )
        except Exception as exc:
            ta_warning(
                _log,
                "self_reflect_failed",
                task_id=task_id,
                ticker=ticker,
                error=str(exc),
            )
    except asyncio.CancelledError:
        tasks[task_id]["status"] = "cancelled"
        adapter._progress_callback("task_cancelled", {})
    except Exception as e:
        if tasks[task_id].get("status") == "cancelled":
            pass
        else:
            tasks[task_id]["status"] = "error"
            tasks[task_id]["error_message"] = str(e)
            tasks[task_id]["completed_at"] = datetime.datetime.now().isoformat()
            ta_warning(
                _log,
                "analysis_run_error",
                task_id=task_id,
                ticker=ticker,
                analysis_date=trade_date,
                error=str(e),
            )
            adapter._progress_callback("agent_error", {"error": str(e), "agent": "System"})
            adapter._progress_callback("task_complete", {
                "status": "error",
                "final_decision": None,
                "error_message": str(e),
            })
    finally:
        try:
            if task_id in tasks and not persisted:
                hist = list(adapter.event_history)
                report_store.save_final(
                    task_id,
                    tasks[task_id],
                    hist,
                    final_state_snapshot=state_snapshot,
                )
        except Exception as exc:
            ta_warning(
                _log,
                "save_final_failed",
                task_id=task_id,
                ticker=ticker,
                analysis_date=trade_date,
                phase="finally_block",
                error=str(exc),
            )
        duration_ms = round((time.perf_counter() - _t0) * 1000.0, 2)
        ta_info(
            _log,
            "analysis_run_finished",
            task_id=task_id,
            ticker=ticker,
            analysis_date=trade_date,
            duration_ms=duration_ms,
            status=tasks.get(task_id, {}).get("status"),
            persisted=persisted,
        )
        adapter._progress_callback("internal_adapter_complete", {})

@app.get("/api/task/{task_id}")
async def get_task_status(task_id: str):
    """Get current status of an analysis task."""
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    payload = dict(tasks[task_id])

    # Provide resumable logs so the Analysis page can restore full history
    # instead of a synthetic "loaded" system message.
    messages: List[Dict[str, Any]] = []
    adapter = adapters.get(task_id)
    if adapter is not None:
        try:
            hist = list(getattr(adapter, "event_history", []) or [])
            if hist:
                messages = report_store.events_to_messages(hist)
        except Exception:
            messages = []
    if not messages:
        try:
            row = report_store.get_report(task_id)
            if isinstance(row, dict) and isinstance(row.get("messages"), list):
                messages = row.get("messages") or []
        except Exception:
            messages = []
    payload["messages"] = messages
    return payload

@app.get("/api/task/{task_id}/stream")
async def stream_task(task_id: str):
    """SSE stream for task progress events."""
    if task_id not in adapters:
        raise HTTPException(status_code=404, detail="Task not found")
    
    adapter = adapters[task_id]
    
    async def event_generator():
        q = await adapter.subscribe()
        try:
            # Send events from history with a tiny delay to prevent socket overload
            # while the client is still initializing the EventSource
            while not q.empty():
                msg = q.get_nowait()
                payload = json.dumps(msg)
                msg_id = msg.get("id", "")
                yield f"id: {msg_id}\ndata: {payload}\n\n"
                await asyncio.sleep(0.05)
                
            while True:
                msg = await q.get()
                event_type = msg.get("event")
                
                if event_type == "internal_adapter_complete":
                    break
                
                payload = json.dumps(msg)
                msg_id = msg.get("id", "")
                yield f"id: {msg_id}\ndata: {payload}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            adapter.unsubscribe(q)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

@app.delete("/api/task/{task_id}")
async def cancel_task(task_id: str):
    """Cancel a running analysis task."""
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    cur = tasks[task_id]["status"]
    if cur in ("completed", "cancelled", "error"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel task with status '{cur}'",
        )

    tasks[task_id]["status"] = "cancelled"
    tasks[task_id]["completed_at"] = datetime.datetime.now().isoformat()

    if task_id in adapters:
        adapters[task_id].request_cancel()

    return {"status": "cancelled", "task_id": task_id}

class ProviderTestRequest(BaseModel):
    provider: str
    baseUrl: str
    apiKey: str
    model: str


class AlphaVantageKeyValidateRequest(BaseModel):
    api_key: str


def _mask_secret_in_text(text: str, secret: Optional[str]) -> str:
    """Best-effort redact of request-scoped secret from error text."""
    if not text:
        return text
    s = (secret or "").strip()
    if not s:
        return text
    return text.replace(s, "***")


def _flatten_exception_messages(exc: BaseException) -> List[str]:
    """Collect useful messages from exception/cause/context/group chain."""
    out: List[str] = []
    queue: List[BaseException] = [exc]
    seen: set[int] = set()

    while queue:
        cur = queue.pop(0)
        cur_id = id(cur)
        if cur_id in seen:
            continue
        seen.add(cur_id)

        msg = str(cur).strip()
        name = type(cur).__name__
        out.append(f"{name}: {msg}" if msg else name)

        cause = getattr(cur, "__cause__", None)
        if isinstance(cause, BaseException):
            queue.append(cause)
        context = getattr(cur, "__context__", None)
        if isinstance(context, BaseException):
            queue.append(context)
        if type(cur).__name__ == "ExceptionGroup":
            for sub in getattr(cur, "exceptions", ()) or ():
                if isinstance(sub, BaseException):
                    queue.append(sub)

    # Keep order while removing duplicates.
    deduped: List[str] = []
    seen_msg: set[str] = set()
    for item in out:
        if item in seen_msg:
            continue
        deduped.append(item)
        seen_msg.add(item)
    return deduped


def _probe_provider_endpoint(base_url: str, timeout_sec: float = 5.0) -> Optional[str]:
    """
    Best-effort host/port probe to disambiguate generic SDK "Connection error".
    Returns a user-facing hint when a concrete network-layer issue is detected.
    """
    raw = (base_url or "").strip()
    if not raw:
        return None

    try:
        parsed = urllib.parse.urlparse(raw)
    except Exception:
        return "Base URL format is invalid"

    host = parsed.hostname
    if not host:
        return "Base URL format is invalid"
    port = parsed.port
    if port is None:
        port = 443 if parsed.scheme.lower() == "https" else 80

    try:
        socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return "Cannot resolve provider host - check the Base URL domain"
    except OSError:
        return "Cannot resolve provider host - check DNS/network settings"

    try:
        with socket.create_connection((host, port), timeout=timeout_sec):
            pass
    except TimeoutError:
        return "Provider endpoint connection timed out - check network/firewall"
    except OSError:
        return "Connection refused by provider endpoint - check host/port"

    return None


def _alpha_vantage_key_format_error(key: str) -> Optional[str]:
    """
    Alpha Vantage assigns 16-character alphanumeric keys. Their quote endpoints currently
    return sample data even for arbitrary strings, so shape validation is the reliable check.
    """
    k = key.strip()
    ku = k.upper()
    if len(ku) != 16:
        return (
            f"Alpha Vantage keys must be exactly 16 letters or digits (you have {len(ku)}). "
            "Copy the key from https://www.alphavantage.co/support/#api-key — no spaces."
        )
    if not re.fullmatch(r"[A-Z0-9]{16}", ku):
        return (
            "Alpha Vantage keys use only letters (A–Z) and digits (0–9), 16 characters total. "
            "Remove spaces or symbols."
        )
    return None


def _summarize_alpha_vantage_json(data: Any, max_len: int = 400) -> str:
    """Short, safe description of an Alpha Vantage JSON body for user-facing errors."""
    if data is None:
        return "(empty body)"
    if not isinstance(data, dict):
        s = repr(data)
        return s if len(s) <= max_len else s[: max_len - 1] + "…"

    if not data:
        return "(empty JSON object {})"

    lines: List[str] = []
    for k in sorted(data.keys()):
        v = data[k]
        if isinstance(v, str):
            snippet = v.replace("\n", " ").strip()
            if len(snippet) > 220:
                snippet = snippet[:217] + "…"
            lines.append(f'{k}: "{snippet}"')
        elif isinstance(v, dict):
            lines.append(f"{k}: object with {len(v)} field(s)")
        elif isinstance(v, list):
            lines.append(f"{k}: array[{len(v)}]")
        else:
            lines.append(f"{k}: {v!r}")
    out = " | ".join(lines)
    return out if len(out) <= max_len else out[: max_len - 1] + "…"


_CONFIDENCE_KEYS = (
    "market",
    "sentiment",
    "news",
    "fundamentals",
    "research",
    "risk",
)


_ANALYST_DIMENSION_MAP = (
    ("market_report", "market"),
    ("sentiment_report", "sentiment"),
    ("news_report", "news"),
    ("fundamentals_report", "fundamentals"),
)


def _normalize_dimension_confidence(raw: Any) -> Optional[Dict[str, int]]:
    if not isinstance(raw, dict):
        return None
    out: Dict[str, int] = {}
    for k in _CONFIDENCE_KEYS:
        v = raw.get(k)
        if v is None:
            continue
        try:
            n = int(round(float(v)))
        except (TypeError, ValueError):
            continue
        out[k] = max(0, min(100, n))
    return out or None


def _extract_confidence_score_from_text(report_text: Any) -> Optional[int]:
    """Extract confidence score from analyst report markdown."""
    if not isinstance(report_text, str) or not report_text.strip():
        return None
    txt = report_text
    patterns = (
        r"confidence_score\s*[:：]\s*(\d{1,3})",
        r"confidence\s*score\s*[:：]\s*(\d{1,3})",
        r"confidence\s*[:：]\s*(\d{1,3})\s*%?",
    )
    for p in patterns:
        m = re.search(p, txt, flags=re.IGNORECASE)
        if not m:
            continue
        try:
            n = int(m.group(1))
        except (TypeError, ValueError):
            continue
        return max(0, min(100, n))
    return None


def _extract_analyst_dimension_confidence(final_state: Dict[str, Any]) -> Dict[str, int]:
    """Fallback confidence inferred from analyst report tails."""
    out: Dict[str, int] = {}
    for report_key, dim in _ANALYST_DIMENSION_MAP:
        score = _extract_confidence_score_from_text(final_state.get(report_key))
        if score is not None:
            out[dim] = score
    return out


def _merge_dimension_confidence(
    primary: Optional[Dict[str, int]],
    fallback: Optional[Dict[str, int]],
) -> Optional[Dict[str, int]]:
    if not primary and not fallback:
        return None
    merged: Dict[str, int] = {}
    for k in _CONFIDENCE_KEYS:
        if primary and k in primary:
            merged[k] = primary[k]
        elif fallback and k in fallback:
            merged[k] = fallback[k]
    return merged or None


def _extract_structured_decision(decision_text: str) -> tuple[str, Optional[Dict[str, int]]]:
    """
    Parse optional JSON payload emitted by portfolio manager and return:
    - markdown decision text for UI
    - normalized dimension confidence map
    """
    txt = (decision_text or "").strip()
    if not txt:
        return "", None

    candidates: List[str] = []
    fenced = re.search(r"```json\s*(\{[\s\S]*?\})\s*```", txt, flags=re.IGNORECASE)
    if fenced:
        candidates.append(fenced.group(1))
    if txt.startswith("{") and txt.endswith("}"):
        candidates.append(txt)

    parsed: Optional[Dict[str, Any]] = None
    for c in candidates:
        try:
            obj = json.loads(c)
            if isinstance(obj, dict):
                parsed = obj
                break
        except json.JSONDecodeError:
            continue

    if parsed is None:
        return txt, None

    confidence = _normalize_dimension_confidence(parsed.get("dimension_confidence"))
    rating = str(parsed.get("rating") or "").strip()
    executive_summary = str(parsed.get("executive_summary") or "").strip()
    investment_thesis = str(parsed.get("investment_thesis") or "").strip()

    if rating or executive_summary or investment_thesis:
        lines: List[str] = []
        if rating:
            lines.append("## Rating")
            lines.append(rating)
            lines.append("")
        if executive_summary:
            lines.append("## Executive Summary")
            lines.append(executive_summary)
            lines.append("")
        if investment_thesis:
            lines.append("## Investment Thesis")
            lines.append(investment_thesis)
            lines.append("")
        if confidence:
            lines.append("## Dimension Confidence")
            for k in _CONFIDENCE_KEYS:
                if k in confidence:
                    lines.append(f"- {k}: {confidence[k]}%")
        return "\n".join(lines).strip(), confidence

    return txt, confidence


@app.post("/api/validate-alpha-vantage")
def validate_alpha_vantage_api_key(request: AlphaVantageKeyValidateRequest):
    """Validate key shape (16 alnum) and reach Alpha Vantage; see _alpha_vantage_key_format_error docstring."""
    key = (request.api_key or "").strip()
    if not key:
        return {"ok": True}

    fmt_err = _alpha_vantage_key_format_error(key)
    if fmt_err:
        return {"ok": False, "message": fmt_err}

    resp: Optional[requests.Response] = None
    try:
        resp = requests.get(
            "https://www.alphavantage.co/query",
            params={
                "function": "GLOBAL_QUOTE",
                "symbol": "IBM",
                "apikey": key.strip(),
            },
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        return {"ok": False, "message": f"Could not reach Alpha Vantage: {e}"}
    except json.JSONDecodeError as e:
        preview = ""
        if resp is not None and resp.text:
            preview = resp.text.replace("\n", " ").strip()[:320]
        return {
            "ok": False,
            "message": (
                f"Alpha Vantage returned non-JSON (HTTP {resp.status_code if resp else '?'}). "
                f"Parser: {e}. "
                + (f'Body starts with: «{preview}…»' if preview else "Empty body.")
            ),
        }

    if not isinstance(data, dict):
        return {
            "ok": False,
            "message": (
                "Alpha Vantage returned non-object JSON while checking your key. "
                f"Summary: {_summarize_alpha_vantage_json(data)}"
            ),
        }

    err = data.get("Error Message")
    if isinstance(err, str):
        return {"ok": False, "message": err}

    if len(data) == 0:
        return {
            "ok": False,
            "message": "Alpha Vantage returned an empty JSON object; try again later.",
        }

    return {"ok": True}


@app.post("/api/test-provider")
async def test_provider(request: ProviderTestRequest):
    """Test LLM provider connection with a simple API call."""
    try:
        provider_key = PROVIDER_ID_MAP.get(
            request.provider.lower(), request.provider.lower()
        )
        
        # Import and test the client
        from tradingagents.llm_clients.factory import create_llm_client

        client = create_llm_client(
            provider=provider_key,
            model=request.model,
            base_url=request.baseUrl if request.baseUrl else None,
            api_key=request.apiKey,
        )
        
        # Test with a simple completion
        llm = client.get_llm()
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None,
            lambda: llm.invoke("Say 'OK' if you can hear me."),
        )

        return {"success": True, "response": str(response.content)[:100]}

    except asyncio.CancelledError:
        raise
    except BaseException as e:
        # ExceptionGroup (Py3.11+) is BaseException, not Exception; if uncaught it becomes HTTP 500.
        if not isinstance(e, Exception) and type(e).__name__ != "ExceptionGroup":
            raise
        chain_messages = _flatten_exception_messages(e)
        error_msg = "; ".join(chain_messages) if chain_messages else str(e)
        error_msg = _mask_secret_in_text(error_msg, request.apiKey)
        _log.warning(
            "Provider test failed (provider=%s model=%s base_url=%s): %s",
            request.provider,
            request.model,
            request.baseUrl,
            error_msg,
            exc_info=isinstance(e, Exception),
        )
        el = error_msg.lower()
        connectivity_hint = None
        if "connection error" in el or "apiconnectionerror" in el:
            connectivity_hint = _probe_provider_endpoint(request.baseUrl)
        if "authentication" in el or "api key" in el or "unauthorized" in el or "invalid key" in el:
            error_msg = "Invalid API key"
        elif re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", el):
            # Some providers may echo key-like identifiers in errors; do not expose raw value.
            error_msg = "Invalid API key"
        elif "model" in el and "not found" in el:
            error_msg = "Model not found - check your model name"
        elif (
            "name or service not known" in el
            or "nodename nor servname provided" in el
            or "temporary failure in name resolution" in el
            or "dns" in el
        ):
            error_msg = "Cannot resolve provider host - check the Base URL domain"
        elif "connection refused" in el:
            error_msg = "Connection refused by provider endpoint - check host/port"
        elif "timed out" in el or "timeout" in el:
            error_msg = "Provider request timed out - check network or endpoint availability"
        elif "ssl" in el or "certificate" in el:
            error_msg = "TLS/SSL handshake failed - check endpoint certificate or proxy settings"
        elif connectivity_hint:
            error_msg = connectivity_hint
        elif "connection" in el:
            error_msg = "Cannot connect to provider endpoint - check Base URL and network"
        elif "error" in el and "api connection" in el:
            error_msg = "Provider endpoint is reachable, but request failed - check API key/model or proxy settings"
        return {"success": False, "error": error_msg[:200]}

@app.get("/api/history")
@app.get("/api/reports")
async def list_reports(limit: int = 200):
    """List completed analysis history persisted on the server."""
    cap = max(1, min(limit, 500))
    return report_store.list_completed(cap)


@app.get("/api/history/{task_id}")
@app.get("/api/reports/{task_id}")
async def get_stored_report(task_id: str):
    """Return full JSON for a stored history entry."""
    row = report_store.get_report(task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return row


@app.get("/api/history/{task_id}/export")
@app.get("/api/reports/{task_id}/export")
async def export_professional_report(
    task_id: str,
    export_format: str = Query(
        "markdown",
        description="Export format: markdown, pdf, or docx",
        alias="format",
    ),
    enhanced: bool = Query(
        True,
        description="Include LLM professional synthesis (cached per task; uses stored provider config)",
    ),
    refresh_enhancement: bool = Query(
        False,
        description="Force regeneration of LLM synthesis",
    ),
):
    """Download CLI-aligned agent report + optional LLM synthesis as Markdown, PDF, or DOCX."""
    loop = asyncio.get_running_loop()
    _t_exp = time.perf_counter()
    try:
        body, filename, media = await report_export.build_export_payload(
            task_id,
            export_format,
            enhanced=enhanced,
            refresh_enhancement=refresh_enhancement,
            loop=loop,
        )
    except LookupError as e:
        ta_warning(
            _log,
            "export_not_found",
            task_id=task_id,
            format=export_format,
            enhanced=enhanced,
            error=str(e),
        )
        raise HTTPException(status_code=404, detail=str(e))
    except report_export.PdfGenerationFailed as e:
        ta_warning(
            _log,
            "export_pdf_failed",
            task_id=task_id,
            format="pdf",
            duration_ms=round((time.perf_counter() - _t_exp) * 1000.0, 2),
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=str(e))
    except report_export.DocxGenerationFailed as e:
        ta_warning(
            _log,
            "export_docx_failed",
            task_id=task_id,
            format="docx",
            duration_ms=round((time.perf_counter() - _t_exp) * 1000.0, 2),
            error=str(e),
        )
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        ta_warning(
            _log,
            "export_bad_request",
            task_id=task_id,
            format=export_format,
            error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e))
    ascii_name = filename.encode("ascii", "replace").decode("ascii")
    cd = (
        f'attachment; filename="{ascii_name}"; '
        f"filename*=UTF-8''{urllib.parse.quote(filename)}"
    )
    return Response(
        content=body,
        media_type=media,
        headers={"Content-Disposition": cd},
    )


@app.get("/api/history/{task_id}/download")
@app.get("/api/reports/{task_id}/download")
async def download_stored_report(task_id: str):
    """Download stored history JSON as an attachment."""
    row = report_store.get_report(task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    ticker = str(row.get("ticker", "unknown")).replace("/", "-")
    date = str(row.get("analysis_date", "unknown")).replace("/", "-")
    filename = f"trading-analysis-{ticker}-{date}.json"
    body = json.dumps(row, default=str, ensure_ascii=False).encode("utf-8")
    ascii_name = filename.encode("ascii", "replace").decode("ascii")
    cd = (
        f'attachment; filename="{ascii_name}"; '
        f"filename*=UTF-8''{urllib.parse.quote(filename)}"
    )
    return Response(
        content=body,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": cd},
    )


@app.delete("/api/history/{task_id}")
@app.delete("/api/reports/{task_id}")
async def delete_stored_report(task_id: str):
    """Remove a stored history entry from the server database."""
    deleted = report_store.delete_report(task_id)
    return {"deleted": deleted}


@app.get("/api/health")
async def health_check():
    """Health check endpoint for the orchestrated components."""
    return {"status": "ok", "service": "TradingAgents Orchestrator"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

"""Build professional exports (Markdown / PDF / DOCX) from persisted ``final_state_snapshot``."""

from __future__ import annotations

import asyncio
import datetime
import logging
from datetime import timezone
from functools import partial
from typing import Any, Dict, Tuple

from app.api import report_store
from app.api.structured_log import ta_warning
from tradingagents.reports.assemble import assemble_full_report_markdown
from tradingagents.reports.build_complete_report import build_cli_style_markdown
from tradingagents.reports.export_formats import markdown_to_docx_bytes, try_markdown_to_pdf_bytes
from tradingagents.reports.llm_enhancement import generate_llm_enhancement

_log = logging.getLogger("uvicorn.error")


class PdfGenerationFailed(Exception):
    """PDF backends could not produce output (missing deps or unsupported content)."""


class DocxGenerationFailed(Exception):
    """DOCX export failed (missing python-docx or invalid / oversized content)."""


def _normalize_fmt(fmt: str) -> str:
    f = (fmt or "markdown").lower().strip()
    if f in ("md", "markdown", "text"):
        return "markdown"
    if f == "pdf":
        return "pdf"
    if f in ("docx", "word"):
        return "docx"
    return f


async def build_export_payload(
    task_id: str,
    fmt: str,
    *,
    enhanced: bool,
    refresh_enhancement: bool,
    loop: asyncio.AbstractEventLoop,
) -> Tuple[bytes, str, str]:
    """
    Returns (body_bytes, download_filename, media_type).
    """
    row = report_store.get_report(task_id)
    if row is None:
        raise LookupError("Report not found")

    snap = row.get("final_state_snapshot")
    if not isinstance(snap, dict):
        snap = {}
    # Legacy rows may have null/{} snapshot; still export using fallback section + stored results.
    if not snap:
        results = row.get("results") if isinstance(row.get("results"), dict) else {}
        lines: list[str] = []
        for key, label in (
            ("decision", "Decision"),
            ("signal", "Signal"),
            ("reasoning", "Reasoning"),
        ):
            v = results.get(key)
            if isinstance(v, str) and v.strip():
                lines.append(f"**{label}:** {v.strip()}")
        if lines:
            snap = {"final_trade_decision": "\n\n".join(lines)}
        else:
            snap = {}

    ticker = str(row.get("ticker") or snap.get("company_of_interest") or "unknown").replace("/", "-")
    adate = str(row.get("analysis_date") or "unknown").replace("/", "-")
    cfg: Dict[str, Any] = row.get("configuration") or {}
    if not isinstance(cfg, dict):
        cfg = {}
    output_language = str(cfg.get("output_language") or "english")

    base_md = build_cli_style_markdown(
        snap,
        ticker,
        generated_at=datetime.datetime.now(),
    )

    enh: str | None = None
    if enhanced:
        cached = row.get("llm_enhancement_md")
        if isinstance(cached, str) and cached.strip() and not refresh_enhancement:
            enh = cached
        else:
            try:
                fn = partial(
                    generate_llm_enhancement,
                    agent_outputs_markdown=base_md,
                    output_language=output_language,
                    ticker=str(row.get("ticker") or ""),
                    analysis_date=str(row.get("analysis_date") or ""),
                    final_decision=row.get("results") if isinstance(row.get("results"), dict) else None,
                    runtime_config=cfg,
                )
                enh = await loop.run_in_executor(None, fn)
                report_store.update_report_json(
                    task_id,
                    {
                        "llm_enhancement_md": enh,
                        "llm_enhancement_at": datetime.datetime.now(timezone.utc).isoformat(),
                    },
                )
            except Exception as exc:
                ta_warning(
                    _log,
                    "llm_enhancement_failed",
                    task_id=task_id,
                    ticker=str(row.get("ticker") or ""),
                    analysis_date=str(row.get("analysis_date") or ""),
                    enhanced=enhanced,
                    refresh_enhancement=refresh_enhancement,
                    error=str(exc),
                )
                enh = None

    full_md = assemble_full_report_markdown(
        base_markdown=base_md,
        enhancement_markdown=enh if enhanced else None,
        include_disclaimer=True,
    )

    nf = _normalize_fmt(fmt)
    if nf == "markdown":
        body = full_md.encode("utf-8")
        name = f"TradingAgents_{ticker}_{adate}_report.md"
        return body, name, "text/markdown; charset=utf-8"

    if nf == "docx":
        try:
            body = markdown_to_docx_bytes(full_md)
        except RuntimeError as e:
            raise DocxGenerationFailed(str(e)) from e
        except Exception as e:
            ta_warning(
                _log,
                "docx_bytes_failed",
                task_id=task_id,
                ticker=ticker,
                analysis_date=adate,
                error=str(e),
            )
            _log.exception("DOCX export traceback task_id=%s", task_id)
            raise DocxGenerationFailed(
                f"DOCX generation failed: {e}. If this persists, check server logs and ensure "
                "python-docx is installed."
            ) from e
        name = f"TradingAgents_{ticker}_{adate}_report.docx"
        return (
            body,
            name,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

    if nf == "pdf":
        pdf = try_markdown_to_pdf_bytes(full_md)
        if not pdf:
            raise PdfGenerationFailed(
                "PDF generation failed. Install fpdf2 in the API environment (pip install fpdf2 "
                "or uv pip install fpdf2), then restart the server. Optional: xhtml2pdf for "
                "richer layout (may need system Cairo on macOS). Check server logs for details."
            )
        name = f"TradingAgents_{ticker}_{adate}_report.pdf"
        return pdf, name, "application/pdf"

    raise ValueError(f"Unsupported format: {fmt}")

"""Markdown → DOCX / PDF bytes for API download endpoints."""

from __future__ import annotations

import html
import io
import re
from typing import Optional


def markdown_to_docx_bytes(md: str) -> bytes:
    """Very small Markdown → DOCX mapping (headings + paragraphs)."""
    try:
        from docx import Document
    except ImportError as e:
        raise RuntimeError("python-docx is not installed; pip install python-docx") from e

    doc = Document()
    doc.add_heading("TradingAgents report", 0)
    blocks = re.split(r"\n{2,}", md.strip() or "(empty)")
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        if block.startswith("# "):
            doc.add_heading(block[2:].strip(), level=1)
        elif block.startswith("## "):
            doc.add_heading(block[3:].strip(), level=2)
        elif block.startswith("### "):
            doc.add_heading(block[4:].strip(), level=3)
        elif block.startswith("#### "):
            doc.add_heading(block[5:].strip(), level=4)
        else:
            doc.add_paragraph(block)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _md_to_simple_html(md: str) -> str:
    try:
        import markdown as md_lib

        return md_lib.markdown(md, extensions=["extra", "nl2br", "tables"])
    except Exception:
        return f"<pre>{html.escape(md)}</pre>"


def try_markdown_to_pdf_bytes(md: str) -> Optional[bytes]:
    """
    Try xhtml2pdf first (better layout); fall back to fpdf2 plain text.
    Returns None if no backend could produce PDF bytes.
    """
    wrapped = f"""<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>{_md_to_simple_html(md)}</body></html>"""

    try:
        from xhtml2pdf import pisa

        out = io.BytesIO()
        status = pisa.CreatePDF(src=wrapped, dest=out, encoding="utf-8")
        if status.err:
            raise RuntimeError(f"xhtml2pdf status err={status.err}")
        raw = out.getvalue()
        if raw:
            return raw
    except Exception:
        pass

    try:
        from fpdf import FPDF

        class _PDF(FPDF):
            def __init__(self) -> None:
                super().__init__()
                self.set_auto_page_break(auto=True, margin=14)

        pdf = _PDF()
        pdf.add_page()
        pdf.set_font("Helvetica", size=10)
        plain = re.sub(r"#{1,6}\s*", "", md)
        for chunk in plain.split("\n\n"):
            line = chunk.strip()
            if not line:
                continue
            pdf.multi_cell(0, 5, line)
            pdf.ln(2)
        out_b = pdf.output(dest="S")
        if isinstance(out_b, (bytes, bytearray)):
            return bytes(out_b)
        if isinstance(out_b, str):
            return out_b.encode("latin-1", errors="replace")
        return bytes(out_b or b"")
    except Exception:
        return None

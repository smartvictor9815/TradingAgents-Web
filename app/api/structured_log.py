"""Structured, grep-friendly log lines for the orchestrator API."""

from __future__ import annotations

import json
import logging
from typing import Any

_PREFIX = "tradingagents_api"


def ta_log(
    logger: logging.Logger,
    level: int,
    event: str,
    *,
    msg: str | None = None,
    **fields: Any,
) -> None:
    """Emit one line: prefix, event name, optional msg, and JSON object of fields."""
    data = {k: v for k, v in fields.items() if v is not None}
    parts = [f"{_PREFIX}", f"event={event}"]
    if msg:
        parts.append(f"msg={msg}")
    parts.append(f"data={json.dumps(data, default=str, ensure_ascii=False)}")
    logger.log(level, " ".join(parts))


def ta_warning(logger: logging.Logger, event: str, **fields: Any) -> None:
    ta_log(logger, logging.WARNING, event, **fields)


def ta_info(logger: logging.Logger, event: str, **fields: Any) -> None:
    ta_log(logger, logging.INFO, event, **fields)

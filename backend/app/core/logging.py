"""
Structured logging for the KAKSHA numerical pipeline.

Every stage of the pipeline emits a structured record so a run can be replayed
and debugged: data retrieval, propagation, screening, numerical failures,
validation failures, API requests, LLM requests and simulation events.

Records are also kept in a bounded in-memory ring buffer so the /debug
endpoints (and the VALIDATION page) can show what the engine actually did
during a demonstration without tailing a file.
"""
from __future__ import annotations

import json
import logging
import sys
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque

_RING: Deque[dict[str, Any]] = deque(maxlen=2000)

# Pipeline stages -- used as the `stage` field so logs can be filtered by the
# architectural layer that produced them.
STAGE_DATA = "data"
STAGE_PROPAGATION = "propagation"
STAGE_SCREENING = "screening"
STAGE_CONJUNCTION = "conjunction"
STAGE_BPLANE = "bplane"
STAGE_UNCERTAINTY = "uncertainty"
STAGE_VALIDATION = "validation"
STAGE_RISK = "risk"
STAGE_API = "api"
STAGE_LLM = "llm"
STAGE_SIM = "simulation"


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        extra = getattr(record, "kaksha", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(debug: bool = True) -> None:
    root = logging.getLogger("kaksha")
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root.addHandler(handler)
    root.setLevel(logging.DEBUG if debug else logging.INFO)
    root.propagate = False


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"kaksha.{name}")


def log_event(
    logger: logging.Logger,
    stage: str,
    event: str,
    level: int = logging.INFO,
    **fields: Any,
) -> None:
    """Emit a structured pipeline event and mirror it into the debug ring."""
    record = {"stage": stage, "event": event, **fields}
    _RING.append(
        {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": logging.getLevelName(level),
            **record,
        }
    )
    logger.log(level, event, extra={"kaksha": record})


def recent_events(limit: int = 200, stage: str | None = None) -> list[dict[str, Any]]:
    items = list(_RING)
    if stage:
        items = [e for e in items if e.get("stage") == stage]
    return items[-limit:][::-1]


class Timer:
    """Context manager that records wall-clock duration of a pipeline stage."""

    def __init__(self) -> None:
        self.ms: float = 0.0
        self._t0: float = 0.0

    def __enter__(self) -> "Timer":
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.ms = (time.perf_counter() - self._t0) * 1000.0

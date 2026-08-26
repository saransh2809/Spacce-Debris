"""
KAKSHA -- application entry point.

Wires the layers together and nothing more.  There is no physics in this file,
no risk logic, and no data access beyond triggering the catalogue load.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, ORJSONResponse

from app.api.routes import analysis, catalog as catalog_routes, conjunctions, propagation
from app.core.config import settings
from app.llm.providers import resolve_provider
from app.core.logging import (
    STAGE_API,
    STAGE_DATA,
    Timer,
    configure_logging,
    get_logger,
    log_event,
)
from app.core.timebase import iso, now_utc
from app.data.catalog import get_catalog
from app.services.screening_service import get_screening_service

configure_logging(settings.debug)
log = get_logger("main")


async def _load_catalog_background() -> None:
    """
    Load the orbital catalogue at startup without blocking the server.

    The API answers 503 with a clear reason until it is ready, which is honest:
    no positions can be computed before the element sets exist.
    """
    try:
        stats = await get_catalog().load()
        get_screening_service().invalidate()
        log_event(log, STAGE_DATA, "startup_catalog_ready", objects=stats.total)
    except Exception as exc:  # noqa: BLE001
        log_event(
            log,
            STAGE_DATA,
            "startup_catalog_failed",
            level=logging.ERROR,
            error=str(exc),
        )


async def _periodic_refresh() -> None:
    """Refresh the feed on a fixed cadence; invalidate derived results."""
    interval = settings.catalog_refresh_minutes * 60
    while True:
        await asyncio.sleep(interval)
        try:
            stats = await get_catalog().load(force_refresh=True)
            get_screening_service().invalidate()
            log_event(log, STAGE_DATA, "periodic_refresh", objects=stats.total)
        except Exception as exc:  # noqa: BLE001
            log_event(
                log,
                STAGE_DATA,
                "periodic_refresh_failed",
                level=logging.ERROR,
                error=str(exc),
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    loader = asyncio.create_task(_load_catalog_background())
    refresher = asyncio.create_task(_periodic_refresh())
    try:
        yield
    finally:
        for task in (loader, refresher):
            task.cancel()
        await asyncio.gather(loader, refresher, return_exceptions=True)


app = FastAPI(
    title="KAKSHA",
    description=(
        "Space debris tracking, conjunction screening, encounter analysis, "
        "uncertainty assessment and risk visualisation.\n\n"
        "Architecture: physics calculates, validation verifies, the risk engine "
        "ranks, visualisation shows, and the LLM explains. The LLM has no "
        "numerical authority anywhere in this system."
    ),
    version=settings.version,
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Matches Vercel preview deployments, whose hostnames are generated per
    # build and cannot be listed in advance.
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    with Timer() as timer:
        response = await call_next(request)
    log_event(
        log,
        STAGE_API,
        "request",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        elapsed_ms=round(timer.ms, 1),
    )
    response.headers["X-KAKSHA-Compute-ms"] = f"{timer.ms:.1f}"
    return response


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    """
    Never return an opaque 500.

    A numerical pipeline that fails silently is worse than one that fails
    loudly, so the error surfaces with its type and the route that produced it.
    """
    log_event(
        log,
        STAGE_API,
        "unhandled_exception",
        level=logging.ERROR,
        path=request.url.path,
        error=str(exc),
        error_type=type(exc).__name__,
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": "INTERNAL_ERROR",
            "error_type": type(exc).__name__,
            "message": str(exc),
            "path": request.url.path,
            "note": "The numerical pipeline reports failures rather than substituting values.",
        },
    )


app.include_router(catalog_routes.router)
app.include_router(conjunctions.router)
app.include_router(propagation.router)
app.include_router(analysis.router)


def _llm_status() -> dict:
    """
    Whether the explanation layer is actually usable.

    Deliberately reports the RESOLVED provider rather than the presence of a
    key. A Google key sitting in the Anthropic variable is not a working LLM,
    and saying `llm_configured: true` for it hides the fault until someone
    clicks Explain in front of an audience.
    """
    _, status = resolve_provider()
    return status.as_dict()


@app.get("/api/health", tags=["system"])
async def health() -> dict:
    catalog = get_catalog()
    return {
        "status": "OK" if catalog.loaded else "LOADING",
        "app": settings.app_name,
        "version": settings.version,
        "server_time": iso(now_utc()),
        "catalog_loaded": catalog.loaded,
        "catalog_loading": catalog.loading,
        "objects": len(catalog),
        "data_age_seconds": catalog.data_age_seconds(),
        # Resolved, not merely "a key exists": a key for the wrong vendor is
        # not a configured LLM, and reporting it as one hides the failure until
        # someone clicks Explain.
        "llm": _llm_status(),
    }


@app.get("/api", tags=["system"])
async def api_index() -> dict:
    return {
        "name": settings.app_name,
        "subtitle": settings.app_subtitle,
        "version": settings.version,
        "principle": (
            "PHYSICS CALCULATES -> VALIDATION VERIFIES -> RISK ENGINE RANKS -> "
            "VISUALISATION SHOWS -> LLM EXPLAINS"
        ),
        "endpoints": {
            "catalog": [
                "/api/catalog/summary",
                "/api/catalog/search?q=",
                "/api/catalog/objects",
                "/api/catalog/object/{norad_id}",
                "/api/catalog/scene",
                "POST /api/catalog/refresh",
            ],
            "propagation": [
                "/api/propagate/{norad_id}",
                "/api/orbit/{norad_id}",
                "/api/groundtrack/{norad_id}",
                "/api/environment",
            ],
            "simulation": [
                "/api/clock",
                "POST /api/clock/realtime",
                "POST /api/clock/jump",
                "POST /api/clock/rate",
                "POST /api/clock/pause",
                "POST /api/clock/play",
            ],
            "conjunctions": [
                "/api/conjunctions",
                "/api/conjunctions/summary",
                "/api/conjunctions/methodology",
                "/api/conjunctions/{event_id}",
                "/api/conjunctions/{event_id}/bplane",
                "/api/conjunctions/{event_id}/profile",
            ],
            "analysis": ["/api/analysis", "/api/validation", "/api/debug"],
            "explanation": ["POST /api/explain/{event_id}"],
        },
    }

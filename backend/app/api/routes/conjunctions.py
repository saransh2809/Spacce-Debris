"""
KAKSHA API -- conjunction screening, event detail, B-plane and encounter charts.

Every route here reads from the screening service, which owns the cache.  No
route recomputes physics inline, and no route reorders or re-labels a result:
rank and category arrive already decided by the risk engine.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from app.core.config import settings
from app.core.logging import STAGE_API, get_logger, log_event
from app.core.timebase import iso
from app.conjunction.bplane import relative_trajectory_in_plane
from app.conjunction.tca import separation_profile
from app.data.catalog import get_catalog
from app.propagation.simulation_clock import ClockError, get_clock
from app.risk.engine import weights_description
from app.schemas.serializers import (
    num,
    serialize_bplane,
    serialize_event,
    serialize_run,
    serialize_uncertainty,
    serialize_validation,
)
from app.services.screening_service import get_screening_service
from app.uncertainty.models import model_description

router = APIRouter(prefix="/api/conjunctions", tags=["conjunctions"])
log = get_logger("api.conjunctions")


def _require_catalog():
    catalog = get_catalog()
    if not catalog.loaded:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "CATALOG_NOT_LOADED",
                "message": "The orbital catalogue is still loading.",
                "loading": catalog.loading,
            },
        )
    return catalog


def _resolve_time(at: datetime | None) -> datetime:
    try:
        return get_clock().resolve(at)
    except ClockError as exc:
        raise HTTPException(
            status_code=400, detail={"error": "TIME_OUT_OF_RANGE", "message": str(exc)}
        ) from exc


async def _run_for(
    at: datetime | None,
    countries: list[str] | None,
    norad_ids: list[int] | None,
    hours: float,
    threshold_km: float,
):
    """Resolve a screening request into a (run, from_cache, now) triple."""
    catalog = _require_catalog()
    now = _resolve_time(at)
    service = get_screening_service()

    if norad_ids:
        primaries = [o for o in (catalog.get(n) for n in norad_ids) if o is not None]
        if not primaries:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "NO_PRIMARY_OBJECTS",
                    "message": f"None of {norad_ids} are in the catalogue.",
                },
            )
        label = f"ids:{len(primaries)}"
    elif countries:
        primaries = catalog.filter(countries=countries)
        if not primaries:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "NO_PRIMARY_OBJECTS",
                    "message": (
                        f"No catalogued objects are attributed to {countries}. "
                        "Attribution comes from SATCAT and is never inferred."
                    ),
                },
            )
        label = f"countries:{','.join(countries)}"
    else:
        run, cached = await service.default_run(now)
        return run, cached, now

    secondaries = catalog.filter(limit=settings.max_screen_objects)
    run, cached = await service.get_or_run(
        primaries, secondaries, now, hours, threshold_km, label=label
    )
    return run, cached, now


@router.get("")
async def list_conjunctions(
    at: datetime | None = None,
    countries: Annotated[list[str] | None, Query()] = None,
    norad_ids: Annotated[list[int] | None, Query()] = None,
    hours: Annotated[float, Query(ge=0.5, le=168.0)] = settings.default_screen_hours,
    threshold_km: Annotated[float, Query(ge=0.1, le=200.0)] = (
        settings.screening_threshold_km
    ),
    categories: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> dict:
    """
    Ranked conjunction list -- the left rail.

    Ordering is by risk score descending, decided once by the risk engine.
    `categories` filters the returned rows but never re-ranks them, so a row's
    `rank` field always refers to its position in the full ranking.
    """
    run, cached, now = await _run_for(at, countries, norad_ids, hours, threshold_km)

    events = run.events
    if categories:
        wanted = {c.upper() for c in categories}
        events = [e for e in events if str(e.risk.category) in wanted]

    payload = serialize_run(run, now, cached)
    payload["events"] = [serialize_event(e, now) for e in events[:limit]]
    payload["returned"] = len(payload["events"])
    payload["filtered_by_category"] = categories or None
    return payload


@router.get("/summary")
async def summary(
    at: datetime | None = None,
    countries: Annotated[list[str] | None, Query()] = None,
    hours: Annotated[float, Query(ge=0.5, le=168.0)] = settings.default_screen_hours,
) -> dict:
    """
    Risk counters for the bottom stat strip.

    Computed from the validated result set, never hardcoded.
    """
    run, cached, now = await _run_for(
        at, countries, None, hours, settings.screening_threshold_km
    )
    closest = min(
        (e for e in run.events), key=lambda e: e.miss_distance_km, default=None
    )
    soonest = min(
        (e for e in run.events if e.hours_to_tca(now) >= 0),
        key=lambda e: e.hours_to_tca(now),
        default=None,
    )
    return {
        "counts": run.counts,
        "total_conjunctions": len(run.events),
        "rejected_by_validation": len(run.rejected_events),
        "window_hours": num((run.end - run.start).total_seconds() / 3600.0),
        "screening_threshold_km": num(run.threshold_km),
        "computed_at": iso(run.computed_at),
        "from_cache": cached,
        "closest": serialize_event(closest, now) if closest else None,
        "soonest": serialize_event(soonest, now) if soonest else None,
    }


@router.get("/methodology")
async def methodology() -> dict:
    """
    How the numbers are produced.  Backs the CALCULATIONS page and is embedded
    in the LLM prompt so the explanation layer describes the real method.
    """
    return {
        "pipeline": [
            "Public orbital element sets (CelesTrak GP + SATCAT)",
            "TLE/OMM parsing with checksum and physical-range validation",
            "SGP4/SDP4 propagation (Vallado reference implementation), TEME frame",
            "Broad phase: apogee/perigee overlap filter",
            "Coarse phase: k-d tree spatial query on a time grid",
            "Fine phase: TCA by Brent root-finding on r_rel . v_rel = 0",
            "Encounter geometry: Foster B-plane normal to relative velocity",
            "Uncertainty: covariance projected into the encounter plane",
            "Validation: independent re-derivation and tolerance checks",
            "Risk: weighted, explainable screening-priority score",
        ],
        "frames": {
            "propagation_output": "TEME (True Equator, Mean Equinox of date)",
            "conjunction_analysis": "TEME -- relative geometry, no frame change needed",
            "display_ground_track": "ITRF then WGS-84 geodetic",
            "uncertainty": "RIC (radial / in-track / cross-track)",
        },
        "tca_method": {
            "function": "g(t) = r_rel(t) . v_rel(t) = 0.5 d|r_rel|^2/dt",
            "solver": "Brent root-finding, tolerance 1e-6 s",
            "why": (
                "TCA is a root of the range-rate, not a minimum of a sampled "
                "distance array. Root-finding keeps full precision where "
                "minimising a flat quadratic would lose half of it."
            ),
        },
        "screening": {
            "threshold_km": settings.screening_threshold_km,
            "coarse_step_s": settings.coarse_step_s,
            "gate_rule": (
                "gate >= threshold + v_max * step / 2, with v_max = 16 km/s. "
                "The screener refuses to run with a gate below this."
            ),
        },
        "risk": weights_description(),
        "uncertainty": model_description(),
        "terminology": {
            "conjunction": "A predicted close approach. NOT a predicted collision.",
            "tca": "Time of closest approach.",
            "miss_distance": "Minimum predicted separation between object centres.",
            "risk_score": (
                "A screening-priority score in 0-100. It is not a probability."
            ),
        },
    }


@router.get("/{event_id}")
async def get_event(
    event_id: str,
    at: datetime | None = None,
    countries: Annotated[list[str] | None, Query()] = None,
    hours: Annotated[float, Query(ge=0.5, le=168.0)] = settings.default_screen_hours,
) -> dict:
    """Full detail for one conjunction -- the right-hand analysis panel."""
    run, _cached, now = await _run_for(
        at, countries, None, hours, settings.screening_threshold_km
    )
    event = run.by_id(event_id)
    if event is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "EVENT_NOT_FOUND",
                "message": (
                    f"Conjunction {event_id} is not in the current screening run. "
                    "Event IDs include the element-set epochs, so they change when "
                    "the orbital data is refreshed."
                ),
            },
        )
    return serialize_event(event, now, detail=True)


@router.get("/{event_id}/bplane")
async def get_bplane(
    event_id: str,
    at: datetime | None = None,
    countries: Annotated[list[str] | None, Query()] = None,
    hours: Annotated[float, Query(ge=0.5, le=168.0)] = settings.default_screen_hours,
    half_window_s: Annotated[float, Query(ge=1.0, le=3600.0)] = 60.0,
    samples: Annotated[int, Query(ge=11, le=501)] = 121,
) -> dict:
    """
    B-plane payload including the TRUE relative trajectory through the plane.

    The trajectory is propagated with SGP4 and projected, not drawn as a
    straight line through the miss vector. Comparing it against the straight
    line is what lets the UI show whether the linear-encounter assumption holds.
    """
    run, _cached, now = await _run_for(
        at, countries, None, hours, settings.screening_threshold_km
    )
    event = run.by_id(event_id)
    if event is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "EVENT_NOT_FOUND", "message": f"Unknown event {event_id}."},
        )

    trajectory = relative_trajectory_in_plane(
        event.closest_approach, event.bplane, half_window_s, samples
    )
    return {
        "event_id": event.event_id,
        "tca": iso(event.tca),
        "object_a": {"norad_id": event.object_a.norad_id, "name": event.object_a.name},
        "object_b": {"norad_id": event.object_b.norad_id, "name": event.object_b.name},
        "bplane": serialize_bplane(event),
        "uncertainty": serialize_uncertainty(event),
        "relative_trajectory": trajectory,
        "trajectory_note": (
            "Relative position propagated with SGP4 across the window and "
            "projected onto the encounter-plane axes. Not a straight-line sketch."
        ),
        "validation": serialize_validation(event.validation),
    }


@router.get("/{event_id}/profile")
async def get_profile(
    event_id: str,
    at: datetime | None = None,
    countries: Annotated[list[str] | None, Query()] = None,
    hours: Annotated[float, Query(ge=0.5, le=168.0)] = settings.default_screen_hours,
    half_window_s: Annotated[float, Query(ge=10.0, le=7200.0)] = 600.0,
    samples: Annotated[int, Query(ge=21, le=1001)] = 241,
) -> dict:
    """
    Separation and range-rate through the encounter, for the analysis chart.

    Range rate crossing zero exactly at the reported TCA is the visual proof
    that the solver found a genuine stationary point.
    """
    catalog = _require_catalog()
    run, _cached, _now = await _run_for(
        at, countries, None, hours, settings.screening_threshold_km
    )
    event = run.by_id(event_id)
    if event is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "EVENT_NOT_FOUND", "message": f"Unknown event {event_id}."},
        )

    obj_a = catalog.get(event.object_a.norad_id)
    obj_b = catalog.get(event.object_b.norad_id)
    if obj_a is None or obj_b is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "OBJECT_NO_LONGER_IN_CATALOG",
                "message": "One of the objects left the catalogue after a refresh.",
            },
        )

    times, sep, rate = separation_profile(
        obj_a, obj_b, event.tca, half_window_s, samples
    )
    return {
        "event_id": event.event_id,
        "tca": iso(event.tca),
        "miss_distance_km": num(event.miss_distance_km),
        "t_offset_s": [
            num((t - event.tca).total_seconds()) for t in times
        ],
        "separation_km": [num(s) for s in sep],
        "range_rate_km_s": [num(r) for r in rate],
        "note": (
            "Range rate is d|r_rel|/dt. It crosses zero exactly at TCA; that "
            "crossing is the definition the solver targets."
        ),
    }

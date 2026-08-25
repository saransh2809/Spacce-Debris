"""
KAKSHA API -- analysis statistics, validation, debug and LLM explanation.

Backs the ANALYSIS, VALIDATION and CALCULATIONS pages.  Every distribution here
is computed from the live screening run; none of it is precomputed or seeded.
"""
from __future__ import annotations

import math
from collections import Counter
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from app.core.config import settings
from app.core.logging import recent_events
from app.core.timebase import iso, now_utc
from app.data.catalog import get_catalog
from app.llm.explainer import explain_conjunction
from app.propagation.simulation_clock import get_clock
from app.risk.engine import weights_description
from app.schemas.serializers import num, serialize_event, serialize_validation
from app.services.screening_service import get_screening_service
from app.uncertainty.models import model_description
from app.validation.engine import validate_catalog

router = APIRouter(prefix="/api", tags=["analysis", "validation"])


def _catalog():
    catalog = get_catalog()
    if not catalog.loaded:
        raise HTTPException(
            status_code=503,
            detail={"error": "CATALOG_NOT_LOADED", "message": "Catalogue loading."},
        )
    return catalog


def _histogram(values: list[float], bins: int, lo: float, hi: float) -> dict:
    """Simple fixed-range histogram; non-finite values are excluded and counted."""
    clean = [v for v in values if v is not None and math.isfinite(v)]
    excluded = len(values) - len(clean)
    if not clean or hi <= lo:
        return {"bin_edges": [], "counts": [], "excluded": excluded, "total": 0}

    width = (hi - lo) / bins
    counts = [0] * bins
    for v in clean:
        idx = int((v - lo) / width)
        idx = max(0, min(bins - 1, idx))
        counts[idx] += 1
    return {
        "bin_edges": [lo + i * width for i in range(bins + 1)],
        "counts": counts,
        "excluded": excluded,
        "total": len(clean),
    }


@router.get("/analysis")
async def analysis(
    at: datetime | None = None,
    countries: Annotated[list[str] | None, Query()] = None,
    hours: Annotated[float, Query(ge=0.5, le=168.0)] = settings.default_screen_hours,
) -> dict:
    """Statistical views over the current screening run -- the ANALYSIS page."""
    catalog = _catalog()
    clock = get_clock()
    now = clock.resolve(at)
    service = get_screening_service()

    if countries:
        primaries = catalog.filter(countries=countries)
        if not primaries:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "NO_PRIMARY_OBJECTS",
                    "message": f"No objects attributed to {countries}.",
                },
            )
        run, cached = await service.get_or_run(
            primaries,
            catalog.filter(limit=settings.max_screen_objects),
            now,
            hours,
            settings.screening_threshold_km,
            label=f"analysis:{','.join(countries)}",
        )
    else:
        run, cached = await service.default_run(now)

    events = run.events
    misses = [e.miss_distance_km for e in events]
    speeds = [e.relative_speed_km_s for e in events]
    hours_out = [e.hours_to_tca(now) for e in events]
    sigmas = [e.uncertainty.miss_over_sigma for e in events]
    angles = [e.bplane.encounter_angle_deg for e in events]

    partner_countries = Counter()
    partner_types = Counter()
    for e in events:
        partner_countries[e.object_b.country] += 1
        partner_types[str(e.object_b.object_type)] += 1

    # Temporal profile: conjunctions per hour across the window.
    window_h = max(1.0, (run.end - run.start).total_seconds() / 3600.0)
    buckets = int(min(48, max(6, window_h)))
    timeline = [0] * buckets
    for h in hours_out:
        if 0 <= h < window_h:
            timeline[min(buckets - 1, int(h / window_h * buckets))] += 1

    return {
        "computed_at": iso(run.computed_at),
        "from_cache": cached,
        "window_hours": num(window_h),
        "total_conjunctions": len(events),
        "risk_distribution": run.counts,
        "miss_distance_histogram": _histogram(
            misses, 25, 0.0, run.threshold_km
        ),
        "relative_velocity_histogram": _histogram(speeds, 16, 0.0, 16.0),
        "uncertainty_ratio_histogram": _histogram(sigmas, 20, 0.0, 10.0),
        "encounter_angle_histogram": _histogram(angles, 18, 0.0, 180.0),
        "conjunctions_per_hour": {
            "buckets": buckets,
            "hours_per_bucket": num(window_h / buckets),
            "counts": timeline,
        },
        "partner_country_distribution": dict(partner_countries.most_common(15)),
        "partner_type_distribution": dict(partner_types),
        "catalog_distribution": {
            "by_type": dict(catalog.stats.by_type),
            "by_regime": dict(catalog.stats.by_regime),
            "by_country": dict(
                sorted(catalog.stats.by_country.items(), key=lambda kv: -kv[1])[:15]
            ),
        },
        "extremes": {
            "closest": serialize_event(
                min(events, key=lambda e: e.miss_distance_km), now
            )
            if events
            else None,
            "fastest": serialize_event(
                max(events, key=lambda e: e.relative_speed_km_s), now
            )
            if events
            else None,
            "soonest": serialize_event(
                min(events, key=lambda e: e.hours_to_tca(now)), now
            )
            if events
            else None,
        },
        "top_events": [serialize_event(e, now) for e in events[:10]],
    }


@router.get("/validation")
async def validation(
    at: datetime | None = None,
    hours: Annotated[float, Query(ge=0.5, le=168.0)] = settings.default_screen_hours,
) -> dict:
    """
    Data quality, numerical checks and stated model limitations.

    This is the page that demonstrates the system knows what it does not know.
    """
    catalog = _catalog()
    clock = get_clock()
    now = clock.resolve(at)

    catalog_validation = validate_catalog(catalog)
    run, cached = await get_screening_service().default_run(now)

    # Aggregate check outcomes across every conjunction in the run.
    check_totals: dict[str, dict[str, int]] = {}
    for event in run.events + run.rejected_events:
        for check in event.validation.checks:
            slot = check_totals.setdefault(
                check.name, {"passed": 0, "failed": 0}
            )
            slot["passed" if check.passed else "failed"] += 1

    status_counts = Counter(str(e.validation.status) for e in run.events)
    for e in run.rejected_events:
        status_counts[str(e.validation.status)] += 1

    fetch = catalog.fetch_result
    return {
        "computed_at": iso(now),
        "from_cache": cached,
        "data_quality": {
            "provider": catalog.provider_name,
            "retrieved_at": iso(fetch.retrieved_at) if fetch else None,
            "data_age_seconds": num(catalog.data_age_seconds()),
            "served_from_cache": bool(fetch and fetch.from_cache),
            "degraded": bool(fetch and fetch.degraded),
            "notes": fetch.notes if fetch else [],
            "total_objects": catalog.stats.total,
            "median_element_age_days": num(catalog.median_element_age_days()),
            "stale_objects": catalog.stats.stale,
            "stale_threshold_days": settings.tle_max_age_days,
            "warn_threshold_days": settings.tle_warn_age_days,
            "rejected_records": catalog.stats.rejected_records,
            "rejection_reasons": catalog.stats.rejection_reasons,
            "attribution_missing": catalog.stats.attribution_missing,
        },
        "catalog_validation": serialize_validation(catalog_validation),
        "conjunction_validation": {
            "status_counts": dict(status_counts),
            "check_totals": check_totals,
            "rejected_events": [
                {
                    **serialize_event(e, now),
                    "failed_checks": [
                        c.name for c in e.validation.checks if not c.passed
                    ],
                }
                for e in run.rejected_events[:50]
            ],
        },
        "pipeline_diagnostics": {
            "objects_considered": run.report.objects_considered,
            "pairs_geometrically_possible": run.report.pairs_geometrically_possible,
            "pairs_after_coarse_sweep": run.report.pairs_after_coarse_sweep,
            "candidates_refined": run.refined_candidates,
            "refinement_failures": run.refinement_failures,
            "propagation_failures": run.report.propagation_failures,
            "coarse_gate_km": num(run.report.coarse_gate_km),
            "required_gate_km": num(run.report.required_gate_km),
            "gate_is_safe": run.report.gate_is_safe,
            "elapsed_ms": num(run.elapsed_ms),
        },
        "uncertainty_model": model_description(),
        "risk_model": weights_description(),
        "stated_limitations": [
            "Positions are PROPAGATED from publicly published orbital element "
            "sets. The system does not observe or measure any satellite. This is "
            "real-time calculation, not real-time tracking.",
            "Public GP/TLE data carries no covariance. Uncertainty comes from a "
            "documented assumed model, and probabilities derived from it are "
            "conditional on that model.",
            "SGP4 is a short-arc analytic theory. Accuracy degrades with time "
            "from epoch, typically by kilometres per day in LEO.",
            "Polar motion is neglected and UT1 is approximated by UTC. This "
            "affects the displayed ground track by under a kilometre and has no "
            "effect on conjunction geometry, which is computed entirely in TEME.",
            "Manoeuvres are not modelled. A satellite that manoeuvres invalidates "
            "any prediction made from its pre-manoeuvre elements.",
            "The risk score is a screening priority, not a probability of "
            "collision, and is not suitable for operational collision avoidance.",
        ],
    }


@router.get("/debug")
async def debug(
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    stage: str | None = None,
) -> dict:
    """Observability panel: live pipeline counters, cache state and event log."""
    catalog = get_catalog()
    clock = get_clock()
    service = get_screening_service()
    state = clock.state()

    return {
        "clock": {
            "mode": str(state.mode),
            "simulation_time": iso(state.simulation_time),
            "wall_time": iso(state.wall_time),
            "offset_seconds": num(state.offset_seconds),
            "rate": num(state.rate),
            "paused": state.paused,
        },
        "catalog": {
            "loaded": catalog.loaded,
            "loading": catalog.loading,
            "objects": len(catalog),
            "loaded_at": iso(catalog.loaded_at) if catalog.loaded_at else None,
            "data_age_seconds": num(catalog.data_age_seconds()),
            "median_element_age_days": num(catalog.median_element_age_days()),
            "generation": service.generation,
        },
        "screening_cache": service.cache_report(),
        "config": {
            "screening_threshold_km": settings.screening_threshold_km,
            "coarse_step_s": settings.coarse_step_s,
            "coarse_gate_km": settings.coarse_gate_km,
            "default_screen_hours": settings.default_screen_hours,
            "max_screen_objects": settings.max_screen_objects,
            "tle_max_age_days": settings.tle_max_age_days,
            "llm_enabled": settings.llm_enabled,
            "llm_key_configured": bool(settings.anthropic_api_key),
            "llm_model": settings.llm_model,
        },
        "recent_events": recent_events(limit=limit, stage=stage),
        "server_time": iso(now_utc()),
    }


@router.post("/explain/{event_id}")
async def explain(
    event_id: str,
    at: datetime | None = None,
    countries: Annotated[list[str] | None, Query()] = None,
    hours: Annotated[float, Query(ge=0.5, le=168.0)] = settings.default_screen_hours,
) -> dict:
    """
    LLM explanation of one validated conjunction.

    The endpoint fetches the FINISHED result and passes only that to the model.
    The model has no access to the catalogue, the propagator or the risk engine,
    and every numeral it emits is audited against the values it was given.
    """
    catalog = _catalog()
    clock = get_clock()
    now = clock.resolve(at)
    service = get_screening_service()

    if countries:
        primaries = catalog.filter(countries=countries)
        run, _ = await service.get_or_run(
            primaries,
            catalog.filter(limit=settings.max_screen_objects),
            now,
            hours,
            settings.screening_threshold_km,
            label=f"explain:{','.join(countries)}",
        )
    else:
        run, _ = await service.default_run(now)

    event = run.by_id(event_id)
    if event is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "EVENT_NOT_FOUND",
                "message": f"Conjunction {event_id} is not in the current run.",
            },
        )

    if not event.validation.is_displayable:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "EVENT_NOT_VALIDATED",
                "message": (
                    "This conjunction failed validation and will not be explained. "
                    "Explaining an invalid numerical result would lend it "
                    "credibility it has not earned."
                ),
                "validation": serialize_validation(event.validation),
            },
        )

    detail = serialize_event(event, now, detail=True)
    explanation = await explain_conjunction(detail)
    return {
        "event_id": event_id,
        "rank": event.rank,
        "risk_category": str(event.risk.category),
        **explanation.as_dict(),
    }

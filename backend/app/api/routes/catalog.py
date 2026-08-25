"""
KAKSHA API -- catalogue, search and scene state.

The `/scene` endpoint deserves a note.  The 3D view needs the position of
thousands of objects every time the simulation clock moves.  Sending each one
as a JSON object with named fields would be tens of megabytes of punctuation.
Instead it returns parallel flat arrays that map straight onto typed arrays in
the browser, which is both an order of magnitude smaller and directly usable as
a Three.js buffer attribute without a reshaping pass.

Positions are TEME and the payload says so.  The renderer counter-rotates the
Earth mesh by GMST rather than rotating every satellite, so one rotation
replaces thousands -- same physics, far less work.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from app.core.config import settings
from app.core.logging import STAGE_API, get_logger, log_event
from app.core.timebase import gmst_rad_at, iso, sun_direction_teme
from app.data.catalog import get_catalog
from app.data.metadata import ObjectType, OrbitalRegime
from app.propagation.simulation_clock import ClockError, get_clock
from app.propagation.sgp4_engine import propagate, propagate_many
from app.schemas.serializers import num, serialize_object, serialize_state

router = APIRouter(prefix="/api/catalog", tags=["catalog"])
log = get_logger("api.catalog")


def _require_catalog():
    catalog = get_catalog()
    if not catalog.loaded:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "CATALOG_NOT_LOADED",
                "message": (
                    "The orbital catalogue has not finished loading. "
                    "No positions can be computed until it has."
                ),
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


@router.get("/summary")
async def summary() -> dict:
    """Catalogue-wide counters -- the left rail and the bottom stat strip."""
    catalog = _require_catalog()
    stats = catalog.stats
    fetch = catalog.fetch_result

    return {
        "total_objects": stats.total,
        "by_type": dict(stats.by_type),
        "by_regime": dict(stats.by_regime),
        "by_country": dict(
            sorted(stats.by_country.items(), key=lambda kv: -kv[1])
        ),
        "country_tree": catalog.country_tree(),
        "stale_objects": stats.stale,
        "attribution_missing": stats.attribution_missing,
        "rejected_records": stats.rejected_records,
        "rejection_reasons": stats.rejection_reasons,
        "data": {
            "provider": catalog.provider_name,
            "retrieved_at": iso(fetch.retrieved_at) if fetch else None,
            "data_age_seconds": num(catalog.data_age_seconds()),
            "median_element_age_days": num(catalog.median_element_age_days()),
            "served_from_cache": bool(fetch and fetch.from_cache),
            "degraded": bool(fetch and fetch.degraded),
            "notes": fetch.notes if fetch else [],
            "group_counts": fetch.group_counts if fetch else {},
            "nature_of_data": (
                "Publicly published orbital ELEMENT SETS, propagated by SGP4. "
                "This is real-time CALCULATION, not real-time measurement -- the "
                "system does not observe satellites."
            ),
        },
        "object_types": [str(t) for t in ObjectType],
        "regimes": [str(r) for r in OrbitalRegime],
    }


@router.get("/search")
async def search(
    q: Annotated[str, Query(min_length=1, max_length=64)],
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
) -> dict:
    """Search by name, catalogue number, designator, country or operator."""
    catalog = _require_catalog()
    now = get_clock().now()
    results = catalog.search(q, limit=limit)
    return {
        "query": q,
        "count": len(results),
        "results": [serialize_object(o, now, brief=True) for o in results],
    }


@router.get("/objects")
async def list_objects(
    object_types: Annotated[list[str] | None, Query()] = None,
    countries: Annotated[list[str] | None, Query()] = None,
    operators: Annotated[list[str] | None, Query()] = None,
    regimes: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=5000)] = 500,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    """Filtered catalogue listing."""
    catalog = _require_catalog()
    now = get_clock().now()
    matched = catalog.filter(
        object_types=object_types,
        countries=countries,
        operators=operators,
        regimes=regimes,
    )
    page = matched[offset : offset + limit]
    return {
        "total_matched": len(matched),
        "offset": offset,
        "limit": limit,
        "objects": [serialize_object(o, now, brief=True) for o in page],
    }


@router.get("/object/{norad_id}")
async def get_object(
    norad_id: int, at: datetime | None = None
) -> dict:
    """
    Full detail for one object, including its state at the requested instant.

    This is the payload behind the SELECTED OBJECT panel.
    """
    catalog = _require_catalog()
    obj = catalog.get(norad_id)
    if obj is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "OBJECT_NOT_FOUND",
                "message": f"No catalogued object with NORAD ID {norad_id}.",
            },
        )

    when = _resolve_time(at)
    payload = {"object": serialize_object(obj, when), "time": iso(when)}

    try:
        state = propagate(obj.element_set, when, obj.satrec)
        payload["state"] = serialize_state(state)
        payload["propagation_status"] = "OK"
    except Exception as exc:  # noqa: BLE001 -- reported, never swallowed
        payload["state"] = None
        payload["propagation_status"] = "FAILED"
        payload["propagation_error"] = str(exc)
        log_event(
            log,
            STAGE_API,
            "object_propagation_failed",
            norad_id=norad_id,
            error=str(exc),
        )

    return payload


@router.get("/scene")
async def scene(
    at: datetime | None = None,
    object_types: Annotated[list[str] | None, Query()] = None,
    countries: Annotated[list[str] | None, Query()] = None,
    regimes: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=20000)] = 12000,
) -> dict:
    """
    Bulk positions for the 3D view, as flat arrays.

    `positions_km` is [x0,y0,z0, x1,y1,z1, ...] in TEME, aligned index-for-index
    with `norad_ids`, `type_codes` and `country_codes`.  Objects whose
    propagation failed are omitted entirely and counted in `failed` -- they are
    never emitted at the origin, which would draw a false cluster at the centre
    of the Earth.
    """
    catalog = _require_catalog()
    when = _resolve_time(at)

    # Filter without a cap, then reduce by stratified sampling. Capping inside
    # the filter would truncate in catalogue-number order and badly skew the
    # class mix -- see Catalog.stratified_sample.
    matched = catalog.filter(
        object_types=object_types,
        countries=countries,
        regimes=regimes,
    )
    objects = catalog.stratified_sample(matched, limit)
    if not objects:
        return {
            "time": iso(when),
            "frame": "TEME",
            "count": 0,
            "failed": 0,
            "norad_ids": [],
            "positions_km": [],
            "type_codes": [],
            "gmst_rad": num(gmst_rad_at(when)),
            "sun_direction_teme": [num(x) for x in sun_direction_teme(when)],
        }

    positions, _velocities, errors = propagate_many(
        [o.element_set for o in objects], [when], [o.satrec for o in objects]
    )

    type_order = [
        ObjectType.ACTIVE_SATELLITE,
        ObjectType.INACTIVE_SATELLITE,
        ObjectType.DEBRIS,
        ObjectType.ROCKET_BODY,
        ObjectType.SPACE_STATION,
        ObjectType.UNKNOWN,
    ]
    type_code = {t: i for i, t in enumerate(type_order)}

    ids: list[int] = []
    flat: list[float] = []
    types: list[int] = []
    countries_out: list[str] = []
    failed = 0

    for i, obj in enumerate(objects):
        if errors[i, 0] != 0:
            failed += 1
            continue
        p = positions[i, 0]
        if not (p[0] == p[0]):  # NaN guard
            failed += 1
            continue
        ids.append(obj.norad_id)
        flat.extend((float(p[0]), float(p[1]), float(p[2])))
        types.append(type_code.get(obj.object_type, 5))
        countries_out.append(obj.meta.country_iso or "")

    return {
        "time": iso(when),
        "frame": "TEME",
        "frame_note": (
            "Inertial TEME. The renderer rotates the Earth mesh by GMST rather "
            "than rotating these positions."
        ),
        "count": len(ids),
        # How many objects matched the filters before the display cap. When
        # this exceeds `count` the view is a stratified sample, and the UI says
        # so -- a display that silently shows a third of the catalogue while
        # implying it shows all of it would be misleading.
        "matched": len(matched),
        "sampled": len(objects) < len(matched),
        "failed": failed,
        "requested": len(objects),
        "norad_ids": ids,
        "positions_km": flat,
        "type_codes": types,
        "country_iso": countries_out,
        "type_order": [str(t) for t in type_order],
        "gmst_rad": num(gmst_rad_at(when)),
        "sun_direction_teme": [num(x) for x in sun_direction_teme(when)],
        "earth_radius_km": 6378.137,
    }


@router.post("/refresh")
async def refresh(force: bool = True) -> dict:
    """
    Re-fetch the orbital data feed and rebuild the catalogue.

    Invalidates every cached screening run, because those results were derived
    from the previous element sets and must not be served against new ones.
    """
    from app.services.screening_service import get_screening_service

    catalog = get_catalog()
    stats = await catalog.load(force_refresh=force)
    get_screening_service().invalidate()

    log_event(log, STAGE_API, "catalog_refreshed", objects=stats.total)
    return {
        "status": "OK",
        "total_objects": stats.total,
        "rejected_records": stats.rejected_records,
        "retrieved_at": iso(catalog.fetch_result.retrieved_at)
        if catalog.fetch_result
        else None,
        "screening_cache": "invalidated",
    }

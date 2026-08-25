"""
KAKSHA API -- propagation, orbit tracks and the simulation clock.

Orbit paths are propagated server-side and sent as flat vertex arrays.  The
browser draws them; it does not compute them.  That boundary is deliberate --
it is the difference between a visualisation of a calculation and a
calculation performed by a visualisation.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.logging import STAGE_API, get_logger, log_event
from app.core.timebase import gmst_rad_at, iso, sun_direction_teme
from app.core.frames import itrf_to_geodetic, teme_to_itrf
from app.data.catalog import get_catalog
from app.propagation.sgp4_engine import propagate, propagate_many
from app.propagation.simulation_clock import (
    ALLOWED_RATES,
    ClockError,
    ClockMode,
    get_clock,
)
from app.schemas.serializers import num, serialize_state

router = APIRouter(prefix="/api", tags=["propagation", "simulation"])
log = get_logger("api.propagation")


def _catalog():
    catalog = get_catalog()
    if not catalog.loaded:
        raise HTTPException(
            status_code=503,
            detail={"error": "CATALOG_NOT_LOADED", "message": "Catalogue loading."},
        )
    return catalog


def _resolve(at: datetime | None) -> datetime:
    try:
        return get_clock().resolve(at)
    except ClockError as exc:
        raise HTTPException(
            status_code=400, detail={"error": "TIME_OUT_OF_RANGE", "message": str(exc)}
        ) from exc


# --------------------------------------------------------------- propagation
@router.get("/propagate/{norad_id}")
async def propagate_one(norad_id: int, at: datetime | None = None) -> dict:
    """Single-object state at one instant, with full frame documentation."""
    catalog = _catalog()
    obj = catalog.get(norad_id)
    if obj is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "OBJECT_NOT_FOUND", "message": f"NORAD {norad_id}."},
        )
    when = _resolve(at)
    try:
        state = propagate(obj.element_set, when, obj.satrec)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=422,
            detail={
                "error": "PROPAGATION_FAILED",
                "message": str(exc),
                "norad_id": norad_id,
                "time": iso(when),
            },
        ) from exc
    return {
        "norad_id": norad_id,
        "name": obj.name,
        "time": iso(when),
        "state": serialize_state(state),
    }


@router.get("/orbit/{norad_id}")
async def orbit_track(
    norad_id: int,
    at: datetime | None = None,
    revolutions: Annotated[float, Query(ge=0.1, le=8.0)] = 1.0,
    samples: Annotated[int, Query(ge=32, le=2048)] = 256,
    centred: bool = True,
) -> dict:
    """
    Orbit path as a flat TEME vertex array, ready for a Three.js line buffer.

    The path spans `revolutions` orbital periods, centred on the requested
    instant by default so the object sits mid-track rather than at one end.
    """
    catalog = _catalog()
    obj = catalog.get(norad_id)
    if obj is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "OBJECT_NOT_FOUND", "message": f"NORAD {norad_id}."},
        )

    when = _resolve(at)
    period_s = obj.element_set.period_min * 60.0
    span_s = period_s * revolutions
    start = when - timedelta(seconds=span_s / 2.0) if centred else when

    times = [start + timedelta(seconds=span_s * i / (samples - 1)) for i in range(samples)]
    positions, _vel, errors = propagate_many(
        [obj.element_set], times, [obj.satrec]
    )

    flat: list[float] = []
    kept = 0
    for i in range(samples):
        if errors[0, i] != 0:
            continue
        p = positions[0, i]
        if p[0] != p[0]:
            continue
        flat.extend((float(p[0]), float(p[1]), float(p[2])))
        kept += 1

    return {
        "norad_id": norad_id,
        "name": obj.name,
        "frame": "TEME",
        "time": iso(when),
        "period_min": num(obj.element_set.period_min),
        "revolutions": revolutions,
        "requested_samples": samples,
        "vertex_count": kept,
        "failed_samples": samples - kept,
        "positions_km": flat,
        "start": iso(times[0]),
        "end": iso(times[-1]),
    }


@router.get("/groundtrack/{norad_id}")
async def ground_track(
    norad_id: int,
    at: datetime | None = None,
    revolutions: Annotated[float, Query(ge=0.1, le=6.0)] = 1.0,
    samples: Annotated[int, Query(ge=32, le=1024)] = 240,
) -> dict:
    """
    Sub-satellite track in WGS-84 geodetic coordinates.

    This is the ONE place TEME becomes Earth-fixed for display. The
    approximations involved (polar motion neglected, UT1 approximated by UTC)
    are named in the response rather than hidden.
    """
    catalog = _catalog()
    obj = catalog.get(norad_id)
    if obj is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "OBJECT_NOT_FOUND", "message": f"NORAD {norad_id}."},
        )

    when = _resolve(at)
    period_s = obj.element_set.period_min * 60.0
    span_s = period_s * revolutions
    start = when - timedelta(seconds=span_s / 2.0)
    times = [start + timedelta(seconds=span_s * i / (samples - 1)) for i in range(samples)]

    positions, velocities, errors = propagate_many(
        [obj.element_set], times, [obj.satrec]
    )

    lats: list[float | None] = []
    lons: list[float | None] = []
    alts: list[float | None] = []
    for i, t in enumerate(times):
        if errors[0, i] != 0 or positions[0, i][0] != positions[0, i][0]:
            continue
        r_itrf, _ = teme_to_itrf(positions[0, i], velocities[0, i], t)
        lat, lon, alt = itrf_to_geodetic(r_itrf)
        lats.append(num(lat))
        lons.append(num(lon))
        alts.append(num(alt))

    return {
        "norad_id": norad_id,
        "name": obj.name,
        "frame": "WGS-84 geodetic via ITRF",
        "approximations": [
            "Polar motion neglected (< 15 m on the sub-satellite point).",
            "UT1 approximated by UTC (< 0.5 km of longitude).",
        ],
        "latitude_deg": lats,
        "longitude_deg": lons,
        "altitude_km": alts,
        "sample_count": len(lats),
    }


# ---------------------------------------------------------- simulation clock
class TimeJump(BaseModel):
    time: datetime | None = Field(None, description="Absolute UTC instant to jump to.")
    offset_seconds: float | None = Field(
        None, description="Relative shift from the current simulation time."
    )


class RateChange(BaseModel):
    rate: float = Field(..., description="Time acceleration factor. 0 pauses.")


def _clock_payload(state) -> dict:
    return {
        "mode": str(state.mode),
        "simulation_time": iso(state.simulation_time),
        "wall_time": iso(state.wall_time),
        "offset_seconds": num(state.offset_seconds),
        "rate": num(state.rate),
        "paused": state.paused,
        "gmst_rad": num(state.gmst_rad),
        "sun_direction_teme": [num(x) for x in state.sun_direction_teme],
        "allowed_rates": list(ALLOWED_RATES),
        "note": (
            "Simulation time drives Earth rotation, Sun direction, SGP4 "
            "propagation and every panel together."
        ),
    }


@router.get("/clock")
async def get_clock_state() -> dict:
    return _clock_payload(get_clock().state())


@router.post("/clock/realtime")
async def clock_realtime() -> dict:
    """Snap the simulation back to wall-clock UTC."""
    return _clock_payload(get_clock().set_real_time())


@router.post("/clock/jump")
async def clock_jump(body: TimeJump) -> dict:
    """Jump to an absolute time or shift by a relative offset."""
    clock = get_clock()
    try:
        if body.time is not None:
            state = clock.set_simulation_time(body.time)
        elif body.offset_seconds is not None:
            state = clock.offset(body.offset_seconds)
        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "NO_TARGET",
                    "message": "Provide either `time` or `offset_seconds`.",
                },
            )
    except ClockError as exc:
        raise HTTPException(
            status_code=400, detail={"error": "TIME_OUT_OF_RANGE", "message": str(exc)}
        ) from exc
    return _clock_payload(state)


@router.post("/clock/rate")
async def clock_rate(body: RateChange) -> dict:
    try:
        return _clock_payload(get_clock().set_rate(body.rate))
    except ClockError as exc:
        raise HTTPException(
            status_code=400, detail={"error": "RATE_OUT_OF_RANGE", "message": str(exc)}
        ) from exc


@router.post("/clock/pause")
async def clock_pause() -> dict:
    return _clock_payload(get_clock().pause())


@router.post("/clock/play")
async def clock_play() -> dict:
    return _clock_payload(get_clock().play())


@router.get("/environment")
async def environment(at: datetime | None = None) -> dict:
    """
    Earth-orientation and lighting state for the renderer.

    GMST drives the Earth mesh rotation; the solar direction drives the
    day/night terminator. Both come from the same clock as the propagation, so
    the lighting can never disagree with the satellite positions.
    """
    when = _resolve(at)
    sun = sun_direction_teme(when)
    return {
        "time": iso(when),
        "gmst_rad": num(gmst_rad_at(when)),
        "gmst_deg": num(gmst_rad_at(when) * 180.0 / 3.141592653589793),
        "sun_direction_teme": [num(x) for x in sun],
        "sun_model": (
            "Low-precision analytic solar ephemeris (Vallado Alg. 29), ~0.01 deg."
        ),
        "earth_radius_km": 6378.137,
        "earth_flattening": 1.0 / 298.257223563,
    }

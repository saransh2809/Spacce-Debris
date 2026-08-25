"""
KAKSHA -- SGP4 propagation engine.

This module is the ONLY place in the system where an orbital position is
produced.  Nothing else -- not the API layer, not the frontend, not the LLM --
is permitted to compute where an object is.

Implementation: the `sgp4` package (Brandon Rhodes), which is a direct port of
the Vallado/Kelso reference implementation of SGP4/SDP4 with a C accelerator.
That is the same code the published TLE format is *defined* against, so using
anything else would be strictly worse.

OUTPUT FRAME
------------
SGP4 natively returns TEME (True Equator, Mean Equinox of date), position in
km and velocity in km/s.  Every state that leaves this module is tagged
``Frame.TEME``.  Conversions live in app/core/frames.py and nowhere else.

DEEP SPACE
----------
Element sets with a period above 225 minutes are automatically handled by the
SDP4 deep-space extension inside the same call.  We do not special-case them,
but we do record which model was used so the validation page can report it.

PERFORMANCE
-----------
Screening thousands of objects across thousands of timesteps is the dominant
cost in the whole system.  :func:`propagate_many` uses ``SatrecArray``, which
evaluates the full (n_objects x n_times) grid inside the C extension and
returns numpy arrays.  This is roughly two orders of magnitude faster than
looping in Python and is what makes a 48-hour screen of the live catalogue
feasible on a laptop.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Sequence

import numpy as np
from sgp4.api import SGP4_ERRORS, Satrec, SatrecArray

from app.core.frames import Frame
from app.core.logging import STAGE_PROPAGATION, get_logger, log_event
from app.core.timebase import datetime_to_jd, ensure_utc
from app.data.tle_processor import ElementSet

log = get_logger("propagation.sgp4")

# Period above which SGP4 switches to the SDP4 deep-space model (Vallado).
DEEP_SPACE_PERIOD_MIN = 225.0

# Physical sanity limits used to reject a propagation that "succeeded"
# numerically but produced an impossible state.
MIN_RADIUS_KM = 6371.0 - 100.0     # below this the object is inside the Earth
MAX_RADIUS_KM = 500_000.0          # beyond the Moon; not an Earth satellite
MAX_SPEED_KM_S = 20.0              # escape speed at LEO is ~11.2 km/s


class PropagationError(RuntimeError):
    """Raised when SGP4 cannot produce a usable state."""

    def __init__(self, norad_id: int, code: int, message: str) -> None:
        super().__init__(f"NORAD {norad_id}: {message} (sgp4 code {code})")
        self.norad_id = norad_id
        self.code = code
        self.message = message


@dataclass(slots=True)
class StateVector:
    """
    A propagated orbital state.

    The frame and the epoch are carried WITH the numbers, so no consumer can
    accidentally treat a TEME vector as Earth-fixed, and so every downstream
    result can be traced back to the element set that produced it.
    """

    norad_id: int
    time: datetime                  # UTC, the instant this state is valid for
    position_km: np.ndarray         # (3,) in `frame`
    velocity_km_s: np.ndarray       # (3,) in `frame`
    frame: Frame = Frame.TEME
    epoch: datetime | None = None   # element-set epoch this came from
    model: str = "SGP4"             # "SGP4" or "SDP4" (deep space)
    error_code: int = 0

    @property
    def radius_km(self) -> float:
        return float(np.linalg.norm(self.position_km))

    @property
    def speed_km_s(self) -> float:
        return float(np.linalg.norm(self.velocity_km_s))

    @property
    def age_from_epoch_days(self) -> float:
        """Propagation distance from the element epoch, in days."""
        if self.epoch is None:
            return float("nan")
        return (ensure_utc(self.time) - self.epoch).total_seconds() / 86400.0


def build_satrec(es: ElementSet) -> Satrec:
    """
    Construct an SGP4 `Satrec` from a validated element set.

    Uses the canonical two-line initialiser (WGS-72, which is the gravity model
    SGP4 is defined against -- initialising with WGS-84 is a common and subtle
    error that shifts positions by a few hundred metres).
    """
    if es.line1 and es.line2:
        sat = Satrec.twoline2rv(es.line1, es.line2)
    else:
        # OMM-sourced element set with no fixed-width lines: initialise from
        # the mean elements directly.
        from sgp4.api import WGS72
        from sgp4.conveniences import jday_datetime

        jd, fr = jday_datetime(es.epoch)
        sat = Satrec()
        sat.sgp4init(
            WGS72,
            "i",
            es.norad_id,
            (jd + fr) - 2433281.5,      # epoch relative to 1949 December 31 00:00 UT
            es.bstar,
            es.mean_motion_dot,
            es.mean_motion_ddot,
            es.eccentricity,
            np.radians(es.arg_perigee_deg),
            np.radians(es.inclination_deg),
            np.radians(es.mean_anomaly_deg),
            es.mean_motion_rev_day * 2.0 * np.pi / 1440.0,   # rad/min
            np.radians(es.raan_deg),
        )
    return sat


def model_for(es: ElementSet) -> str:
    """Which analytic model SGP4 will internally select for this object."""
    return "SDP4" if es.period_min > DEEP_SPACE_PERIOD_MIN else "SGP4"


def propagate(
    es: ElementSet, when: datetime, satrec: Satrec | None = None
) -> StateVector:
    """
    Propagate one object to one instant.

    Raises :class:`PropagationError` on an SGP4 error code or on a state that
    is numerically finite but physically impossible.  It never returns a
    silently-wrong vector.
    """
    sat = satrec or build_satrec(es)
    jd, fr = datetime_to_jd(when)
    code, r, v = sat.sgp4(jd, fr)

    if code != 0:
        raise PropagationError(
            es.norad_id, code, SGP4_ERRORS.get(code, "unknown SGP4 error")
        )

    r_arr = np.asarray(r, dtype=float)
    v_arr = np.asarray(v, dtype=float)

    if not (np.all(np.isfinite(r_arr)) and np.all(np.isfinite(v_arr))):
        raise PropagationError(es.norad_id, -1, "non-finite state vector")

    radius = float(np.linalg.norm(r_arr))
    speed = float(np.linalg.norm(v_arr))
    if radius < MIN_RADIUS_KM:
        raise PropagationError(
            es.norad_id, -2, f"sub-surface position, r={radius:.1f} km"
        )
    if radius > MAX_RADIUS_KM:
        raise PropagationError(
            es.norad_id, -3, f"implausible radius, r={radius:.1f} km"
        )
    if speed > MAX_SPEED_KM_S:
        raise PropagationError(
            es.norad_id, -4, f"implausible speed, v={speed:.3f} km/s"
        )

    return StateVector(
        norad_id=es.norad_id,
        time=ensure_utc(when),
        position_km=r_arr,
        velocity_km_s=v_arr,
        frame=Frame.TEME,
        epoch=es.epoch,
        model=model_for(es),
        error_code=code,
    )


def propagate_many(
    element_sets: Sequence[ElementSet],
    times: Sequence[datetime],
    satrecs: Sequence[Satrec] | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Vectorised propagation of N objects across M instants.

    Returns
    -------
    positions : (N, M, 3) float array, km, TEME
    velocities: (N, M, 3) float array, km/s, TEME
    errors    : (N, M) int array of SGP4 status codes; 0 means good

    Entries with a non-zero error code contain NaN, so a caller that forgets to
    check the mask gets an obviously broken number rather than a plausible one.
    That is deliberate: silent garbage is the failure mode this project exists
    to avoid.
    """
    if not element_sets or not times:
        return (
            np.zeros((0, 0, 3)),
            np.zeros((0, 0, 3)),
            np.zeros((0, 0), dtype=np.int32),
        )

    sats = list(satrecs) if satrecs is not None else [
        build_satrec(es) for es in element_sets
    ]
    array = SatrecArray(sats)

    jd = np.empty(len(times), dtype=float)
    fr = np.empty(len(times), dtype=float)
    for i, t in enumerate(times):
        jd[i], fr[i] = datetime_to_jd(t)

    errors, positions, velocities = array.sgp4(jd, fr)

    bad = errors != 0
    if bad.any():
        positions[bad] = np.nan
        velocities[bad] = np.nan
        log_event(
            log,
            STAGE_PROPAGATION,
            "propagation_errors",
            level=logging.WARNING,
            failed_states=int(bad.sum()),
            total_states=int(errors.size),
            objects_affected=int(bad.any(axis=1).sum()),
        )

    return positions, velocities, errors


def propagate_track(
    es: ElementSet,
    start: datetime,
    duration_s: float,
    step_s: float,
    satrec: Satrec | None = None,
) -> tuple[list[datetime], np.ndarray, np.ndarray, np.ndarray]:
    """
    Propagate a single object across a uniform time grid.

    Used for orbit-path rendering and for the per-pair fine sweep.  Returns
    (times, positions (M,3), velocities (M,3), error codes (M,)).
    """
    from datetime import timedelta

    n = max(2, int(round(duration_s / step_s)) + 1)
    times = [ensure_utc(start) + timedelta(seconds=i * step_s) for i in range(n)]
    pos, vel, err = propagate_many([es], times, [satrec] if satrec else None)
    return times, pos[0], vel[0], err[0]


def propagation_report(
    element_sets: Iterable[ElementSet], errors: np.ndarray
) -> dict[str, int]:
    """
    Aggregate SGP4 status codes into a human-readable failure breakdown for the
    VALIDATION page.  Keys are the official SGP4 error strings.
    """
    report: dict[str, int] = {}
    if errors.size == 0:
        return report
    per_object = errors.max(axis=1) if errors.ndim == 2 else errors
    for code in np.unique(per_object):
        code_int = int(code)
        if code_int == 0:
            continue
        label = SGP4_ERRORS.get(code_int, f"unknown code {code_int}")
        report[label] = int((per_object == code).sum())
    return report

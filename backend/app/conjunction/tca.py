"""
KAKSHA -- Time of Closest Approach (TCA) refinement.

Spec section 20: "Do not assume the closest point occurs exactly at a fixed
timestep."  A coarse sweep at 60 s cadence locates an encounter to within
+/- 30 s, which at a 14 km/s closing speed is +/- 420 km of miss distance --
useless as a reported number.  This module turns that bracket into a TCA good
to well under a millisecond.

METHOD
------
Define the range-rate function

    g(t) = r_rel(t) . v_rel(t)

This is exactly (1/2) d/dt |r_rel|^2.  It is negative while the objects are
closing, zero at an extremum of separation, and positive while they recede.
So finding TCA is a ROOT-FINDING problem on g, not a minimisation problem on
|r_rel| -- and root finding is both faster and far more accurate, because g
crosses zero transversally while |r_rel| is flat (quadratic) at its minimum.
Minimising |r_rel| directly loses half the available precision to that
flatness; Brent's method on g does not.

Procedure:
  1. Sample g on a fine grid across the bracket (default 2 s).
  2. Find every sign change from negative to positive -- each is a local
     MINIMUM of separation.  Positive-to-negative changes are maxima and are
     ignored.
  3. Bracket each minimum and solve g(t) = 0 with Brent's method to a
     tolerance of 1e-6 s.
  4. Evaluate the exact SGP4 states at the root; report the smallest.

Every g evaluation is a real SGP4 call.  Nothing is interpolated, and no
polynomial stands in for the propagator.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
from scipy.optimize import brentq

from app.core.frames import Frame
from app.core.logging import STAGE_CONJUNCTION, get_logger
from app.data.catalog import CatalogObject
from app.propagation.sgp4_engine import StateVector, propagate_many

log = get_logger("conjunction.tca")

# Fine sampling cadence used to bracket the root, seconds.
DEFAULT_FINE_STEP_S = 2.0
# Brent tolerance on the root, seconds.  1 microsecond is ~1.5 cm of along-track
# motion, far below the accuracy of SGP4 itself.
ROOT_TOL_S = 1e-6
MAX_BRENT_ITER = 100


@dataclass(slots=True)
class ClosestApproach:
    """A refined close-approach solution."""

    norad_a: int
    norad_b: int
    tca: datetime
    miss_distance_km: float
    relative_position_km: np.ndarray     # r_a - r_b at TCA, TEME
    relative_velocity_km_s: np.ndarray   # v_a - v_b at TCA, TEME
    relative_speed_km_s: float
    state_a: StateVector
    state_b: StateVector
    frame: Frame = Frame.TEME
    converged: bool = True
    method: str = "brentq(range-rate)"
    iterations: int = 0
    # Residual range-rate at the reported TCA.  Should be ~0; a large value
    # means the solver did not actually land on an extremum.
    range_rate_residual_km2_s: float = 0.0
    fine_samples: int = 0

    @property
    def radial_separation_km(self) -> float:
        """Difference in geocentric radius -- how much of the miss is altitude."""
        return abs(
            float(np.linalg.norm(self.state_a.position_km))
            - float(np.linalg.norm(self.state_b.position_km))
        )


def _states_at(
    obj_a: CatalogObject, obj_b: CatalogObject, times: list[datetime]
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Propagate both objects onto the same time grid.

    Returns (r_rel, v_rel, ok) where r_rel/v_rel are (M, 3) and ok is a boolean
    mask of timesteps where BOTH propagations succeeded.
    """
    pos, vel, err = propagate_many(
        [obj_a.element_set, obj_b.element_set],
        times,
        [obj_a.satrec, obj_b.satrec],
    )
    ok = (err[0] == 0) & (err[1] == 0)
    r_rel = pos[0] - pos[1]
    v_rel = vel[0] - vel[1]
    return r_rel, v_rel, ok


def refine(
    obj_a: CatalogObject,
    obj_b: CatalogObject,
    bracket_start: datetime,
    bracket_end: datetime,
    fine_step_s: float = DEFAULT_FINE_STEP_S,
) -> ClosestApproach | None:
    """
    Refine a candidate encounter to its true TCA.

    Returns ``None`` if the pair cannot be propagated across the bracket, or if
    no minimum exists inside it (which happens when the coarse sweep flagged a
    monotone approach that bottoms out beyond the window).
    """
    span_s = (bracket_end - bracket_start).total_seconds()
    if span_s <= 0:
        return None

    n = max(3, int(round(span_s / fine_step_s)) + 1)
    times = [bracket_start + timedelta(seconds=i * span_s / (n - 1)) for i in range(n)]

    r_rel, v_rel, ok = _states_at(obj_a, obj_b, times)
    if ok.sum() < 3:
        return None

    # g(t) = r.v  -- zero at every extremum of separation.
    g = np.einsum("ij,ij->i", r_rel, v_rel)
    g = np.where(ok, g, np.nan)

    def g_at(offset_s: float) -> float:
        """Single-point evaluation of g, in seconds from `bracket_start`."""
        t = bracket_start + timedelta(seconds=offset_s)
        rr, vv, okk = _states_at(obj_a, obj_b, [t])
        if not okk[0]:
            return float("nan")
        return float(np.dot(rr[0], vv[0]))

    offsets = np.array([(t - bracket_start).total_seconds() for t in times])

    # Locate negative -> positive crossings: those are minima of separation.
    roots: list[float] = []
    for i in range(len(g) - 1):
        g0, g1 = g[i], g[i + 1]
        if not (np.isfinite(g0) and np.isfinite(g1)):
            continue
        if g0 == 0.0:
            roots.append(float(offsets[i]))
        elif g0 < 0.0 < g1:
            try:
                root = brentq(
                    g_at,
                    float(offsets[i]),
                    float(offsets[i + 1]),
                    xtol=ROOT_TOL_S,
                    maxiter=MAX_BRENT_ITER,
                )
                roots.append(float(root))
            except (ValueError, RuntimeError):
                # Brent could not converge on this bracket; fall back to the
                # grid sample rather than dropping the encounter entirely.
                roots.append(float(offsets[i if abs(g0) < abs(g1) else i + 1]))

    converged = bool(roots)
    if not roots:
        # No interior minimum.  The separation is monotone across the bracket,
        # so the closest point is whichever endpoint is nearer.  Reported with
        # converged=False so the validation engine can flag it.
        dists = np.linalg.norm(r_rel, axis=1)
        dists = np.where(ok, dists, np.inf)
        roots = [float(offsets[int(np.argmin(dists))])]

    # Evaluate every candidate root exactly and keep the closest.
    candidate_times = [bracket_start + timedelta(seconds=s) for s in roots]
    pos, vel, err = propagate_many(
        [obj_a.element_set, obj_b.element_set],
        candidate_times,
        [obj_a.satrec, obj_b.satrec],
    )
    valid = (err[0] == 0) & (err[1] == 0)
    if not valid.any():
        return None

    seps = np.linalg.norm(pos[0] - pos[1], axis=1)
    seps = np.where(valid, seps, np.inf)
    k = int(np.argmin(seps))

    tca = candidate_times[k]
    r_a, v_a = pos[0][k], vel[0][k]
    r_b, v_b = pos[1][k], vel[1][k]
    r_r = r_a - r_b
    v_r = v_a - v_b

    return ClosestApproach(
        norad_a=obj_a.norad_id,
        norad_b=obj_b.norad_id,
        tca=tca,
        miss_distance_km=float(np.linalg.norm(r_r)),
        relative_position_km=r_r,
        relative_velocity_km_s=v_r,
        relative_speed_km_s=float(np.linalg.norm(v_r)),
        state_a=StateVector(
            norad_id=obj_a.norad_id,
            time=tca,
            position_km=r_a,
            velocity_km_s=v_a,
            epoch=obj_a.element_set.epoch,
            model=obj_a.model,
        ),
        state_b=StateVector(
            norad_id=obj_b.norad_id,
            time=tca,
            position_km=r_b,
            velocity_km_s=v_b,
            epoch=obj_b.element_set.epoch,
            model=obj_b.model,
        ),
        converged=converged,
        iterations=len(roots),
        range_rate_residual_km2_s=float(np.dot(r_r, v_r)),
        fine_samples=n,
    )


def separation_profile(
    obj_a: CatalogObject,
    obj_b: CatalogObject,
    centre: datetime,
    half_window_s: float = 600.0,
    samples: int = 241,
) -> tuple[list[datetime], np.ndarray, np.ndarray]:
    """
    Separation and range-rate through an encounter, for the analysis charts.

    Returns (times, separation_km, range_rate_km_s).  Range rate is the true
    scalar d|r_rel|/dt = (r.v)/|r|, not the raw dot product, so the chart is in
    km/s and reads naturally: negative closing, zero at TCA, positive receding.
    """
    times = [
        centre + timedelta(seconds=s)
        for s in np.linspace(-half_window_s, half_window_s, samples)
    ]
    r_rel, v_rel, ok = _states_at(obj_a, obj_b, times)
    sep = np.linalg.norm(r_rel, axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        rate = np.einsum("ij,ij->i", r_rel, v_rel) / sep
    sep = np.where(ok, sep, np.nan)
    rate = np.where(ok, rate, np.nan)
    return times, sep, rate

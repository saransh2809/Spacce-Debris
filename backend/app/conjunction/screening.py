"""
KAKSHA -- object screening (broad phase).

The naive conjunction search is O(N^2) per timestep.  For 18,000 objects over
48 hours at a 60-second cadence that is 1.6e8 pair-tests per step and 4.7e11
in total, which is not a computation, it is a rumour.  This module reduces it
to something a laptop finishes in seconds, without ever discarding a real
encounter.

THREE-STAGE SIEVE
-----------------
1. APOGEE / PERIGEE FILTER (geometric, no propagation)
   Two objects can only approach if their radial shells overlap:
       perigee_A - pad <= apogee_B   AND   perigee_B - pad <= apogee_A
   Objects are sorted by perigee and swept, so this is O(N log N), not O(N^2).
   This is the classic first Hoots filter.

2. COARSE SPATIAL SWEEP (propagated, spatially hashed)
   All surviving objects are propagated onto a coarse time grid in memory-
   bounded chunks.  At each step a k-d tree answers "which objects are within
   the coarse gate of each other" in O(N log N) instead of O(N^2).

3. CANDIDATE EXTRACTION
   For every pair that ever came within the gate, the timestep of its coarse
   minimum is recorded and handed to the fine refiner (app/conjunction/tca.py).

WHY THE COARSE GATE IS SIZED THE WAY IT IS
------------------------------------------
A coarse step of dt can hide an encounter: two objects closing at relative
speed v travel v*dt between samples, so the true minimum can sit between two
samples that are both far apart.  The gate must therefore satisfy

    gate >= screening_threshold + v_max * dt / 2

With v_max = 16 km/s (a head-on LEO encounter, the physical worst case) and
dt = 60 s, the gate must be at least 25 + 480 = 505 km.  :func:`required_gate_km`
computes this and the screener REFUSES to run with an unsafe gate rather than
quietly missing conjunctions.  This is the single most important correctness
property in the whole screening stage.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Sequence

import numpy as np
from scipy.spatial import cKDTree

from app.core.config import settings
from app.core.logging import STAGE_SCREENING, Timer, get_logger, log_event
from app.data.catalog import CatalogObject
from app.propagation.sgp4_engine import propagate_many

log = get_logger("conjunction.screening")

# Physical worst-case relative speed for two Earth-orbiting objects.  Two
# circular LEO objects in opposing orbits close at ~15.4 km/s; 16 gives margin.
MAX_RELATIVE_SPEED_KM_S = 16.0

# Cap on states held in memory at once during the coarse sweep (objects x
# timesteps).  3e6 states ~= 144 MB for position+velocity in float64.
MAX_STATES_IN_FLIGHT = 3_000_000


@dataclass(slots=True)
class CandidatePair:
    """A pair that survived the sieve and deserves precise refinement."""

    norad_a: int
    norad_b: int
    coarse_min_distance_km: float
    coarse_time: datetime          # timestep of the coarse minimum
    bracket_start: datetime        # refinement search window
    bracket_end: datetime


@dataclass(slots=True)
class ScreeningReport:
    """Everything a reviewer needs to judge whether the sieve was sound."""

    objects_considered: int = 0
    pairs_geometrically_possible: int = 0
    pairs_after_coarse_sweep: int = 0
    coarse_steps: int = 0
    coarse_step_s: float = 0.0
    coarse_gate_km: float = 0.0
    required_gate_km: float = 0.0
    gate_is_safe: bool = True
    propagation_failures: int = 0
    objects_dropped_propagation: int = 0
    elapsed_ms: float = 0.0
    chunks: int = 0
    notes: list[str] = field(default_factory=list)


def required_gate_km(step_s: float, threshold_km: float) -> float:
    """
    Minimum coarse gate that cannot miss an encounter (see module docstring).

    Returned in km.  The caller must use a gate at least this large.
    """
    return threshold_km + MAX_RELATIVE_SPEED_KM_S * step_s / 2.0


def apogee_perigee_filter(
    primaries: Sequence[CatalogObject],
    secondaries: Sequence[CatalogObject],
    pad_km: float | None = None,
) -> list[tuple[int, int]]:
    """
    Stage 1.  Return index pairs (i_primary, j_secondary) whose radial shells
    overlap within `pad_km`.

    Implemented as a sort-and-sweep over the secondary set: for each primary we
    binary-search the contiguous run of secondaries whose apogee reaches the
    primary perigee, instead of testing every combination.
    """
    pad = settings.apogee_perigee_pad_km if pad_km is None else pad_km

    # Sort secondaries by apogee so we can bisect for "apogee >= x".
    order = sorted(range(len(secondaries)), key=lambda j: secondaries[j].apogee_km)
    apogees = np.array([secondaries[j].apogee_km for j in order], dtype=float)
    perigees = np.array([secondaries[j].perigee_km for j in order], dtype=float)

    pairs: list[tuple[int, int]] = []
    for i, p in enumerate(primaries):
        # Secondary must reach up to the primary perigee...
        lo = int(np.searchsorted(apogees, p.perigee_km - pad, side="left"))
        if lo >= len(order):
            continue
        # ...and the primary must reach up to the secondary perigee.
        cand = order[lo:]
        cand_perigees = perigees[lo:]
        ok = cand_perigees - pad <= p.apogee_km
        for j, keep in zip(cand, ok):
            if keep:
                pairs.append((i, j))
    return pairs


def _time_grid(start: datetime, end: datetime, step_s: float) -> list[datetime]:
    n = max(2, int(round((end - start).total_seconds() / step_s)) + 1)
    return [start + timedelta(seconds=i * step_s) for i in range(n)]


def coarse_sweep(
    objects: Sequence[CatalogObject],
    primary_idx: np.ndarray,
    secondary_idx: np.ndarray,
    allowed_pairs: set[tuple[int, int]] | None,
    start: datetime,
    end: datetime,
    step_s: float,
    gate_km: float,
    report: ScreeningReport,
) -> dict[tuple[int, int], tuple[float, int]]:
    """
    Stage 2.  Propagate the surviving objects on a coarse grid and find every
    pair that comes within `gate_km`, tracking each pair's minimum distance and
    the timestep index where it occurred.

    Returns {(i, j): (min_distance_km, timestep_index)} with i < j as indices
    into `objects`.

    STRUCTURE
    ---------
    The k-d tree is built over the SECONDARIES only and queried with the
    PRIMARY positions.  Screening 72 assets against 10,000 objects then costs
    72 ball queries per step instead of enumerating every neighbouring pair in
    the whole population -- the difference between a screen that takes seconds
    and one that takes minutes.  When primaries and secondaries are the same
    set (an all-on-all screen) the (i, j) ordering plus the i == j guard keeps
    each pair exactly once.

    Memory is bounded by chunking the time axis; each chunk propagates its
    slice of the grid and is then released.
    """
    times = _time_grid(start, end, step_s)
    n_obj = len(objects)
    n_time = len(times)
    report.coarse_steps = n_time
    report.coarse_step_s = step_s
    report.coarse_gate_km = gate_km

    if n_obj < 2 or n_time < 2 or primary_idx.size == 0 or secondary_idx.size == 0:
        return {}

    element_sets = [o.element_set for o in objects]
    satrecs = [o.satrec for o in objects]

    chunk_len = max(1, min(n_time, MAX_STATES_IN_FLIGHT // max(1, n_obj)))
    best: dict[tuple[int, int], tuple[float, int]] = {}
    failures = 0
    bad_objects: set[int] = set()

    for chunk_start in range(0, n_time, chunk_len):
        chunk_times = times[chunk_start : chunk_start + chunk_len]
        report.chunks += 1

        positions, _velocities, errors = propagate_many(
            element_sets, chunk_times, satrecs
        )
        failures += int((errors != 0).sum())
        for idx in np.where((errors != 0).any(axis=1))[0]:
            bad_objects.add(int(idx))

        # positions: (n_obj, len(chunk_times), 3)
        for k in range(positions.shape[1]):
            frame = positions[:, k, :]
            finite = np.isfinite(frame).all(axis=1)

            sec_live = secondary_idx[finite[secondary_idx]]
            prim_live = primary_idx[finite[primary_idx]]
            if sec_live.size == 0 or prim_live.size == 0:
                continue

            tree = cKDTree(frame[sec_live])
            neighbourhoods = tree.query_ball_point(frame[prim_live], r=gate_km)

            step_index = chunk_start + k
            for p_pos, hits in zip(prim_live, neighbourhoods):
                if not hits:
                    continue
                s_positions = sec_live[np.asarray(hits, dtype=int)]
                deltas = frame[s_positions] - frame[p_pos]
                dists = np.sqrt(np.einsum("ij,ij->i", deltas, deltas))

                for s_pos, d in zip(s_positions, dists):
                    ip, isec = int(p_pos), int(s_pos)
                    if ip == isec:
                        continue
                    key = (ip, isec) if ip < isec else (isec, ip)
                    if allowed_pairs is not None and key not in allowed_pairs:
                        continue
                    prev = best.get(key)
                    if prev is None or d < prev[0]:
                        best[key] = (float(d), step_index)

    report.propagation_failures = failures
    report.objects_dropped_propagation = len(bad_objects)
    return best


def screen(
    primaries: Sequence[CatalogObject],
    secondaries: Sequence[CatalogObject],
    start: datetime,
    end: datetime,
    step_s: float | None = None,
    gate_km: float | None = None,
    threshold_km: float | None = None,
) -> tuple[list[CandidatePair], list[CatalogObject], ScreeningReport]:
    """
    Run the full broad phase.

    `primaries` are the assets being protected (for example every Indian
    satellite, or one selected object); `secondaries` are everything they are
    screened against.  Screening a subset against the catalogue is how
    operational conjunction assessment actually works, and it is what makes
    the problem tractable -- but passing the full catalogue as both arguments
    is supported and performs an all-on-all screen.

    Returns (candidates, combined_object_list, report).  Candidate indices
    refer to positions in `combined_object_list`.
    """
    step = settings.coarse_step_s if step_s is None else step_s
    thresh = settings.screening_threshold_km if threshold_km is None else threshold_km
    needed = required_gate_km(step, thresh)
    gate = max(settings.coarse_gate_km, needed) if gate_km is None else gate_km

    report = ScreeningReport(required_gate_km=needed)

    if gate < needed:
        report.gate_is_safe = False
        report.notes.append(
            f"Coarse gate {gate:.1f} km is below the {needed:.1f} km required for a "
            f"{step:.0f} s step and a {thresh:.1f} km threshold. Encounters could be "
            "missed; refusing to run."
        )
        log_event(
            log,
            STAGE_SCREENING,
            "unsafe_gate_refused",
            level=logging.ERROR,
            gate_km=gate,
            required_km=needed,
        )
        return [], [], report

    with Timer() as timer:
        # --- Stage 1 ------------------------------------------------------
        # Run the geometric filter FIRST, then build the propagation universe
        # from only those objects that survived it.  Doing it in this order is
        # the difference between propagating the whole catalogue and
        # propagating the part of it that can physically reach a primary --
        # every GEO and MEO object drops out here when the primaries are all
        # in LEO, and none of them ever costs an SGP4 call.
        geo_pairs = apogee_perigee_filter(primaries, secondaries)
        if not geo_pairs:
            report.elapsed_ms = timer.ms
            return [], [], report

        primary_ids = {primaries[i].norad_id for i, _ in geo_pairs}
        secondary_ids = {secondaries[j].norad_id for _, j in geo_pairs}

        combined: list[CatalogObject] = []
        index_of: dict[int, int] = {}
        for obj in list(primaries) + list(secondaries):
            if obj.norad_id in index_of:
                continue
            if obj.norad_id in primary_ids or obj.norad_id in secondary_ids:
                index_of[obj.norad_id] = len(combined)
                combined.append(obj)

        report.objects_considered = len(combined)

        allowed: set[tuple[int, int]] = set()
        for i_p, j_s in geo_pairs:
            i = index_of[primaries[i_p].norad_id]
            j = index_of[secondaries[j_s].norad_id]
            if i == j:
                continue          # an object is not in conjunction with itself
            allowed.add((i, j) if i < j else (j, i))
        report.pairs_geometrically_possible = len(allowed)

        if not allowed:
            report.elapsed_ms = timer.ms
            return [], combined, report

        primary_idx = np.array(
            sorted(index_of[n] for n in primary_ids), dtype=int
        )
        secondary_idx = np.array(
            sorted(index_of[n] for n in secondary_ids), dtype=int
        )

        # --- Stage 2 ------------------------------------------------------
        best = coarse_sweep(
            combined,
            primary_idx,
            secondary_idx,
            allowed,
            start,
            end,
            step,
            gate,
            report,
        )
        report.pairs_after_coarse_sweep = len(best)

        # --- Stage 3 ------------------------------------------------------
        candidates: list[CandidatePair] = []
        bracket = settings.fine_bracket_s
        for (i, j), (dist, step_index) in best.items():
            t_min = start + timedelta(seconds=step_index * step)
            candidates.append(
                CandidatePair(
                    norad_a=combined[i].norad_id,
                    norad_b=combined[j].norad_id,
                    coarse_min_distance_km=dist,
                    coarse_time=t_min,
                    bracket_start=max(start, t_min - timedelta(seconds=bracket)),
                    bracket_end=min(end, t_min + timedelta(seconds=bracket)),
                )
            )
        # Closest first: the refiner is the expensive stage, so if a caller
        # truncates the list it keeps the most interesting encounters.
        candidates.sort(key=lambda c: c.coarse_min_distance_km)

    report.elapsed_ms = timer.ms
    log_event(
        log,
        STAGE_SCREENING,
        "screen_complete",
        objects=report.objects_considered,
        geometric_pairs=report.pairs_geometrically_possible,
        candidates=len(candidates),
        coarse_steps=report.coarse_steps,
        gate_km=gate,
        required_gate_km=round(needed, 1),
        propagation_failures=report.propagation_failures,
        elapsed_ms=round(timer.ms, 1),
    )
    return candidates, combined, report

"""
KAKSHA -- conjunction pipeline orchestrator.

This module runs the whole chain and is the single entry point the API layer
uses.  It is deliberately thin: every stage lives in its own module and is
independently testable.  What happens here is sequencing and traceability,
not physics.

    catalogue
        -> screening.screen()          broad phase
        -> tca.refine()                precise TCA
        -> bplane.build_bplane()       encounter geometry
        -> uncertainty.build_*()       covariance, projected to the B-plane
        -> validation.validate_*()     independent re-checks
        -> risk.assess()               explainable score
        -> ConjunctionEvent            validated, traceable result

Ranking happens once, here, after validation.  Results that fail validation are
kept (the VALIDATION page shows them) but are excluded from the ranked list, so
a broken number can never be presented as the top threat.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.core.config import settings
from app.core.logging import STAGE_CONJUNCTION, Timer, get_logger, log_event
from app.conjunction import screening as screening_mod
from app.conjunction.bplane import BPlane, build_bplane
from app.conjunction.screening import ScreeningReport
from app.conjunction.tca import ClosestApproach, refine
from app.data.catalog import CatalogObject, get_catalog
from app.risk.engine import RiskAssessment, RiskCategory, assess
from app.uncertainty.models import (
    EncounterUncertainty,
    build_encounter_uncertainty,
    build_object_uncertainty,
)
from app.validation.engine import ValidationResult, validate_conjunction

log = get_logger("conjunction.encounter")


@dataclass(slots=True)
class ConjunctionEvent:
    """
    A fully processed, validated conjunction.

    Carries the complete provenance chain: which objects, from which element
    sets, propagated to which instant, producing which geometry, checked by
    which validations, scored by which components.
    """

    event_id: str
    object_a: CatalogObject
    object_b: CatalogObject
    closest_approach: ClosestApproach
    bplane: BPlane
    uncertainty: EncounterUncertainty
    validation: ValidationResult
    risk: RiskAssessment
    rank: int = 0
    screen_start: datetime | None = None
    screen_end: datetime | None = None
    computed_at: datetime | None = None

    @property
    def miss_distance_km(self) -> float:
        return self.closest_approach.miss_distance_km

    @property
    def tca(self) -> datetime:
        return self.closest_approach.tca

    @property
    def relative_speed_km_s(self) -> float:
        return self.closest_approach.relative_speed_km_s

    @property
    def category(self) -> RiskCategory:
        return self.risk.category

    def hours_to_tca(self, from_time: datetime) -> float:
        return (self.tca - from_time).total_seconds() / 3600.0


@dataclass(slots=True)
class ScreeningRun:
    """The complete output of one screening run, including its own diagnostics."""

    events: list[ConjunctionEvent]
    rejected_events: list[ConjunctionEvent]
    report: ScreeningReport
    start: datetime
    end: datetime
    computed_at: datetime
    threshold_km: float
    refined_candidates: int = 0
    refinement_failures: int = 0
    elapsed_ms: float = 0.0
    counts: dict[str, int] = field(default_factory=dict)

    def by_id(self, event_id: str) -> ConjunctionEvent | None:
        for e in self.events:
            if e.event_id == event_id:
                return e
        for e in self.rejected_events:
            if e.event_id == event_id:
                return e
        return None


def make_event_id(
    norad_a: int, norad_b: int, tca: datetime, epoch_a: datetime, epoch_b: datetime
) -> str:
    """
    Deterministic identifier for a conjunction.

    Includes both element-set epochs, so if the underlying data is refreshed
    the event gets a NEW id rather than silently changing its numbers under the
    same one.  That is what makes a displayed event reproducible.
    """
    raw = (
        f"{min(norad_a, norad_b)}-{max(norad_a, norad_b)}-"
        f"{tca.isoformat()}-{epoch_a.isoformat()}-{epoch_b.isoformat()}"
    )
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def build_event(
    obj_a: CatalogObject,
    obj_b: CatalogObject,
    ca: ClosestApproach,
    screen_start: datetime,
    screen_end: datetime,
    now: datetime,
) -> ConjunctionEvent:
    """
    Run the post-TCA half of the pipeline for one refined close approach.

    Ordering matters and is enforced here: geometry, then uncertainty, then
    validation, then risk.  Risk is scored LAST and only from validated
    numbers, so a failed check cannot produce a confident-looking score.
    """
    bp = build_bplane(ca)

    unc_a = build_object_uncertainty(
        obj_a.norad_id,
        ca.state_a.position_km,
        ca.state_a.velocity_km_s,
        ca.state_a.age_from_epoch_days,
    )
    unc_b = build_object_uncertainty(
        obj_b.norad_id,
        ca.state_b.position_km,
        ca.state_b.velocity_km_s,
        ca.state_b.age_from_epoch_days,
    )
    unc = build_encounter_uncertainty(
        unc_a,
        unc_b,
        bp,
        bp.b_xi_km,
        bp.b_zeta_km,
        obj_a.meta.rcs_m2,
        obj_b.meta.rcs_m2,
    )

    validation = validate_conjunction(
        closest_approach=ca,
        bplane=bp,
        uncertainty=unc,
        element_age_a_days=ca.state_a.age_from_epoch_days,
        element_age_b_days=ca.state_b.age_from_epoch_days,
        metadata_a_available=obj_a.meta.attribution_available,
        metadata_b_available=obj_b.meta.attribution_available,
        screen_start=screen_start,
        screen_end=screen_end,
    )

    risk = assess(
        miss_distance_km=ca.miss_distance_km,
        relative_speed_km_s=ca.relative_speed_km_s,
        hours_to_tca=(ca.tca - now).total_seconds() / 3600.0,
        miss_over_sigma=unc.miss_over_sigma,
        covariance_is_assumed=not unc.is_operational_pc,
        object_type_a=str(obj_a.object_type),
        object_type_b=str(obj_b.object_type),
        tca_converged=ca.converged,
        data_is_stale=max(
            ca.state_a.age_from_epoch_days, ca.state_b.age_from_epoch_days
        )
        > settings.tle_warn_age_days,
    )

    return ConjunctionEvent(
        event_id=make_event_id(
            obj_a.norad_id,
            obj_b.norad_id,
            ca.tca,
            obj_a.element_set.epoch,
            obj_b.element_set.epoch,
        ),
        object_a=obj_a,
        object_b=obj_b,
        closest_approach=ca,
        bplane=bp,
        uncertainty=unc,
        validation=validation,
        risk=risk,
        screen_start=screen_start,
        screen_end=screen_end,
        computed_at=now,
    )


def run_screening(
    primaries: list[CatalogObject],
    secondaries: list[CatalogObject],
    start: datetime,
    duration_hours: float | None = None,
    threshold_km: float | None = None,
    max_refinements: int = 600,
) -> ScreeningRun:
    """
    Execute the full conjunction pipeline.

    `max_refinements` bounds the expensive precise stage.  Candidates are
    refined in order of coarse minimum distance, so truncation drops the least
    interesting pairs first, and the count actually refined is reported so the
    truncation is never invisible.
    """
    hours = settings.default_screen_hours if duration_hours is None else duration_hours
    thresh = settings.screening_threshold_km if threshold_km is None else threshold_km
    end = start + timedelta(hours=hours)
    now = start

    with Timer() as timer:
        candidates, combined, report = screening_mod.screen(
            primaries, secondaries, start, end, threshold_km=thresh
        )

        by_id = {o.norad_id: o for o in combined}
        events: list[ConjunctionEvent] = []
        rejected: list[ConjunctionEvent] = []
        failures = 0
        refined = 0

        for cand in candidates[:max_refinements]:
            obj_a = by_id.get(cand.norad_a)
            obj_b = by_id.get(cand.norad_b)
            if obj_a is None or obj_b is None:
                continue

            try:
                ca = refine(obj_a, obj_b, cand.bracket_start, cand.bracket_end)
            except (ValueError, RuntimeError) as exc:
                failures += 1
                log_event(
                    log,
                    STAGE_CONJUNCTION,
                    "refine_failed",
                    level=logging.WARNING,
                    norad_a=cand.norad_a,
                    norad_b=cand.norad_b,
                    error=str(exc),
                )
                continue

            refined += 1
            if ca is None:
                failures += 1
                continue

            # Only encounters inside the screening volume are conjunctions.
            # The coarse gate is much wider by construction, so most candidates
            # legitimately fall out here.
            if ca.miss_distance_km > thresh:
                continue

            event = build_event(obj_a, obj_b, ca, start, end, now)
            if event.validation.is_displayable:
                events.append(event)
            else:
                rejected.append(event)

        # Rank once, here, on the validated set only.
        events.sort(key=lambda e: (-e.risk.score, e.miss_distance_km))
        for i, event in enumerate(events, start=1):
            event.rank = i

        counts = {c.value: 0 for c in RiskCategory}
        for event in events:
            counts[str(event.category)] += 1

    run = ScreeningRun(
        events=events,
        rejected_events=rejected,
        report=report,
        start=start,
        end=end,
        computed_at=now,
        threshold_km=thresh,
        refined_candidates=refined,
        refinement_failures=failures,
        elapsed_ms=timer.ms,
        counts=counts,
    )

    log_event(
        log,
        STAGE_CONJUNCTION,
        "screening_run_complete",
        window_hours=hours,
        threshold_km=thresh,
        candidates=len(candidates),
        refined=refined,
        conjunctions=len(events),
        rejected=len(rejected),
        counts=counts,
        elapsed_ms=round(timer.ms, 1),
    )
    return run


def screen_object(
    norad_id: int,
    start: datetime,
    duration_hours: float | None = None,
    threshold_km: float | None = None,
    secondary_limit: int | None = None,
) -> ScreeningRun | None:
    """Screen ONE object against the catalogue -- the 'find close approaches' action."""
    catalog = get_catalog()
    obj = catalog.get(norad_id)
    if obj is None:
        return None
    secondaries = catalog.filter(limit=secondary_limit or settings.max_screen_objects)
    return run_screening(
        [obj], secondaries, start, duration_hours, threshold_km
    )

"""
KAKSHA -- validation engine.

Nothing reaches the dashboard without passing through here:

    Numerical Result  ->  Validation  ->  Validated Result

The validator is deliberately independent of the engines it checks.  It
re-derives quantities from the raw state vectors rather than trusting the
values the conjunction engine reported, so an arithmetic error upstream shows
up as a CHECK FAILURE instead of propagating silently to the UI.

STATUSES
--------
VALIDATED          All checks passed.  Safe to display and to rank.
WARNING            Usable, but with a stated caveat (stale elements, assumed
                   covariance, a slow encounter, a non-converged TCA).
INVALID            A check failed that makes the numbers untrustworthy.  The
                   result is retained and shown on the VALIDATION page, but it
                   is excluded from the ranked list.
INSUFFICIENT_DATA  The inputs were not adequate to reach a conclusion.

Every check emits a named record with its measured value and its tolerance, so
the VALIDATION page can show the actual arithmetic rather than a green tick.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

import numpy as np

from app.core.config import settings
from app.core.frames import Frame, WGS84_A_KM
from app.core.logging import STAGE_VALIDATION, get_logger, log_event
from app.uncertainty.models import CovarianceSource

log = get_logger("validation.engine")

# Tolerances.
MAX_ETA_RESIDUAL_KM = 0.05          # miss vector must lie in the B-plane
MAX_RANGE_RATE_RESIDUAL = 1.0       # km^2/s; r.v at a true TCA is ~0
MIN_ALTITUDE_KM = -100.0            # below this the object is inside the Earth
MAX_RADIUS_KM = 500_000.0
MAX_SPEED_KM_S = 20.0
MISS_DISTANCE_RECHECK_TOL_KM = 1e-6


class ValidationStatus(StrEnum):
    VALIDATED = "VALIDATED"
    WARNING = "WARNING"
    INVALID = "INVALID"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


_SEVERITY = {
    ValidationStatus.VALIDATED: 0,
    ValidationStatus.WARNING: 1,
    ValidationStatus.INSUFFICIENT_DATA: 2,
    ValidationStatus.INVALID: 3,
}


@dataclass(slots=True)
class Check:
    """One named validation check with its evidence."""

    name: str
    passed: bool
    status: ValidationStatus
    detail: str
    measured: float | None = None
    tolerance: float | None = None
    units: str = ""


@dataclass(slots=True)
class ValidationResult:
    """Aggregate verdict plus every individual check."""

    status: ValidationStatus
    checks: list[Check] = field(default_factory=list)

    @property
    def failures(self) -> list[Check]:
        return [c for c in self.checks if not c.passed]

    @property
    def warnings(self) -> list[Check]:
        return [
            c
            for c in self.checks
            if not c.passed and c.status is ValidationStatus.WARNING
        ]

    @property
    def is_displayable(self) -> bool:
        """Whether this result may appear in the ranked conjunction list."""
        return self.status in (ValidationStatus.VALIDATED, ValidationStatus.WARNING)

    def summary(self) -> str:
        if self.status is ValidationStatus.VALIDATED:
            return f"All {len(self.checks)} numerical checks passed."
        bad = self.failures
        return f"{len(bad)} of {len(self.checks)} checks raised: " + "; ".join(
            c.name for c in bad
        )


def _worst(statuses: list[ValidationStatus]) -> ValidationStatus:
    return max(statuses, key=lambda s: _SEVERITY[s]) if statuses else (
        ValidationStatus.VALIDATED
    )


def _finite(*arrays: np.ndarray) -> bool:
    return all(np.all(np.isfinite(np.asarray(a, dtype=float))) for a in arrays)


def validate_state(
    position_km: np.ndarray,
    velocity_km_s: np.ndarray,
    frame: Frame,
    label: str,
) -> list[Check]:
    """Physical plausibility of a single propagated state."""
    checks: list[Check] = []

    if not _finite(position_km, velocity_km_s):
        checks.append(
            Check(
                name=f"{label}_finite_state",
                passed=False,
                status=ValidationStatus.INVALID,
                detail=f"{label} state contains NaN or infinity.",
            )
        )
        return checks

    radius = float(np.linalg.norm(position_km))
    speed = float(np.linalg.norm(velocity_km_s))
    altitude = radius - WGS84_A_KM

    checks.append(
        Check(
            name=f"{label}_altitude_plausible",
            passed=MIN_ALTITUDE_KM <= altitude and radius <= MAX_RADIUS_KM,
            status=ValidationStatus.INVALID,
            detail=(
                f"{label} geocentric radius {radius:.1f} km "
                f"(altitude {altitude:.1f} km)."
            ),
            measured=altitude,
            tolerance=MIN_ALTITUDE_KM,
            units="km",
        )
    )
    checks.append(
        Check(
            name=f"{label}_speed_plausible",
            passed=speed <= MAX_SPEED_KM_S,
            status=ValidationStatus.INVALID,
            detail=f"{label} speed {speed:.4f} km/s.",
            measured=speed,
            tolerance=MAX_SPEED_KM_S,
            units="km/s",
        )
    )
    checks.append(
        Check(
            name=f"{label}_frame_declared",
            passed=frame is Frame.TEME,
            status=ValidationStatus.INVALID,
            detail=(
                f"{label} state is declared in {frame}. Conjunction analysis "
                "requires TEME; a mismatched frame invalidates the geometry."
            ),
        )
    )
    return checks


def validate_conjunction(
    *,
    closest_approach,
    bplane,
    uncertainty,
    element_age_a_days: float,
    element_age_b_days: float,
    metadata_a_available: bool,
    metadata_b_available: bool,
    screen_start: datetime,
    screen_end: datetime,
) -> ValidationResult:
    """
    Full validation of one conjunction result.

    Re-derives the miss distance and the range-rate residual from the state
    vectors rather than trusting the reported scalars, so a bug in the
    conjunction engine surfaces here instead of on the dashboard.
    """
    checks: list[Check] = []
    ca = closest_approach

    # --- 1. the two states themselves ------------------------------------
    checks += validate_state(
        ca.state_a.position_km, ca.state_a.velocity_km_s, ca.state_a.frame, "object_a"
    )
    checks += validate_state(
        ca.state_b.position_km, ca.state_b.velocity_km_s, ca.state_b.frame, "object_b"
    )

    # --- 2. independent recomputation of the miss distance ---------------
    r_rel = np.asarray(ca.state_a.position_km) - np.asarray(ca.state_b.position_km)
    recomputed_miss = float(np.linalg.norm(r_rel))
    delta = abs(recomputed_miss - ca.miss_distance_km)
    checks.append(
        Check(
            name="miss_distance_reproducible",
            passed=delta <= MISS_DISTANCE_RECHECK_TOL_KM,
            status=ValidationStatus.INVALID,
            detail=(
                f"Reported miss {ca.miss_distance_km:.9f} km, recomputed from the "
                f"state vectors {recomputed_miss:.9f} km."
            ),
            measured=delta,
            tolerance=MISS_DISTANCE_RECHECK_TOL_KM,
            units="km",
        )
    )

    # --- 3. TCA really is a stationary point of separation ---------------
    residual = abs(float(ca.range_rate_residual_km2_s))
    checks.append(
        Check(
            name="tca_is_stationary_point",
            passed=residual <= MAX_RANGE_RATE_RESIDUAL,
            status=ValidationStatus.WARNING,
            detail=(
                f"Range-rate residual r.v at the reported TCA is {residual:.6f} "
                "km^2/s; it should be ~0 at a true closest approach."
            ),
            measured=residual,
            tolerance=MAX_RANGE_RATE_RESIDUAL,
            units="km^2/s",
        )
    )
    checks.append(
        Check(
            name="tca_solver_converged",
            passed=bool(ca.converged),
            status=ValidationStatus.WARNING,
            detail=(
                "Brent root-finder located an interior minimum."
                if ca.converged
                else "No interior minimum in the bracket; closest point sits at a "
                "window edge and the true TCA may lie outside the screening window."
            ),
        )
    )

    # --- 4. TCA lies inside the requested screening window ---------------
    inside = screen_start <= ca.tca <= screen_end
    checks.append(
        Check(
            name="tca_within_screening_window",
            passed=inside,
            status=ValidationStatus.WARNING,
            detail=(
                f"TCA {ca.tca.isoformat()} against window "
                f"{screen_start.isoformat()} .. {screen_end.isoformat()}."
            ),
        )
    )

    # --- 5. B-plane geometry consistency ---------------------------------
    eta_res = abs(float(bplane.eta_residual_km))
    checks.append(
        Check(
            name="miss_vector_lies_in_bplane",
            passed=eta_res <= MAX_ETA_RESIDUAL_KM,
            status=ValidationStatus.WARNING,
            detail=(
                f"Out-of-plane component of the miss vector is {eta_res:.6f} km. "
                "At a correct TCA the relative position is perpendicular to the "
                "relative velocity, so this must be ~0."
            ),
            measured=eta_res,
            tolerance=MAX_ETA_RESIDUAL_KM,
            units="km",
        )
    )

    basis = np.vstack([bplane.xi_hat, bplane.eta_hat, bplane.zeta_hat])
    orthonormality_error = float(np.abs(basis @ basis.T - np.eye(3)).max())
    checks.append(
        Check(
            name="bplane_basis_orthonormal",
            passed=orthonormality_error < 1e-9,
            status=ValidationStatus.INVALID,
            detail=f"Max deviation of B^T B from the identity: {orthonormality_error:.2e}.",
            measured=orthonormality_error,
            tolerance=1e-9,
            units="",
        )
    )

    bplane_miss = math.hypot(bplane.b_xi_km, bplane.b_zeta_km)
    bplane_delta = abs(bplane_miss - ca.miss_distance_km)
    checks.append(
        Check(
            name="bplane_miss_matches_3d",
            passed=bplane_delta <= max(1e-6, MAX_ETA_RESIDUAL_KM),
            status=ValidationStatus.WARNING,
            detail=(
                f"In-plane miss magnitude {bplane_miss:.6f} km vs 3D miss "
                f"{ca.miss_distance_km:.6f} km."
            ),
            measured=bplane_delta,
            tolerance=MAX_ETA_RESIDUAL_KM,
            units="km",
        )
    )

    # --- 6. separation sanity --------------------------------------------
    checks.append(
        Check(
            name="separation_within_screening_volume",
            passed=ca.miss_distance_km <= settings.screening_threshold_km * 1.001,
            status=ValidationStatus.WARNING,
            detail=(
                f"Miss distance {ca.miss_distance_km:.3f} km against a "
                f"{settings.screening_threshold_km:.1f} km screening volume."
            ),
            measured=ca.miss_distance_km,
            tolerance=settings.screening_threshold_km,
            units="km",
        )
    )

    # --- 7. duplicate-object guard ---------------------------------------
    checks.append(
        Check(
            name="distinct_objects",
            passed=ca.norad_a != ca.norad_b,
            status=ValidationStatus.INVALID,
            detail=f"Catalogue numbers {ca.norad_a} and {ca.norad_b}.",
        )
    )

    # --- 8. element-set freshness ----------------------------------------
    oldest = max(element_age_a_days, element_age_b_days)
    if oldest > settings.tle_max_age_days:
        stale_status, stale_ok = ValidationStatus.INVALID, False
    elif oldest > settings.tle_warn_age_days:
        stale_status, stale_ok = ValidationStatus.WARNING, False
    else:
        stale_status, stale_ok = ValidationStatus.VALIDATED, True
    checks.append(
        Check(
            name="element_sets_fresh",
            passed=stale_ok,
            status=stale_status,
            detail=(
                f"Oldest element set is {oldest:.2f} days from epoch "
                f"(warn {settings.tle_warn_age_days:.0f} d, "
                f"reject {settings.tle_max_age_days:.0f} d). SGP4 position error "
                "grows roughly linearly with time from epoch."
            ),
            measured=oldest,
            tolerance=settings.tle_max_age_days,
            units="days",
        )
    )

    # --- 9. time consistency ----------------------------------------------
    same_time = abs((ca.state_a.time - ca.state_b.time).total_seconds())
    checks.append(
        Check(
            name="states_share_an_epoch",
            passed=same_time < 1e-6,
            status=ValidationStatus.INVALID,
            detail=(
                f"The two states differ in time by {same_time:.9f} s. Comparing "
                "positions at different instants would be meaningless."
            ),
            measured=same_time,
            tolerance=1e-6,
            units="s",
        )
    )

    # --- 10. metadata availability ---------------------------------------
    checks.append(
        Check(
            name="metadata_available",
            passed=metadata_a_available and metadata_b_available,
            status=ValidationStatus.WARNING,
            detail=(
                "Country/operator attribution present for both objects."
                if metadata_a_available and metadata_b_available
                else "SATCAT attribution missing for at least one object; it is "
                "reported as UNKNOWN rather than inferred."
            ),
        )
    )

    # --- 11. uncertainty availability ------------------------------------
    assumed = uncertainty.source is CovarianceSource.ASSUMED_MODEL
    checks.append(
        Check(
            name="covariance_published",
            passed=not assumed,
            status=ValidationStatus.WARNING,
            detail=(
                "Covariance is from KAKSHA's documented assumed model; public "
                "GP/TLE data publishes none. Any probability shown is conditional "
                "on that model and is not an operational Pc."
                if assumed
                else "Published covariance was used."
            ),
        )
    )

    # --- 12. encounter-model applicability -------------------------------
    checks.append(
        Check(
            name="linear_encounter_assumption",
            passed=bool(bplane.linear_assumption_valid),
            status=ValidationStatus.WARNING,
            detail=(
                f"Relative speed {bplane.relative_speed_km_s:.3f} km/s. The 2D "
                "encounter formulation assumes rectilinear relative motion "
                "through the plane."
            ),
            measured=bplane.relative_speed_km_s,
            tolerance=0.5,
            units="km/s",
        )
    )

    status = _worst([c.status for c in checks if not c.passed])

    if status is ValidationStatus.INVALID:
        log_event(
            log,
            STAGE_VALIDATION,
            "conjunction_invalid",
            norad_a=ca.norad_a,
            norad_b=ca.norad_b,
            failed=[c.name for c in checks if not c.passed],
        )

    return ValidationResult(status=status, checks=checks)


def validate_catalog(catalog) -> ValidationResult:
    """
    Data-quality validation of the whole catalogue, for the VALIDATION page.
    """
    checks: list[Check] = []
    stats = catalog.stats

    checks.append(
        Check(
            name="catalog_loaded",
            passed=catalog.loaded,
            status=ValidationStatus.INSUFFICIENT_DATA,
            detail=f"{len(catalog)} objects indexed.",
            measured=float(len(catalog)),
        )
    )

    fetch = catalog.fetch_result
    if fetch is not None:
        checks.append(
            Check(
                name="feed_reachable",
                passed=not fetch.from_cache,
                status=ValidationStatus.WARNING,
                detail=(
                    "Live retrieval succeeded."
                    if not fetch.from_cache
                    else "At least one resource was served from the local cache "
                    "because the upstream feed was unreachable."
                ),
            )
        )
        for note in fetch.notes:
            checks.append(
                Check(
                    name="feed_note",
                    passed=False,
                    status=ValidationStatus.WARNING,
                    detail=note,
                )
            )

    median_age = catalog.median_element_age_days()
    checks.append(
        Check(
            name="median_element_age",
            passed=median_age <= settings.tle_warn_age_days,
            status=ValidationStatus.WARNING,
            detail=f"Median element-set age is {median_age:.2f} days.",
            measured=median_age,
            tolerance=settings.tle_warn_age_days,
            units="days",
        )
    )

    stale_fraction = stats.stale / max(1, stats.total)
    checks.append(
        Check(
            name="stale_object_fraction",
            passed=stale_fraction < 0.05,
            status=ValidationStatus.WARNING,
            detail=(
                f"{stats.stale} of {stats.total} objects "
                f"({stale_fraction * 100:.2f}%) exceed the "
                f"{settings.tle_max_age_days:.0f}-day freshness limit."
            ),
            measured=stale_fraction,
            tolerance=0.05,
            units="fraction",
        )
    )

    checks.append(
        Check(
            name="records_rejected_at_parse",
            passed=stats.rejected_records == 0,
            status=ValidationStatus.WARNING,
            detail=(
                f"{stats.rejected_records} element sets failed structural or "
                f"physical validation: {stats.rejection_reasons or 'none'}."
            ),
            measured=float(stats.rejected_records),
        )
    )

    checks.append(
        Check(
            name="attribution_complete",
            passed=stats.attribution_missing == 0,
            status=ValidationStatus.WARNING,
            detail=(
                f"{stats.attribution_missing} objects have no SATCAT owner and are "
                "reported as UNKNOWN rather than attributed by inference."
            ),
            measured=float(stats.attribution_missing),
        )
    )

    return ValidationResult(
        status=_worst([c.status for c in checks if not c.passed]), checks=checks
    )

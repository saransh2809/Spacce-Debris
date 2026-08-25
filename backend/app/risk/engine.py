"""
KAKSHA -- risk triage engine.

This is the ONLY place a risk category is decided.  The frontend never
recomputes it, never hardcodes a label, and never re-sorts by its own rule.
The LLM never adjusts it.  If a conjunction is ranked #1, the reason is a
number produced here.

WHAT THIS IS AND IS NOT
-----------------------
This is a SCREENING PRIORITY SCORE, not a probability.  It answers "which of
these encounters should a human look at first", which is the question a
screening system can legitimately answer from public GP data.  It deliberately
does NOT claim to answer "how likely is a collision", because the covariance
required for that is not published (see app/uncertainty/models.py).

Terminology used throughout: conjunction, close approach, screening event,
risk score, risk category.  Never "collision probability".

SCORING
-------
Five normalised components in [0, 1], combined by the weights in
app/core/config.py (asserted to sum to 1.0 at import), scaled to 0-100:

  1. MISS DISTANCE (w=0.40)
     Log-scaled against the screening threshold.  Log, not linear, because the
     difference between 0.5 km and 1 km matters enormously while the difference
     between 20 km and 25 km barely matters at all.

  2. UNCERTAINTY RATIO (w=0.30)
     The miss distance expressed in combined 1-sigma units.  A 5 km miss with
     0.5 km sigma is a comfortable pass; a 5 km miss with 8 km sigma is not.
     This is what makes the ranking uncertainty-aware rather than purely
     geometric.

  3. RELATIVE VELOCITY (w=0.15)
     Consequence proxy.  Collision energy scales with the square of relative
     speed, so a 14 km/s encounter and a 0.2 km/s encounter are not comparable
     events even at identical miss distance.

  4. TIME TO TCA (w=0.10)
     Operational urgency.  An encounter in 4 hours needs attention before one
     in 40 hours, all else equal.  This is the only component that is about
     human response time rather than physics.

  5. OBJECT CLASS (w=0.05)
     Consequence weighting: an active satellite or crewed station is a worse
     thing to lose than a spent rocket body, and a debris-generating event in a
     congested shell is worse than one in an empty regime.

Every component records its raw input, its normalised value and its weighted
contribution, so the API can answer "why is this ranked #1" with arithmetic
rather than adjectives.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import StrEnum

from app.core.config import settings
from app.core.logging import get_logger
from app.data.metadata import ObjectType

log = get_logger("risk.engine")


class RiskCategory(StrEnum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MODERATE = "MODERATE"
    LOW = "LOW"


# Consequence weighting by object class.  A conjunction between two pieces of
# debris still matters (it creates more debris) but ranks below one that
# threatens a working asset.
_CLASS_WEIGHT: dict[str, float] = {
    ObjectType.SPACE_STATION: 1.00,
    ObjectType.ACTIVE_SATELLITE: 0.85,
    ObjectType.INACTIVE_SATELLITE: 0.55,
    ObjectType.ROCKET_BODY: 0.45,
    ObjectType.DEBRIS: 0.35,
    ObjectType.UNKNOWN: 0.40,
}

# Relative speed at which the velocity component saturates, km/s.  Head-on LEO
# encounters top out near 15.4 km/s.
_VELOCITY_SATURATION_KM_S = 15.0
# Time-to-TCA horizon, hours.  Beyond this the urgency component is 0.
_URGENCY_HORIZON_H = 48.0
# Miss-over-sigma at which the uncertainty component reaches 0.  Beyond 6 sigma
# the encounter is statistically comfortable regardless of geometry.
_SIGMA_SATURATION = 6.0


@dataclass(slots=True)
class RiskComponent:
    """One scored factor, fully traceable from raw input to contribution."""

    name: str
    raw_value: float
    raw_units: str
    normalised: float          # 0-1
    weight: float
    contribution: float        # normalised * weight * 100
    explanation: str


@dataclass(slots=True)
class RiskAssessment:
    """The complete, explainable output of the risk engine."""

    score: float                       # 0-100
    category: RiskCategory
    components: list[RiskComponent] = field(default_factory=list)
    thresholds: dict[str, float] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def explain(self) -> dict:
        """Structured 'why this rank' payload -- the input to the LLM layer."""
        return {
            "score": round(self.score, 2),
            "category": str(self.category),
            "formula": "score = 100 * sum(weight_i * normalised_i)",
            "category_boundaries": self.thresholds,
            "components": [
                {
                    "name": c.name,
                    "raw_value": c.raw_value,
                    "units": c.raw_units,
                    "normalised": round(c.normalised, 4),
                    "weight": c.weight,
                    "points_contributed": round(c.contribution, 2),
                    "explanation": c.explanation,
                }
                for c in self.components
            ],
            "notes": self.notes,
        }


def _miss_distance_component(miss_km: float) -> RiskComponent:
    """
    Log-scaled proximity.  1.0 at contact, 0.0 at the screening threshold.

        n = 1 - log(1 + miss/s) / log(1 + threshold/s),   s = 0.5 km
    """
    threshold = settings.screening_threshold_km
    scale = 0.5
    if miss_km <= 0.0:
        n = 1.0
    else:
        n = 1.0 - math.log1p(miss_km / scale) / math.log1p(threshold / scale)
    n = max(0.0, min(1.0, n))
    return RiskComponent(
        name="miss_distance",
        raw_value=round(miss_km, 4),
        raw_units="km",
        normalised=n,
        weight=settings.w_miss_distance,
        contribution=n * settings.w_miss_distance * 100.0,
        explanation=(
            f"Predicted minimum separation is {miss_km:.3f} km against a "
            f"{threshold:.0f} km screening volume. Scored on a logarithmic scale, "
            "so sub-kilometre differences dominate."
        ),
    )


def _uncertainty_component(miss_over_sigma: float, is_assumed: bool) -> RiskComponent:
    """
    How significant the miss is relative to the combined position uncertainty.

    n = 1 at 0 sigma, falling linearly to 0 at 6 sigma.
    """
    ratio = max(0.0, float(miss_over_sigma))
    n = max(0.0, min(1.0, 1.0 - ratio / _SIGMA_SATURATION))
    qualifier = "assumed" if is_assumed else "published"
    return RiskComponent(
        name="uncertainty_ratio",
        raw_value=round(ratio, 3),
        raw_units="sigma",
        normalised=n,
        weight=settings.w_uncertainty_ratio,
        contribution=n * settings.w_uncertainty_ratio * 100.0,
        explanation=(
            f"The miss distance is {ratio:.2f} combined 1-sigma units under the "
            f"{qualifier} covariance model. Below about 3 sigma the separation is "
            "not comfortably larger than the position error."
        ),
    )


def _velocity_component(rel_speed_km_s: float) -> RiskComponent:
    """
    Consequence proxy.  Normalised on relative KINETIC ENERGY (v^2), not v,
    because that is what determines how destructive an impact would be.
    """
    v = max(0.0, float(rel_speed_km_s))
    n = min(1.0, (v / _VELOCITY_SATURATION_KM_S) ** 2)
    return RiskComponent(
        name="relative_velocity",
        raw_value=round(v, 4),
        raw_units="km/s",
        normalised=n,
        weight=settings.w_relative_velocity,
        contribution=n * settings.w_relative_velocity * 100.0,
        explanation=(
            f"Relative velocity at closest approach is {v:.3f} km/s. Scored on "
            "v^2 because impact energy, not speed, sets the consequence."
        ),
    )


def _urgency_component(hours_to_tca: float) -> RiskComponent:
    """Linear urgency ramp across the screening horizon."""
    h = float(hours_to_tca)
    if h <= 0.0:
        n = 1.0
    else:
        n = max(0.0, min(1.0, 1.0 - h / _URGENCY_HORIZON_H))
    return RiskComponent(
        name="time_to_tca",
        raw_value=round(h, 3),
        raw_units="hours",
        normalised=n,
        weight=settings.w_time_to_tca,
        contribution=n * settings.w_time_to_tca * 100.0,
        explanation=(
            f"Closest approach is {h:.2f} hours away. Nearer events rank higher "
            "because they leave less time to plan a response."
        ),
    )


def _object_class_component(type_a: str, type_b: str) -> RiskComponent:
    """Consequence weighting from the two object classes."""
    wa = _CLASS_WEIGHT.get(type_a, 0.4)
    wb = _CLASS_WEIGHT.get(type_b, 0.4)
    # The more valuable object drives the consequence, with a smaller
    # contribution from the other.
    n = max(wa, wb) * 0.75 + min(wa, wb) * 0.25
    return RiskComponent(
        name="object_class",
        raw_value=round(n, 3),
        raw_units="index",
        normalised=n,
        weight=settings.w_object_class,
        contribution=n * settings.w_object_class * 100.0,
        explanation=(
            f"Encounter involves {type_a.replace('_', ' ').lower()} and "
            f"{type_b.replace('_', ' ').lower()}. Losing an operational asset is "
            "weighted above a debris-on-debris event."
        ),
    )


def categorise(score: float) -> RiskCategory:
    """Map a 0-100 score onto a category using the configured boundaries."""
    if score >= settings.risk_critical_score:
        return RiskCategory.CRITICAL
    if score >= settings.risk_high_score:
        return RiskCategory.HIGH
    if score >= settings.risk_moderate_score:
        return RiskCategory.MODERATE
    return RiskCategory.LOW


def assess(
    *,
    miss_distance_km: float,
    relative_speed_km_s: float,
    hours_to_tca: float,
    miss_over_sigma: float,
    covariance_is_assumed: bool,
    object_type_a: str,
    object_type_b: str,
    tca_converged: bool = True,
    data_is_stale: bool = False,
) -> RiskAssessment:
    """
    Score a validated conjunction.

    Inputs are all NUMERICAL results from the physics pipeline.  Nothing here
    reads a name, a country, or any narrative attribute -- the score cannot be
    influenced by anything except measured or modelled quantities.
    """
    components = [
        _miss_distance_component(miss_distance_km),
        _uncertainty_component(miss_over_sigma, covariance_is_assumed),
        _velocity_component(relative_speed_km_s),
        _urgency_component(hours_to_tca),
        _object_class_component(object_type_a, object_type_b),
    ]

    score = sum(c.contribution for c in components)
    score = max(0.0, min(100.0, score))

    notes: list[str] = []
    if covariance_is_assumed:
        notes.append(
            "Uncertainty component uses KAKSHA's assumed covariance model; no "
            "published covariance exists for public GP data."
        )
    if not tca_converged:
        notes.append(
            "The TCA solver did not find an interior minimum in the search "
            "bracket; the reported closest approach may sit at a window edge."
        )
    if data_is_stale:
        notes.append(
            "At least one element set is older than the configured freshness "
            "limit, which inflates real position error beyond the modelled value."
        )

    return RiskAssessment(
        score=score,
        category=categorise(score),
        components=components,
        thresholds={
            "CRITICAL": settings.risk_critical_score,
            "HIGH": settings.risk_high_score,
            "MODERATE": settings.risk_moderate_score,
            "LOW": 0.0,
        },
        notes=notes,
    )


def weights_description() -> dict:
    """The scoring configuration, for the CALCULATIONS and VALIDATION pages."""
    return {
        "formula": "score = 100 * sum(weight_i * normalised_i)",
        "weights": {
            "miss_distance": settings.w_miss_distance,
            "uncertainty_ratio": settings.w_uncertainty_ratio,
            "relative_velocity": settings.w_relative_velocity,
            "time_to_tca": settings.w_time_to_tca,
            "object_class": settings.w_object_class,
        },
        "weights_sum": settings.risk_weights_sum,
        "category_boundaries": {
            "CRITICAL": f">= {settings.risk_critical_score}",
            "HIGH": f">= {settings.risk_high_score}",
            "MODERATE": f">= {settings.risk_moderate_score}",
            "LOW": f"< {settings.risk_moderate_score}",
        },
        "normalisation": {
            "miss_distance": "1 - log1p(miss/0.5) / log1p(threshold/0.5)",
            "uncertainty_ratio": f"1 - (miss/sigma) / {_SIGMA_SATURATION}",
            "relative_velocity": f"(v / {_VELOCITY_SATURATION_KM_S})^2, capped at 1",
            "time_to_tca": f"1 - hours / {_URGENCY_HORIZON_H}",
            "object_class": "0.75*max(class weight) + 0.25*min(class weight)",
        },
        "object_class_weights": dict(_CLASS_WEIGHT),
        "disclaimer": (
            "This is a screening-priority score, not a probability of collision. "
            "It ranks which encounters deserve human attention first."
        ),
    }

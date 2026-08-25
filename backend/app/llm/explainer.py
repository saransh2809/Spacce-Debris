"""
KAKSHA -- LLM explanation layer.

POSITION IN THE ARCHITECTURE
----------------------------
This module sits at the very END of the pipeline and has no path back into it.
It receives a VALIDATED numerical result and returns prose.  It cannot
propagate, cannot solve for TCA, cannot compute a miss distance, cannot rank,
and cannot alter a value.  Structurally it never sees a catalogue, a
propagator or a risk engine -- only a finished, serialised result.

The physics is the scientist.  This is the person who writes up the result.

ENFORCEMENT
-----------
Three independent layers, because a system prompt alone is a request:

  1. STRUCTURAL   The prompt contains only the finished numbers. There is no
                  tool, no catalogue access, no propagator in scope.
  2. INSTRUCTIONAL A system prompt stating the rules explicitly.
  3. MECHANICAL   Post-generation audit (app/llm/guardrails.py) that traces
                  every numeral in the output back to a supplied value, plus a
                  scan for overstated claims. Failures are reported to the
                  client, not hidden.

If the API key is absent or the call fails, the endpoint returns a
deterministic template explanation built directly from the numbers, clearly
labelled as such.  The dashboard never loses its explanation panel because a
network call failed, and it never fabricates one either.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.core.logging import STAGE_LLM, Timer, get_logger, log_event
from app.llm.guardrails import audit_numbers, check_claims
from app.llm.providers import resolve_provider

log = get_logger("llm.explainer")

SYSTEM_PROMPT = """\
You are the explanation layer of KAKSHA, a space situational awareness system \
built for conjunction screening of Earth-orbiting objects.

YOUR ROLE
You receive a conjunction result that has ALREADY been computed and validated \
by a numerical pipeline (SGP4 propagation, Brent root-finding for time of \
closest approach, Foster B-plane encounter geometry, covariance projection, an \
independent validation stage, and a weighted risk-scoring engine). Your job is \
to explain that result to an operator in clear, precise language.

ABSOLUTE RULES
1. You must NOT perform any orbital mechanics. You did not compute these \
numbers and must never imply that you did.
2. You must NOT invent, estimate, adjust, round beyond two decimal places, or \
extrapolate any numerical value. Use only the values supplied to you.
3. You must NOT change the risk category or the rank. They were decided by the \
risk engine.
4. You must NOT describe a conjunction as a collision, a predicted collision, \
or an impact. A conjunction is a predicted CLOSE APPROACH. Objects passing \
within kilometres of each other is routine.
5. You must NOT use the phrase "probability of collision" unless the supplied \
data has is_operational_pc set to true. When covariance_source is \
ASSUMED_MODEL, any probability figure is CONDITIONAL ON AN ASSUMED MODEL and \
you must say so plainly.
6. If a value is missing or null, say "data unavailable". Never fill a gap.
7. Distinguish clearly between what was CALCULATED (miss distance, TCA, \
relative velocity, encounter geometry) and what was ASSUMED (covariance, \
hard-body radius) or is METADATA (names, country, object type).

STYLE
Write for a spacecraft operations analyst: direct, quantitative, no drama, no \
marketing language, no emoji. Use the units given. Prefer short paragraphs. \
Do not open with a restatement of the question.

OUTPUT SHAPE
Return plain prose with these sections, using these exact headings:

SUMMARY
Two or three sentences: which objects, how close, when, and the risk category.

WHY THIS RANKING
Walk through the scoring components you were given, naming the actual numbers \
and how much each contributed. This must reconcile with the supplied score.

UNCERTAINTY
State the covariance source. If it is assumed, say clearly that public orbital \
element data does not publish covariance and that the figures follow from \
KAKSHA's documented model.

WHAT THIS DOES NOT MEAN
One short paragraph on the limits of this result.
"""


@dataclass(slots=True)
class Explanation:
    """A generated explanation plus everything needed to trust it."""

    text: str
    model: str
    source: str                       # "llm" or "deterministic-template"
    provider: str = "none"            # "anthropic", "gemini", "none", "unknown"
    audit: dict[str, Any] = field(default_factory=dict)
    claim_violations: list[str] = field(default_factory=list)
    elapsed_ms: float = 0.0
    error: str | None = None

    def as_dict(self) -> dict:
        return {
            "explanation": self.text,
            "model": self.model,
            "provider": self.provider,
            "source": self.source,
            "numeric_audit": self.audit,
            "claim_violations": self.claim_violations,
            "verified": bool(self.audit.get("passed")) and not self.claim_violations,
            "elapsed_ms": round(self.elapsed_ms, 1),
            "error": self.error,
            "guarantee": (
                "The LLM receives only finished numbers. It cannot propagate "
                "orbits, solve for TCA, compute miss distance, or change a risk "
                "ranking. Every numeral it produced was checked against the "
                "values supplied to it."
            ),
        }


def build_payload(event_detail: dict) -> dict:
    """
    Reduce a full serialised event to the minimal set of finished numbers the
    explanation needs.

    Deliberately narrow: the model cannot reason about data it was never given,
    so the smaller this payload is, the smaller the surface for invention.
    """
    ca = event_detail.get("closest_approach", {})
    unc = event_detail.get("uncertainty", {})
    risk = event_detail.get("risk", {})
    val = event_detail.get("validation", {})
    bp = event_detail.get("bplane", {})

    return {
        "object_1": {
            "name": event_detail["object_a"]["name"],
            "norad_id": event_detail["object_a"]["norad_id"],
            "type": event_detail["object_a"]["object_type"],
            "country": event_detail["object_a"]["country"],
            "attribution_available": event_detail["object_a"].get(
                "attribution_available"
            ),
        },
        "object_2": {
            "name": event_detail["object_b"]["name"],
            "norad_id": event_detail["object_b"]["norad_id"],
            "type": event_detail["object_b"]["object_type"],
            "country": event_detail["object_b"]["country"],
            "attribution_available": event_detail["object_b"].get(
                "attribution_available"
            ),
        },
        "tca_utc": event_detail.get("tca"),
        "hours_to_tca": event_detail.get("hours_to_tca"),
        "miss_distance_km": event_detail.get("miss_distance_km"),
        "relative_velocity_km_s": event_detail.get("relative_speed_km_s"),
        "radial_separation_km": event_detail.get("radial_separation_km"),
        "encounter_angle_deg": bp.get("encounter_angle_deg"),
        "rank": event_detail.get("rank"),
        "risk_category": event_detail.get("risk_category"),
        "risk_score": event_detail.get("risk_score"),
        "risk_components": risk.get("components"),
        "risk_formula": risk.get("formula"),
        "risk_category_boundaries": risk.get("category_boundaries"),
        "covariance_source": unc.get("source"),
        "is_operational_pc": unc.get("is_operational_pc"),
        "probability_label": unc.get("probability_label"),
        "conditional_encounter_probability": unc.get(
            "conditional_encounter_probability"
        ),
        "miss_over_sigma": unc.get("miss_over_sigma"),
        "mahalanobis_distance": unc.get("mahalanobis_distance"),
        "combined_sigma_major_km": (unc.get("combined_2d") or {}).get(
            "sigma_major_km"
        ),
        "combined_sigma_minor_km": (unc.get("combined_2d") or {}).get(
            "sigma_minor_km"
        ),
        "hard_body_radius_m": unc.get("hard_body_radius_m"),
        "hard_body_radius_source": unc.get("hard_body_radius_source"),
        "uncertainty_caveats": unc.get("caveats"),
        "validation_status": val.get("status"),
        "validation_summary": val.get("summary"),
        "propagation_model": (ca.get("state_a") or {}).get("propagation_model"),
        "element_age_a_days": (ca.get("state_a") or {}).get(
            "propagated_days_from_epoch"
        ),
        "element_age_b_days": (ca.get("state_b") or {}).get(
            "propagated_days_from_epoch"
        ),
        "linear_assumption_valid": bp.get("linear_assumption_valid"),
    }


def _deterministic_explanation(p: dict) -> str:
    """
    Template explanation built directly from the numbers.

    Used when the LLM is unavailable. It contains no generated content at all,
    so it cannot be wrong in a way the numbers are not.
    """
    def f(value: Any, digits: int = 3, dash: str = "data unavailable") -> str:
        if value is None:
            return dash
        try:
            return f"{float(value):.{digits}f}"
        except (TypeError, ValueError):
            return str(value)

    a, b = p["object_1"], p["object_2"]
    assumed = p.get("covariance_source") == "ASSUMED_MODEL"

    components = p.get("risk_components") or []
    breakdown = "\n".join(
        f"  - {c['name'].replace('_', ' ')}: {c['raw_value']} {c['units']} "
        f"-> {c['points_contributed']} points (weight {c['weight']})"
        for c in components
    )

    prob_line = (
        "Public orbital element data does not publish covariance, so the figure "
        f"of {p.get('conditional_encounter_probability')} is conditional on "
        "KAKSHA's documented assumed error model and is NOT an operational "
        "probability of collision."
        if assumed
        else f"Probability of collision: {p.get('conditional_encounter_probability')}."
    )

    return f"""SUMMARY
{a['name']} (NORAD {a['norad_id']}, {a['country']}) and {b['name']} (NORAD \
{b['norad_id']}, {b['country']}) are predicted to reach a minimum separation of \
{f(p.get('miss_distance_km'))} km at {p.get('tca_utc')}, which is \
{f(p.get('hours_to_tca'), 2)} hours from the analysis epoch. Relative velocity at \
closest approach is {f(p.get('relative_velocity_km_s'))} km/s. The screening \
engine classified this encounter as {p.get('risk_category')} and ranked it \
#{p.get('rank')}.

WHY THIS RANKING
The composite screening score is {f(p.get('risk_score'), 2)} out of 100, formed as \
{p.get('risk_formula')}. Component contributions:
{breakdown}

UNCERTAINTY
Covariance source: {p.get('covariance_source')}. The miss distance corresponds to \
{f(p.get('miss_over_sigma'), 2)} combined 1-sigma units, with a Mahalanobis \
distance of {f(p.get('mahalanobis_distance'), 2)}. Combined position uncertainty in \
the encounter plane has semi-axes of {f(p.get('combined_sigma_major_km'), 3)} km and \
{f(p.get('combined_sigma_minor_km'), 3)} km. Hard-body radius \
{f(p.get('hard_body_radius_m'), 1)} m ({p.get('hard_body_radius_source')}). \
{prob_line}

WHAT THIS DOES NOT MEAN
This is a predicted close approach, not a predicted collision. Validation status \
is {p.get('validation_status')}. Objects routinely pass within a few kilometres \
of one another. The result is a screening priority produced from publicly \
published orbital elements propagated with {p.get('propagation_model')}, and it \
is not suitable for operational collision avoidance."""


async def explain_conjunction(event_detail: dict) -> Explanation:
    """
    Generate an explanation for one validated conjunction.

    Always returns an Explanation. Failure modes degrade to the deterministic
    template rather than to an empty panel or an invented one.
    """
    import json

    payload = build_payload(event_detail)
    is_operational = bool(payload.get("is_operational_pc"))

    provider, status = resolve_provider()

    if provider is None:
        text = _deterministic_explanation(payload)
        return Explanation(
            text=text,
            model="none",
            source="deterministic-template",
            provider=status.provider,
            audit=audit_numbers(text, payload).as_dict(),
            claim_violations=check_claims(text, is_operational),
            error=None if not settings.llm_enabled else status.detail,
        )

    user_prompt = (
        "Explain this validated conjunction screening result. "
        "Use only the values below.\n\n"
        f"{json.dumps(payload, indent=2, default=str)}"
    )

    with Timer() as timer:
        try:
            text = await provider.generate(
                SYSTEM_PROMPT, user_prompt, settings.llm_max_tokens
            )
            source = "llm"
            error = None
        except Exception as exc:  # noqa: BLE001
            # Every failure mode -- bad key, wrong vendor, rate limit, safety
            # stop, network -- lands here and degrades to the template. The
            # panel is never empty and never invented.
            log_event(
                log,
                STAGE_LLM,
                "generation_failed",
                level=logging.ERROR,
                provider=provider.name,
                model=provider.model,
                error=str(exc),
            )
            text = _deterministic_explanation(payload)
            source = "deterministic-template"
            error = (
                f"{provider.name} call failed ({exc}); served the deterministic "
                "template."
            )

    audit = audit_numbers(text, payload)
    violations = check_claims(text, is_operational)

    log_event(
        log,
        STAGE_LLM,
        "explanation_generated",
        provider=provider.name,
        source=source,
        audit_passed=audit.passed,
        numbers_found=audit.numbers_found,
        unverified=len(audit.unverified),
        claim_violations=violations,
        elapsed_ms=round(timer.ms, 1),
    )

    return Explanation(
        text=text,
        model=provider.model if source == "llm" else "none",
        source=source,
        provider=provider.name if source == "llm" else status.provider,
        audit=audit.as_dict(),
        claim_violations=violations,
        elapsed_ms=timer.ms,
        error=error,
    )

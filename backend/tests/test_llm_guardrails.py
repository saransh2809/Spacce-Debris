"""
LLM guardrails.

These tests defend the central architectural claim: the LLM cannot become the
numerical authority. The audit must catch an invented number, and the claim
scanner must catch language the data does not support.

Note what is NOT tested here: the quality of the generated prose. That is not
a correctness property. Whether a number in it can be traced to the pipeline
absolutely is.
"""
from __future__ import annotations

import pytest

from app.llm.guardrails import (
    audit_numbers,
    check_claims,
    collect_numbers,
)


SUPPLIED = {
    "object_1": {"name": "CARTOSAT-2F", "norad_id": 43111},
    "object_2": {"name": "COSMOS 2251 DEB", "norad_id": 34215},
    "miss_distance_km": 3.376,
    "relative_velocity_km_s": 10.802,
    "risk_score": 65.63,
    "risk_category": "HIGH",
    "hours_to_tca": 4.78,
    "miss_over_sigma": 0.919,
    "tca_utc": "2026-08-25T00:19:46Z",
}


class TestNumberCollection:
    def test_collects_from_nested_structures(self):
        found = collect_numbers(SUPPLIED)
        assert 3.376 in found
        assert 65.63 in found
        assert 43111 in found

    def test_collects_from_timestamps(self):
        """A model may legitimately quote the date and time it was given."""
        found = collect_numbers({"tca": "2026-08-25T00:19:46Z"})
        assert 2026 in found
        assert 25 in found

    def test_booleans_are_not_numbers(self):
        assert collect_numbers({"flag": True}) == set()


class TestNumericAudit:
    def test_faithful_explanation_passes(self):
        text = (
            "The two objects reach a minimum separation of 3.376 km at a relative "
            "velocity of 10.802 km/s. The screening score is 65.63, placing this "
            "encounter in the HIGH category."
        )
        result = audit_numbers(text, SUPPLIED)
        assert result.passed
        assert not result.unverified

    def test_rounding_is_accepted(self):
        """Rounding is presentation, not invention."""
        text = "Minimum separation is about 3.4 km with a closing speed near 10.8 km/s."
        assert audit_numbers(text, SUPPLIED).passed

    def test_unit_conversion_is_accepted(self):
        text = "The objects pass within 3376 metres of one another."
        assert audit_numbers(text, SUPPLIED).passed

    def test_invented_number_is_caught(self):
        """The test this whole module exists for."""
        text = (
            "The two objects approach within 3.376 km. The probability of impact "
            "is 0.00047231 based on my analysis."
        )
        result = audit_numbers(text, SUPPLIED)
        assert not result.passed
        assert 0.00047231 in result.unverified
        assert result.notes

    def test_fabricated_altitude_is_caught(self):
        text = "CARTOSAT-2F is orbiting at an altitude of 609.8 km."
        result = audit_numbers(text, SUPPLIED)
        assert not result.passed
        assert 609.8 in result.unverified

    def test_small_counting_numbers_are_allowed(self):
        text = "The two objects involved are both in low Earth orbit; all 12 checks passed."
        assert audit_numbers(text, SUPPLIED).passed

    def test_audit_counts_are_reported(self):
        text = "Separation 3.376 km, velocity 10.802 km/s, and an invented 88888.5."
        result = audit_numbers(text, SUPPLIED)
        assert result.numbers_found >= 3
        assert result.numbers_verified < result.numbers_found

    def test_empty_text_passes_trivially(self):
        result = audit_numbers("", SUPPLIED)
        assert result.passed
        assert result.numbers_found == 0

    def test_audit_serialises_for_the_api(self):
        payload = audit_numbers("Separation is 3.376 km.", SUPPLIED).as_dict()
        assert set(payload) >= {
            "passed",
            "numbers_found",
            "numbers_verified",
            "unverified_values",
            "method",
        }


class TestClaimScanner:
    def test_flags_probability_of_collision_when_covariance_assumed(self):
        text = "The probability of collision is 1.5e-06."
        violations = check_claims(text, is_operational_pc=False)
        assert violations
        assert any("probability of collision" in v for v in violations)

    def test_allows_probability_language_when_covariance_published(self):
        text = "The probability of collision is 1.5e-06."
        assert check_claims(text, is_operational_pc=True) == []

    def test_flags_assertion_that_objects_will_collide(self):
        text = "These two objects will collide in four hours."
        violations = check_claims(text, is_operational_pc=False)
        assert any("certain" in v for v in violations)

    def test_flags_model_claiming_to_have_calculated(self):
        """
        The model must never imply it performed the astrodynamics. That claim
        would misrepresent the entire architecture.
        """
        text = "I calculated the time of closest approach using SGP4."
        violations = check_claims(text, is_operational_pc=False)
        assert any("performed the calculation" in v for v in violations)

    def test_correct_language_is_not_flagged(self):
        text = (
            "This is a predicted close approach, not a predicted collision. The "
            "conditional encounter probability follows from an assumed covariance "
            "model and is not an operational figure."
        )
        assert check_claims(text, is_operational_pc=False) == []


class TestDeterministicFallback:
    """
    With no API key the explainer must still produce a correct, auditable
    explanation built directly from the numbers.
    """

    @pytest.mark.asyncio
    async def test_template_explanation_passes_its_own_audit(self):
        from app.core.config import settings
        from app.llm.explainer import explain_conjunction

        original = settings.anthropic_api_key
        settings.anthropic_api_key = ""
        try:
            detail = {
                "object_a": {
                    "name": "CARTOSAT-2F",
                    "norad_id": 43111,
                    "object_type": "ACTIVE_SATELLITE",
                    "country": "India",
                    "attribution_available": True,
                },
                "object_b": {
                    "name": "COSMOS 2251 DEB",
                    "norad_id": 34215,
                    "object_type": "DEBRIS",
                    "country": "Russia",
                    "attribution_available": True,
                },
                "tca": "2026-08-25T00:19:46Z",
                "hours_to_tca": 4.78,
                "miss_distance_km": 3.376,
                "relative_speed_km_s": 10.802,
                "radial_separation_km": 1.2,
                "rank": 1,
                "risk_category": "HIGH",
                "risk_score": 65.63,
                "risk": {
                    "formula": "score = 100 * sum(weight_i * normalised_i)",
                    "components": [
                        {
                            "name": "miss_distance",
                            "raw_value": 3.376,
                            "units": "km",
                            "normalised": 0.55,
                            "weight": 0.4,
                            "points_contributed": 22.0,
                            "explanation": "x",
                        }
                    ],
                    "category_boundaries": {"HIGH": 55.0},
                },
                "uncertainty": {
                    "source": "ASSUMED_MODEL",
                    "is_operational_pc": False,
                    "probability_label": "Conditional encounter probability",
                    "conditional_encounter_probability": 1.5e-06,
                    "miss_over_sigma": 0.919,
                    "mahalanobis_distance": 2.136,
                    "combined_2d": {"sigma_major_km": 3.6, "sigma_minor_km": 0.4},
                    "hard_body_radius_m": 10.0,
                    "hard_body_radius_source": "assumed default (both objects)",
                    "caveats": [],
                },
                "validation": {"status": "WARNING", "summary": "ok"},
                "bplane": {"encounter_angle_deg": 90.22, "linear_assumption_valid": True},
                "closest_approach": {
                    "state_a": {
                        "propagation_model": "SGP4",
                        "propagated_days_from_epoch": 0.4,
                    },
                    "state_b": {
                        "propagation_model": "SGP4",
                        "propagated_days_from_epoch": 1.1,
                    },
                },
            }

            result = await explain_conjunction(detail)

            assert result.source == "deterministic-template"
            assert result.audit["passed"] is True, result.audit["unverified_values"]
            assert result.claim_violations == []
            # It must state the assumption rather than bury it.
            assert "NOT an operational" in result.text or "not an operational" in result.text
        finally:
            settings.anthropic_api_key = original

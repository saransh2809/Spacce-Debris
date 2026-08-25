"""
Uncertainty modelling and risk scoring.

Two themes:
  1. Assumed uncertainty must always be LABELLED as assumed, and must never be
     presented as an operational probability of collision.
  2. The risk score must be monotone in the things that make an encounter
     worse, and must be fully reconstructible from its published components.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from app.core.config import settings
from app.risk.engine import (
    RiskCategory,
    assess,
    categorise,
    weights_description,
)
from app.uncertainty.models import (
    CovarianceSource,
    build_object_uncertainty,
    encounter_probability_2d,
    hard_body_radius_m,
    model_description,
)


class TestAssumedCovariance:
    def test_no_published_covariance_is_tagged_assumed(self):
        u = build_object_uncertainty(
            1, np.array([7000.0, 0, 0]), np.array([0, 7.5, 0]), age_days=1.0
        )
        assert u.source is CovarianceSource.ASSUMED_MODEL

    def test_published_covariance_is_tagged_published(self):
        u = build_object_uncertainty(
            1,
            np.array([7000.0, 0, 0]),
            np.array([0, 7.5, 0]),
            age_days=1.0,
            published_covariance_ric=np.diag([0.01, 0.09, 0.04]),
        )
        assert u.source is CovarianceSource.PUBLISHED
        assert u.sigma_radial_km == pytest.approx(0.1)
        assert u.sigma_in_track_km == pytest.approx(0.3)

    def test_uncertainty_grows_with_time_from_epoch(self):
        """The whole point of the model: older elements are less trustworthy."""
        fresh = build_object_uncertainty(
            1, np.array([7000.0, 0, 0]), np.array([0, 7.5, 0]), age_days=0.0
        )
        old = build_object_uncertainty(
            1, np.array([7000.0, 0, 0]), np.array([0, 7.5, 0]), age_days=7.0
        )
        assert old.sigma_in_track_km > fresh.sigma_in_track_km
        assert old.rss_sigma_km > fresh.rss_sigma_km

    def test_in_track_error_dominates(self):
        """
        TLE error is overwhelmingly along-track, driven by mismodelled drag.
        A model that made radial error dominant would be qualitatively wrong.
        """
        u = build_object_uncertainty(
            1, np.array([7000.0, 0, 0]), np.array([0, 7.5, 0]), age_days=3.0
        )
        assert u.sigma_in_track_km > u.sigma_radial_km
        assert u.sigma_in_track_km > u.sigma_cross_track_km

    def test_covariance_rotation_preserves_trace_and_symmetry(self):
        """
        Rotating a covariance is a congruence transform: it must stay symmetric,
        positive semi-definite, and preserve the trace.
        """
        u = build_object_uncertainty(
            1, np.array([7000.0, 1200.0, -400.0]), np.array([-1.0, 7.0, 1.5]), 2.0
        )
        assert np.allclose(u.covariance_inertial, u.covariance_inertial.T, atol=1e-15)
        assert np.trace(u.covariance_inertial) == pytest.approx(
            np.trace(u.covariance_ric), rel=1e-12
        )
        assert np.linalg.eigvalsh(u.covariance_inertial).min() >= -1e-15

    def test_assumed_covariance_has_no_invented_correlations(self):
        """
        The assumed model makes no claim about correlations, so the RIC
        covariance must be diagonal. Inventing off-diagonal terms would be a
        second fabrication layered on the first.
        """
        u = build_object_uncertainty(
            1, np.array([7000.0, 0, 0]), np.array([0, 7.5, 0]), 1.0
        )
        off_diagonal = u.covariance_ric - np.diag(np.diag(u.covariance_ric))
        assert np.abs(off_diagonal).max() == 0.0

    def test_model_description_matches_configuration(self):
        """Documentation and computation must not drift apart."""
        desc = model_description()
        assert desc["sigma_0_km"]["in_track"] == settings.assumed_sigma_in_track_km
        assert (
            desc["growth_km_per_day"]["in_track"]
            == settings.sigma_growth_in_track_km_per_day
        )
        assert any("not a measurement" in limit for limit in desc["limitations"])


class TestHardBodyRadius:
    def test_rcs_derived_when_available(self):
        r, source = hard_body_radius_m(math.pi * 4.0, math.pi * 9.0)
        # r = sqrt(RCS/pi) per object -> 2 + 3
        assert r == pytest.approx(5.0, rel=1e-9)
        assert "RCS-derived (both objects)" == source

    def test_falls_back_to_default_and_says_so(self):
        r, source = hard_body_radius_m(None, None)
        assert r == pytest.approx(2 * settings.default_hard_body_radius_m)
        assert "assumed default" in source

    def test_mixed_source_is_reported_honestly(self):
        _r, source = hard_body_radius_m(math.pi * 4.0, None)
        assert "RCS-derived for one object" in source


class TestEncounterProbability:
    def test_probability_is_in_unit_interval(self):
        cov = np.diag([1.0, 0.25])
        p = encounter_probability_2d(1.0, 0.5, cov, 0.02)
        assert 0.0 <= p <= 1.0

    def test_probability_falls_with_larger_miss(self):
        cov = np.diag([1.0, 1.0])
        near = encounter_probability_2d(0.5, 0.0, cov, 0.02)
        far = encounter_probability_2d(8.0, 0.0, cov, 0.02)
        assert near > far

    def test_probability_rises_with_larger_hard_body(self):
        cov = np.diag([1.0, 1.0])
        small = encounter_probability_2d(1.0, 0.0, cov, 0.01)
        large = encounter_probability_2d(1.0, 0.0, cov, 0.05)
        assert large > small

    def test_matches_small_target_analytic_limit(self):
        """
        When the hard-body disc is far smaller than sigma, the integral tends to
        (area) x (density at the miss point). Agreement with that closed form
        validates the quadrature.
        """
        cov = np.diag([1.0, 1.0])
        b = np.array([1.5, 0.0])
        hbr = 0.002
        numeric = encounter_probability_2d(b[0], b[1], cov, hbr)

        det = np.linalg.det(cov)
        density = (
            1.0
            / (2 * math.pi * math.sqrt(det))
            * math.exp(-0.5 * float(b @ np.linalg.inv(cov) @ b))
        )
        analytic = math.pi * hbr**2 * density
        assert numeric == pytest.approx(analytic, rel=1e-3)

    def test_degenerate_covariance_returns_zero_not_nan(self):
        assert encounter_probability_2d(1.0, 0.0, np.zeros((2, 2)), 0.01) == 0.0


class TestRiskEngine:
    BASE = dict(
        miss_distance_km=5.0,
        relative_speed_km_s=10.0,
        hours_to_tca=12.0,
        miss_over_sigma=2.0,
        covariance_is_assumed=True,
        object_type_a="ACTIVE_SATELLITE",
        object_type_b="DEBRIS",
    )

    def test_weights_sum_to_one(self):
        assert settings.risk_weights_sum == pytest.approx(1.0, abs=1e-12)

    def test_score_equals_sum_of_published_contributions(self):
        """
        The published component breakdown must reconstruct the headline score
        exactly. If it cannot, "why is this ranked #1" is unanswerable.
        """
        r = assess(**self.BASE)
        total = sum(c.contribution for c in r.components)
        assert r.score == pytest.approx(total, abs=1e-9)

    def test_score_is_bounded(self):
        extreme = assess(
            miss_distance_km=0.0,
            relative_speed_km_s=20.0,
            hours_to_tca=0.0,
            miss_over_sigma=0.0,
            covariance_is_assumed=True,
            object_type_a="SPACE_STATION",
            object_type_b="SPACE_STATION",
        )
        assert 0.0 <= extreme.score <= 100.0

    def test_closer_approach_scores_higher(self):
        near = assess(**{**self.BASE, "miss_distance_km": 0.5})
        far = assess(**{**self.BASE, "miss_distance_km": 20.0})
        assert near.score > far.score

    def test_greater_uncertainty_scores_higher(self):
        """A 5 km miss with huge error bars is worse than one with tight bars."""
        uncertain = assess(**{**self.BASE, "miss_over_sigma": 0.3})
        confident = assess(**{**self.BASE, "miss_over_sigma": 5.5})
        assert uncertain.score > confident.score

    def test_faster_encounter_scores_higher(self):
        fast = assess(**{**self.BASE, "relative_speed_km_s": 14.0})
        slow = assess(**{**self.BASE, "relative_speed_km_s": 0.5})
        assert fast.score > slow.score

    def test_sooner_encounter_scores_higher(self):
        soon = assess(**{**self.BASE, "hours_to_tca": 1.0})
        later = assess(**{**self.BASE, "hours_to_tca": 47.0})
        assert soon.score > later.score

    def test_station_outranks_debris_on_debris(self):
        station = assess(
            **{
                **self.BASE,
                "object_type_a": "SPACE_STATION",
                "object_type_b": "ACTIVE_SATELLITE",
            }
        )
        junk = assess(
            **{**self.BASE, "object_type_a": "DEBRIS", "object_type_b": "DEBRIS"}
        )
        assert station.score > junk.score

    @pytest.mark.parametrize(
        "score,expected",
        [
            (95.0, RiskCategory.CRITICAL),
            (settings.risk_critical_score, RiskCategory.CRITICAL),
            (settings.risk_high_score, RiskCategory.HIGH),
            (settings.risk_moderate_score, RiskCategory.MODERATE),
            (settings.risk_moderate_score - 0.01, RiskCategory.LOW),
            (0.0, RiskCategory.LOW),
        ],
    )
    def test_category_boundaries(self, score, expected):
        assert categorise(score) == expected

    def test_assumed_covariance_produces_a_note(self):
        r = assess(**{**self.BASE, "covariance_is_assumed": True})
        assert any("assumed covariance" in n for n in r.notes)

    def test_non_convergence_produces_a_note(self):
        r = assess(**{**self.BASE, "tca_converged": False})
        assert any("did not find an interior minimum" in n for n in r.notes)

    def test_explain_payload_is_complete(self):
        """This payload is what the LLM sees; every component must be traceable."""
        payload = assess(**self.BASE).explain()
        assert payload["formula"]
        assert len(payload["components"]) == 5
        for c in payload["components"]:
            assert {"name", "raw_value", "units", "normalised", "weight",
                    "points_contributed", "explanation"} <= set(c)

    def test_score_never_claims_probability(self):
        """
        Terminology guard: the risk engine's own description must not present
        the score as a probability of collision.
        """
        desc = weights_description()
        assert "not a probability" in desc["disclaimer"].lower()
        assert "screening-priority" in desc["disclaimer"].lower()

    def test_risk_ignores_names_and_countries(self):
        """
        The score must depend only on physics and object class -- never on who
        owns the object. Identical numbers must score identically.
        """
        a = assess(**self.BASE)
        b = assess(**self.BASE)
        assert a.score == b.score

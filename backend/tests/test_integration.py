"""
Integration and regression tests.

Covers the full chain the problem statement specifies:

    TLE -> SGP4 -> conjunction engine -> validation -> risk -> serialised result

plus the validation engine's own behaviour. These run entirely on fixed element
sets, so a failure means the pipeline changed, not that the sky did.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from app.conjunction.bplane import build_bplane
from app.conjunction.encounter import build_event, make_event_id
from app.conjunction.tca import refine
from app.core.frames import Frame
from app.propagation.simulation_clock import ClockError, SimulationClock
from app.risk.engine import RiskCategory
from app.uncertainty.models import CovarianceSource
from app.validation.engine import (
    ValidationStatus,
    validate_conjunction,
    validate_state,
)
from tests.conftest import FakeCatalogObject, _meta
from tests.test_conjunction import _shifted_copy


@pytest.fixture
def pipeline_event(iss):
    """One conjunction driven all the way through the real pipeline."""
    primary = FakeCatalogObject(iss, _meta(25544, "PRIMARY"))
    secondary = FakeCatalogObject(
        _shifted_copy(iss, norad=90100, raan_delta=0.35), _meta(90100, "SECONDARY")
    )
    start = iss.epoch
    ca = refine(primary, secondary, start, start + timedelta(minutes=60))
    assert ca is not None
    return build_event(primary, secondary, ca, start, start + timedelta(hours=1), start)


class TestStateValidation:
    def test_good_state_passes(self):
        checks = validate_state(
            np.array([7000.0, 0.0, 0.0]), np.array([0.0, 7.5, 0.0]), Frame.TEME, "a"
        )
        assert all(c.passed for c in checks)

    def test_sub_surface_position_rejected(self):
        checks = validate_state(
            np.array([100.0, 0.0, 0.0]), np.array([0.0, 7.5, 0.0]), Frame.TEME, "a"
        )
        bad = [c for c in checks if not c.passed]
        assert any("altitude" in c.name for c in bad)
        assert all(c.status is ValidationStatus.INVALID for c in bad)

    def test_impossible_speed_rejected(self):
        checks = validate_state(
            np.array([7000.0, 0.0, 0.0]), np.array([0.0, 90.0, 0.0]), Frame.TEME, "a"
        )
        assert any("speed" in c.name and not c.passed for c in checks)

    def test_nan_state_rejected(self):
        checks = validate_state(
            np.array([np.nan, 0.0, 0.0]), np.array([0.0, 7.5, 0.0]), Frame.TEME, "a"
        )
        assert not checks[0].passed
        assert checks[0].status is ValidationStatus.INVALID

    def test_wrong_frame_rejected(self):
        """
        Conjunction geometry is only valid in TEME. A state arriving in an
        Earth-fixed frame must be refused rather than quietly mixed in.
        """
        checks = validate_state(
            np.array([7000.0, 0.0, 0.0]), np.array([0.0, 7.5, 0.0]), Frame.ITRF, "a"
        )
        assert any("frame" in c.name and not c.passed for c in checks)


class TestConjunctionValidation:
    def test_valid_conjunction_has_no_invalid_checks(self, pipeline_event):
        failures = [
            c
            for c in pipeline_event.validation.checks
            if not c.passed and c.status is ValidationStatus.INVALID
        ]
        assert failures == []

    def test_status_is_warning_because_covariance_is_assumed(self, pipeline_event):
        """
        With public GP data there is no published covariance, so a correct
        result is WARNING, not VALIDATED. A system reporting VALIDATED here
        would be hiding its most important assumption.
        """
        assert pipeline_event.validation.status is ValidationStatus.WARNING
        assert pipeline_event.validation.is_displayable

        covariance_check = next(
            c for c in pipeline_event.validation.checks if c.name == "covariance_published"
        )
        assert covariance_check.passed is False
        assert covariance_check.status is ValidationStatus.WARNING

    def test_miss_distance_is_independently_reproducible(self, pipeline_event):
        check = next(
            c
            for c in pipeline_event.validation.checks
            if c.name == "miss_distance_reproducible"
        )
        assert check.passed
        assert check.measured < 1e-6

    def test_bplane_basis_orthonormality_is_checked(self, pipeline_event):
        check = next(
            c for c in pipeline_event.validation.checks if c.name == "bplane_basis_orthonormal"
        )
        assert check.passed
        assert check.measured < 1e-9

    def test_tca_stationarity_is_checked(self, pipeline_event):
        check = next(
            c
            for c in pipeline_event.validation.checks
            if c.name == "tca_is_stationary_point"
        )
        assert check.passed

    def test_stale_elements_are_rejected(self, iss):
        """
        An element set older than the hard limit must make the result INVALID,
        not merely noted. Propagating a month-old TLE and presenting the answer
        as usable is precisely the failure mode this project refuses.
        """
        primary = FakeCatalogObject(iss, _meta(25544, "PRIMARY"))
        secondary = FakeCatalogObject(
            _shifted_copy(iss, norad=90101, raan_delta=0.35), _meta(90101, "SECONDARY")
        )
        start = iss.epoch
        ca = refine(primary, secondary, start, start + timedelta(minutes=60))
        assert ca is not None

        bp = build_bplane(ca)
        from app.uncertainty.models import (
            build_encounter_uncertainty,
            build_object_uncertainty,
        )

        ua = build_object_uncertainty(1, ca.state_a.position_km, ca.state_a.velocity_km_s, 40.0)
        ub = build_object_uncertainty(2, ca.state_b.position_km, ca.state_b.velocity_km_s, 40.0)
        unc = build_encounter_uncertainty(ua, ub, bp, bp.b_xi_km, bp.b_zeta_km, None, None)

        result = validate_conjunction(
            closest_approach=ca,
            bplane=bp,
            uncertainty=unc,
            element_age_a_days=40.0,     # far beyond the 14-day limit
            element_age_b_days=40.0,
            metadata_a_available=True,
            metadata_b_available=True,
            screen_start=start,
            screen_end=start + timedelta(hours=1),
        )
        assert result.status is ValidationStatus.INVALID
        assert result.is_displayable is False

    def test_identical_objects_rejected(self, iss):
        """An object cannot be in conjunction with itself."""
        obj = FakeCatalogObject(iss, _meta(25544, "SELF"))
        start = iss.epoch
        ca = refine(obj, obj, start, start + timedelta(minutes=30))
        if ca is None:
            pytest.skip("degenerate self-pair produced no solution")
        bp = build_bplane(ca)
        from app.uncertainty.models import (
            build_encounter_uncertainty,
            build_object_uncertainty,
        )

        ua = build_object_uncertainty(1, ca.state_a.position_km, ca.state_a.velocity_km_s, 1.0)
        unc = build_encounter_uncertainty(ua, ua, bp, bp.b_xi_km, bp.b_zeta_km, None, None)
        result = validate_conjunction(
            closest_approach=ca,
            bplane=bp,
            uncertainty=unc,
            element_age_a_days=1.0,
            element_age_b_days=1.0,
            metadata_a_available=True,
            metadata_b_available=True,
            screen_start=start,
            screen_end=start + timedelta(hours=1),
        )
        distinct = next(c for c in result.checks if c.name == "distinct_objects")
        assert distinct.passed is False


class TestFullPipeline:
    def test_event_carries_complete_provenance(self, pipeline_event):
        """
        Spec requirement: every displayed conjunction must be traceable from
        element sets through to the risk ranking.
        """
        e = pipeline_event
        assert e.event_id
        assert e.object_a.element_set.epoch
        assert e.object_b.element_set.epoch
        assert e.closest_approach.state_a.frame is Frame.TEME
        assert e.closest_approach.state_a.epoch == e.object_a.element_set.epoch
        assert e.bplane.frame is Frame.TEME
        assert e.uncertainty.source is CovarianceSource.ASSUMED_MODEL
        assert e.validation.checks
        assert e.risk.components
        assert isinstance(e.risk.category, RiskCategory)

    def test_risk_score_reconstructs_from_components(self, pipeline_event):
        total = sum(c.contribution for c in pipeline_event.risk.components)
        assert pipeline_event.risk.score == pytest.approx(total, abs=1e-9)

    def test_event_id_changes_when_elements_change(self):
        """
        Element-set epochs are part of the identifier, so refreshed data yields
        a NEW event rather than silently changing an existing one's numbers.
        """
        tca = datetime(2026, 8, 25, tzinfo=timezone.utc)
        epoch_a = datetime(2026, 8, 24, tzinfo=timezone.utc)
        epoch_b = datetime(2026, 8, 23, tzinfo=timezone.utc)

        first = make_event_id(1, 2, tca, epoch_a, epoch_b)
        same = make_event_id(1, 2, tca, epoch_a, epoch_b)
        refreshed = make_event_id(1, 2, tca, epoch_a + timedelta(hours=6), epoch_b)

        assert first == same
        assert first != refreshed

    def test_event_id_is_order_independent(self):
        tca = datetime(2026, 8, 25, tzinfo=timezone.utc)
        epoch = datetime(2026, 8, 24, tzinfo=timezone.utc)
        assert make_event_id(1, 2, tca, epoch, epoch) == make_event_id(
            2, 1, tca, epoch, epoch
        )

    def test_serialised_event_is_json_safe(self, pipeline_event):
        """
        NaN and infinity are not valid JSON. The serialiser must emit null so a
        client gets a missing value rather than a parse error that looks like a
        network fault.
        """
        from app.schemas.serializers import serialize_event

        payload = serialize_event(
            pipeline_event, pipeline_event.computed_at, detail=True
        )
        text = json.dumps(payload)
        assert "NaN" not in text
        assert "Infinity" not in text

        reloaded = json.loads(text)
        assert reloaded["miss_distance_km"] == pytest.approx(
            pipeline_event.miss_distance_km, rel=1e-12
        )
        assert reloaded["closest_approach"]["state_a"]["frame"] == "TEME"

    def test_serialised_event_labels_assumed_covariance(self, pipeline_event):
        from app.schemas.serializers import serialize_event

        payload = serialize_event(
            pipeline_event, pipeline_event.computed_at, detail=True
        )
        unc = payload["uncertainty"]
        assert unc["source"] == "ASSUMED_MODEL"
        assert unc["is_operational_pc"] is False
        assert "assumed covariance model" in unc["probability_label"].lower()
        assert unc["caveats"]

    def test_serialised_state_exposes_both_frames_distinctly(self, pipeline_event):
        from app.schemas.serializers import serialize_state

        payload = serialize_state(pipeline_event.closest_approach.state_a)
        assert payload["frame"] == "TEME"
        assert "ITRF" in payload["earth_fixed"]["frame"]
        # The two position vectors must genuinely differ -- same numbers would
        # mean the Earth rotation was never applied.
        assert payload["position_km"] != payload["earth_fixed"]["position_km"]


class TestSimulationClock:
    def test_starts_in_real_time(self):
        clock = SimulationClock()
        assert str(clock.state().mode) == "REAL_TIME"
        assert abs(clock.offset_seconds()) < 1.0

    def test_offset_moves_simulation_time(self):
        clock = SimulationClock()
        clock.offset(3600.0)
        assert clock.offset_seconds() == pytest.approx(3600.0, abs=2.0)
        assert str(clock.state().mode) == "SIMULATION"

    def test_pause_freezes_time(self):
        import time

        clock = SimulationClock()
        clock.set_rate(100.0)
        clock.pause()
        first = clock.now()
        time.sleep(0.05)
        assert clock.now() == first

    def test_return_to_real_time(self):
        clock = SimulationClock()
        clock.offset(7200.0)
        clock.set_real_time()
        assert abs(clock.offset_seconds()) < 1.0

    def test_refuses_absurd_time(self):
        """
        SGP4 is a short-arc theory. Propagating a year out would produce a
        confident-looking plot of nothing, so the clock refuses.
        """
        clock = SimulationClock()
        with pytest.raises(ClockError):
            clock.set_simulation_time(datetime.now(timezone.utc) + timedelta(days=400))

    def test_resolve_prefers_explicit_time(self):
        clock = SimulationClock()
        target = datetime.now(timezone.utc) + timedelta(hours=3)
        assert clock.resolve(target) == target

    def test_resolve_falls_back_to_clock(self):
        clock = SimulationClock()
        clock.offset(600.0)
        resolved = clock.resolve(None)
        assert abs((resolved - clock.now()).total_seconds()) < 1.0

    def test_gmst_and_sun_track_simulation_time(self):
        """
        Earth rotation and lighting must follow the simulation clock, not the
        wall clock -- otherwise the terminator would disagree with the
        satellite positions.
        """
        clock = SimulationClock()
        before = clock.state()
        clock.offset(6 * 3600.0)
        after = clock.state()

        gmst_delta = (after.gmst_rad - before.gmst_rad) % (2 * math.pi)
        # Six hours is a quarter turn, plus a little for the sidereal rate.
        assert gmst_delta == pytest.approx(math.pi / 2, abs=0.02)
        assert after.sun_direction_teme != before.sun_direction_teme

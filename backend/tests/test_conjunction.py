"""
Conjunction engine: screening, TCA refinement and B-plane geometry.

The central claim these tests defend is that TCA is SOLVED, not sampled. The
brute-force comparison below is the proof: a 0.01 s exhaustive search must not
find a closer approach than Brent's method did.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from app.conjunction.bplane import build_bplane
from app.conjunction.screening import (
    MAX_RELATIVE_SPEED_KM_S,
    apogee_perigee_filter,
    required_gate_km,
    screen,
)
from app.conjunction.tca import refine, separation_profile
from app.data.tle_processor import parse_tle
from app.propagation.sgp4_engine import propagate_many
from tests.conftest import FakeCatalogObject, _meta


def _shifted_copy(element_set, *, norad: int, raan_delta: float = 0.0,
                  anomaly_delta: float = 0.0, name: str = "SHADOW"):
    """
    Build a second object from an existing element set with the RAAN and/or
    mean anomaly nudged. This manufactures a controlled encounter without
    depending on whatever the live catalogue happens to contain today.
    """
    l2 = element_set.line2
    raan = (element_set.raan_deg + raan_delta) % 360.0
    anomaly = (element_set.mean_anomaly_deg + anomaly_delta) % 360.0
    new_l2 = (
        l2[:17]
        + f"{raan:8.4f}"
        + l2[25:43]
        + f"{anomaly:8.4f}"
        + l2[51:]
    )
    new_l1 = element_set.line1[:2] + f"{norad:05d}" + element_set.line1[7:]
    new_l2 = new_l2[:2] + f"{norad:05d}" + new_l2[7:]
    return parse_tle(new_l1, new_l2, name=name, verify_checksum=False)


class TestGateSafety:
    """
    The coarse sieve can only be trusted if its gate is wide enough that no
    encounter can hide between two samples.
    """

    def test_required_gate_formula(self):
        assert required_gate_km(60.0, 25.0) == pytest.approx(
            25.0 + MAX_RELATIVE_SPEED_KM_S * 30.0
        )

    def test_gate_grows_with_step(self):
        assert required_gate_km(120.0, 25.0) > required_gate_km(60.0, 25.0)

    def test_screener_refuses_unsafe_gate(self, iss_object, sso_object):
        """
        Rather than silently missing conjunctions, the screener must refuse to
        run when the configured gate is too small for the step size.
        """
        start = datetime(2026, 8, 24, tzinfo=timezone.utc)
        candidates, _combined, report = screen(
            [iss_object],
            [sso_object],
            start,
            start + timedelta(hours=1),
            step_s=60.0,
            gate_km=10.0,          # far below the required ~505 km
            threshold_km=25.0,
        )
        assert candidates == []
        assert report.gate_is_safe is False
        assert any("missed" in note for note in report.notes)


class TestApogeePerigeeFilter:
    def test_non_overlapping_shells_are_excluded(self, iss, sso):
        """A LEO object and a GEO object can never conjoin."""
        geo_l1 = "1 40000U 14001A   26236.50000000  .00000000  00000-0  00000-0 0  9994"
        geo_l2 = "2 40000   0.0200  95.0000 0002000 180.0000 180.0000  1.00270000000013"
        geo = parse_tle(geo_l1, geo_l2, name="GEO-TEST", verify_checksum=False)

        leo_obj = FakeCatalogObject(iss, _meta(25544, "ISS"))
        geo_obj = FakeCatalogObject(geo, _meta(40000, "GEO"))

        assert apogee_perigee_filter([leo_obj], [geo_obj]) == []

    def test_widely_separated_leo_shells_are_excluded(self, iss_object, sso_object):
        """
        The ISS sits near 420 km and the sun-synchronous fixture near 800 km.
        Even though both are LEO, their shells do not overlap and the pair must
        be discarded before any propagation happens.
        """
        assert apogee_perigee_filter([iss_object], [sso_object]) == []

    def test_overlapping_shells_are_kept(self, iss):
        """Two objects on the same orbit obviously share a shell."""
        primary = FakeCatalogObject(iss, _meta(25544, "PRIMARY"))
        twin = FakeCatalogObject(
            _shifted_copy(iss, norad=90010, anomaly_delta=30.0), _meta(90010, "TWIN")
        )
        assert apogee_perigee_filter([primary], [twin]) == [(0, 0)]

    def test_filter_is_symmetric(self, iss):
        primary = FakeCatalogObject(iss, _meta(25544, "PRIMARY"))
        twin = FakeCatalogObject(
            _shifted_copy(iss, norad=90011, anomaly_delta=45.0), _meta(90011, "TWIN")
        )
        forward = apogee_perigee_filter([primary], [twin])
        backward = apogee_perigee_filter([twin], [primary])
        assert bool(forward) == bool(backward) is True

    def test_pad_widens_the_acceptance_band(self, iss_object, sso_object):
        """
        A large enough pad must bring otherwise-separated shells back into
        consideration, which proves the pad is actually applied.
        """
        assert apogee_perigee_filter([iss_object], [sso_object], pad_km=0.0) == []
        assert apogee_perigee_filter([iss_object], [sso_object], pad_km=600.0) != []


class TestTCARefinement:
    """The core correctness claim of the conjunction engine."""

    @pytest.fixture
    def encounter_pair(self, iss):
        """Two objects on nearly the same orbit, offset slightly in phase."""
        primary = FakeCatalogObject(iss, _meta(25544, "PRIMARY"))
        shadow_es = _shifted_copy(iss, norad=90001, anomaly_delta=0.05)
        secondary = FakeCatalogObject(shadow_es, _meta(90001, "SECONDARY"))
        return primary, secondary

    def test_range_rate_is_zero_at_tca(self, encounter_pair):
        """
        At a true closest approach, r_rel . v_rel = 0 by definition. This is
        the property the solver targets, so it is the property to verify.
        """
        a, b = encounter_pair
        start = a.element_set.epoch
        result = refine(a, b, start, start + timedelta(minutes=50))
        assert result is not None
        # Normalised so the tolerance is meaningful regardless of scale.
        scale = result.miss_distance_km * result.relative_speed_km_s
        assert abs(result.range_rate_residual_km2_s) < max(1e-6, scale * 1e-6)

    def test_brent_beats_brute_force_sampling(self, encounter_pair):
        """
        An exhaustive 0.01 s search must not find a closer approach than the
        root-finder did. If it does, the solver is not converging and the
        reported miss distance is wrong.
        """
        a, b = encounter_pair
        start = a.element_set.epoch
        result = refine(a, b, start, start + timedelta(minutes=50))
        assert result is not None

        # Brute force a +/- 5 s window around the reported TCA at 0.01 s.
        offsets = np.arange(-5.0, 5.0, 0.01)
        times = [result.tca + timedelta(seconds=float(s)) for s in offsets]
        pos, _vel, err = propagate_many(
            [a.element_set, b.element_set], times, [a.satrec, b.satrec]
        )
        ok = (err[0] == 0) & (err[1] == 0)
        seps = np.linalg.norm(pos[0] - pos[1], axis=1)
        brute_min = float(np.min(np.where(ok, seps, np.inf)))

        # Allow a nanometre of floating-point slack.
        assert result.miss_distance_km <= brute_min + 1e-9

    def test_tca_is_not_snapped_to_a_sample_boundary(self, encounter_pair):
        """
        A solver that merely picked the best grid sample would land on a
        multiple of the sampling step. A real root lands anywhere.
        """
        a, b = encounter_pair
        start = a.element_set.epoch
        result = refine(a, b, start, start + timedelta(minutes=50), fine_step_s=2.0)
        assert result is not None
        offset_s = (result.tca - start).total_seconds()
        # The odds of a genuine root landing within 1 ms of a 2 s grid point
        # are negligible.
        assert abs(offset_s % 2.0) > 1e-3

    def test_reported_miss_matches_state_vectors(self, encounter_pair):
        """The scalar must be reproducible from the vectors that accompany it."""
        a, b = encounter_pair
        start = a.element_set.epoch
        result = refine(a, b, start, start + timedelta(minutes=50))
        assert result is not None
        recomputed = float(
            np.linalg.norm(result.state_a.position_km - result.state_b.position_km)
        )
        assert recomputed == pytest.approx(result.miss_distance_km, abs=1e-9)

    def test_both_states_share_the_same_instant(self, encounter_pair):
        a, b = encounter_pair
        start = a.element_set.epoch
        result = refine(a, b, start, start + timedelta(minutes=50))
        assert result is not None
        assert result.state_a.time == result.state_b.time == result.tca

    def test_monotone_bracket_reports_non_convergence(self, encounter_pair):
        """
        When no interior minimum exists the result must be flagged rather than
        presented as a converged solution.
        """
        a, b = encounter_pair
        start = a.element_set.epoch
        # A 5-second window is far too short to contain an extremum.
        result = refine(a, b, start, start + timedelta(seconds=5))
        assert result is not None
        assert result.converged is False

    def test_zero_length_bracket_returns_none(self, encounter_pair):
        a, b = encounter_pair
        start = a.element_set.epoch
        assert refine(a, b, start, start) is None

    def test_separation_profile_minimum_sits_at_tca(self, encounter_pair):
        a, b = encounter_pair
        start = a.element_set.epoch
        result = refine(a, b, start, start + timedelta(minutes=50))
        assert result is not None

        times, sep, rate = separation_profile(a, b, result.tca, 120.0, 241)
        idx = int(np.nanargmin(sep))
        # The sampled minimum must fall within one sample of t=0.
        assert abs((times[idx] - result.tca).total_seconds()) <= 1.1
        # Range rate must change sign across the minimum.
        assert rate[0] < 0 < rate[-1]


class TestBPlane:
    @pytest.fixture
    def encounter(self, iss):
        primary = FakeCatalogObject(iss, _meta(25544, "PRIMARY"))
        shadow_es = _shifted_copy(iss, norad=90002, raan_delta=0.4)
        secondary = FakeCatalogObject(shadow_es, _meta(90002, "SECONDARY"))
        start = iss.epoch
        result = refine(primary, secondary, start, start + timedelta(minutes=60))
        assert result is not None
        return result

    def test_basis_is_orthonormal(self, encounter):
        bp = build_bplane(encounter)
        basis = np.vstack([bp.xi_hat, bp.eta_hat, bp.zeta_hat])
        assert np.abs(basis @ basis.T - np.eye(3)).max() < 1e-12

    def test_basis_is_right_handed(self, encounter):
        bp = build_bplane(encounter)
        assert np.linalg.det(
            np.vstack([bp.xi_hat, bp.eta_hat, bp.zeta_hat])
        ) == pytest.approx(1.0, abs=1e-9)

    def test_eta_axis_is_relative_velocity_direction(self, encounter):
        bp = build_bplane(encounter)
        v_hat = encounter.relative_velocity_km_s / np.linalg.norm(
            encounter.relative_velocity_km_s
        )
        assert np.dot(bp.eta_hat, v_hat) == pytest.approx(1.0, abs=1e-12)

    def test_miss_vector_lies_in_the_plane(self, encounter):
        """
        At TCA the relative position is perpendicular to the relative velocity,
        so its out-of-plane component must vanish. This is simultaneously a
        check on the B-plane construction and on the TCA solution.
        """
        bp = build_bplane(encounter)
        assert abs(bp.eta_residual_km) < 1e-4

    def test_in_plane_magnitude_equals_3d_miss_distance(self, encounter):
        bp = build_bplane(encounter)
        assert math.hypot(bp.b_xi_km, bp.b_zeta_km) == pytest.approx(
            encounter.miss_distance_km, abs=1e-6
        )

    def test_xi_is_perpendicular_to_both_velocities(self, encounter):
        """xi is defined as v_b x v_a, so it must be normal to each."""
        bp = build_bplane(encounter)
        assert abs(np.dot(bp.xi_hat, encounter.state_a.velocity_km_s)) < 1e-9
        assert abs(np.dot(bp.xi_hat, encounter.state_b.velocity_km_s)) < 1e-9

    def test_covariance_projection_is_symmetric_psd(self, encounter):
        bp = build_bplane(encounter)
        cov3 = np.diag([0.04, 1.0, 0.16])
        cov2 = bp.project_covariance(cov3)
        assert cov2.shape == (2, 2)
        assert np.allclose(cov2, cov2.T, atol=1e-15)
        assert np.linalg.eigvalsh(cov2).min() >= -1e-12

    def test_encounter_angle_in_range(self, encounter):
        bp = build_bplane(encounter)
        assert 0.0 <= bp.encounter_angle_deg <= 180.0

    def test_slow_encounter_flagged(self, iss):
        """
        A co-orbital pair has a tiny relative speed, where the linear-encounter
        assumption behind the 2D formulation degrades. It must be flagged, not
        silently presented as valid.
        """
        primary = FakeCatalogObject(iss, _meta(25544, "PRIMARY"))
        shadow = FakeCatalogObject(
            _shifted_copy(iss, norad=90003, anomaly_delta=0.001), _meta(90003, "SHADOW")
        )
        start = iss.epoch
        result = refine(primary, shadow, start, start + timedelta(minutes=95))
        assert result is not None
        bp = build_bplane(result)
        if bp.relative_speed_km_s < 0.5:
            assert bp.linear_assumption_valid is False

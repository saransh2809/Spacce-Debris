"""
NUMERICAL REFERENCE TESTS.

These are the tests that matter most. They check KAKSHA's output against
values published independently of this project -- the Vallado SGP4 verification
suite, the IAU GMST definition, and the WGS-84 ellipsoid. If these pass, the
propagation and frame handling are correct in an externally checkable sense
rather than merely self-consistent.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np
import pytest

from app.core.frames import (
    WGS84_A_KM,
    WGS84_B_KM,
    itrf_to_geodetic,
    orbital_elements,
    ric_basis,
    teme_to_itrf,
)
from app.core.timebase import (
    JD_J2000,
    datetime_to_jd,
    gmst_rad,
    gmst_rad_at,
    jd_to_datetime,
    sun_direction_teme,
)
from app.propagation.sgp4_engine import propagate
from tests.conftest import (
    ISS_EXPECTED_R,
    ISS_FR,
    ISS_JD,
    VANGUARD_EXPECTED_R,
    VANGUARD_EXPECTED_V,
)


class TestSGP4AgainstVallado:
    """The published SGP4 verification case."""

    def test_vanguard_state_at_epoch_matches_reference(self, vanguard):
        """
        Catalogue 00005 at tsince=0 must reproduce the published state vector.

        This is the single most important test in the project: it proves the
        propagator is the reference implementation and not an approximation.
        """
        sat = __import__(
            "app.propagation.sgp4_engine", fromlist=["build_satrec"]
        ).build_satrec(vanguard)
        code, r, v = sat.sgp4(sat.jdsatepoch, sat.jdsatepochF)

        assert code == 0
        # Agreement to better than a millimetre in position.
        assert np.linalg.norm(np.array(r) - np.array(VANGUARD_EXPECTED_R)) < 1e-6
        # ...and better than a micrometre per second in velocity.
        assert np.linalg.norm(np.array(v) - np.array(VANGUARD_EXPECTED_V)) < 1e-8

    def test_iss_state_matches_published_example(self, iss):
        sat = __import__(
            "app.propagation.sgp4_engine", fromlist=["build_satrec"]
        ).build_satrec(iss)
        code, r, _v = sat.sgp4(ISS_JD, ISS_FR)
        assert code == 0
        for got, expected in zip(r, ISS_EXPECTED_R):
            assert got == pytest.approx(expected, abs=0.01)

    def test_wrapper_agrees_with_raw_propagator(self, iss):
        """The StateVector wrapper must not perturb the numbers it carries."""
        from app.propagation.sgp4_engine import build_satrec

        sat = build_satrec(iss)
        _code, r_raw, v_raw = sat.sgp4(ISS_JD, ISS_FR)

        when = jd_to_datetime(ISS_JD, ISS_FR)
        state = propagate(iss, when)

        # datetime carries microsecond resolution, so the reconstructed instant
        # differs from the exact Julian date by < 1 us -> < 1 cm of motion.
        assert np.linalg.norm(state.position_km - np.array(r_raw)) < 1e-4
        assert np.linalg.norm(state.velocity_km_s - np.array(v_raw)) < 1e-6
        assert str(state.frame) == "TEME"


class TestTimeBase:
    def test_gmst_at_j2000_matches_iau_value(self):
        """GMST at the J2000.0 epoch is 280.46061837 degrees (IAU-82)."""
        got = math.degrees(gmst_rad(JD_J2000, 0.0))
        assert got == pytest.approx(280.46061837, abs=1e-5)

    def test_julian_date_of_j2000(self):
        jd, fr = datetime_to_jd(datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc))
        assert jd + fr == pytest.approx(2451545.0, abs=1e-9)

    def test_julian_date_round_trip_sub_millisecond(self):
        t = datetime(2026, 8, 25, 13, 45, 17, 500000, tzinfo=timezone.utc)
        jd, fr = datetime_to_jd(t)
        back = jd_to_datetime(jd, fr)
        assert abs((back - t).total_seconds()) < 1e-3

    def test_gmst_advances_one_sidereal_day(self):
        """GMST must advance by 2*pi over one sidereal day (86164.0905 s)."""
        t0 = datetime(2026, 3, 1, tzinfo=timezone.utc)
        from datetime import timedelta

        t1 = t0 + timedelta(seconds=86164.0905)
        delta = (gmst_rad_at(t1) - gmst_rad_at(t0)) % (2 * math.pi)
        # Within a milliarcsecond-ish of a full turn.
        assert min(delta, 2 * math.pi - delta) < 1e-5

    @pytest.mark.parametrize(
        "date,expected_declination",
        [
            (datetime(2026, 6, 21, tzinfo=timezone.utc), 23.44),
            (datetime(2026, 12, 21, tzinfo=timezone.utc), -23.44),
            (datetime(2026, 3, 20, tzinfo=timezone.utc), 0.0),
        ],
    )
    def test_solar_declination_at_solstices_and_equinox(
        self, date, expected_declination
    ):
        """
        Solar declination must reach +/-23.44 deg at the solstices and cross
        zero at the equinoxes. This is what makes the day/night terminator
        correct rather than decorative.
        """
        s = sun_direction_teme(date)
        declination = math.degrees(math.asin(s[2]))
        assert declination == pytest.approx(expected_declination, abs=0.35)

    def test_sun_direction_is_unit_vector(self):
        s = sun_direction_teme(datetime(2026, 8, 24, tzinfo=timezone.utc))
        assert np.linalg.norm(s) == pytest.approx(1.0, abs=1e-12)


class TestFrames:
    def test_geodetic_on_equator(self):
        """A point on the equatorial radius must give lat 0, altitude 0."""
        lat, _lon, alt = itrf_to_geodetic(np.array([WGS84_A_KM, 0.0, 0.0]))
        assert lat == pytest.approx(0.0, abs=1e-9)
        assert alt == pytest.approx(0.0, abs=1e-9)

    def test_geodetic_at_pole(self):
        lat, _lon, alt = itrf_to_geodetic(np.array([0.0, 0.0, WGS84_B_KM]))
        assert lat == pytest.approx(90.0, abs=1e-7)
        assert alt == pytest.approx(0.0, abs=1e-7)

    def test_geodetic_latitude_exceeds_geocentric(self):
        """
        On an oblate Earth, geodetic latitude is always greater than geocentric
        latitude away from the equator and poles. Getting this backwards is a
        classic sign of using a spherical Earth by mistake.
        """
        r = np.array([4500.0, 0.0, 4500.0])
        lat_geodetic, _, _ = itrf_to_geodetic(r)
        lat_geocentric = math.degrees(math.atan2(r[2], math.hypot(r[0], r[1])))
        assert lat_geodetic > lat_geocentric

    def test_teme_to_itrf_preserves_length(self):
        """The TEME -> ITRF position transform is a pure rotation."""
        r = np.array([4000.0, -3000.0, 5000.0])
        v = np.array([1.0, 7.0, -2.0])
        when = datetime(2026, 8, 24, 6, 30, tzinfo=timezone.utc)
        r_itrf, _ = teme_to_itrf(r, v, when)
        assert np.linalg.norm(r_itrf) == pytest.approx(np.linalg.norm(r), rel=1e-12)

    def test_earth_fixed_velocity_removes_rotation(self):
        """
        A geostationary satellite is stationary in the Earth-fixed frame. Its
        ITRF velocity must therefore be near zero even though its inertial
        speed is about 3.07 km/s. This is the sharpest available check that the
        omega x r transport term is applied correctly.
        """
        r_geo = 42164.0
        omega = 7.292115146706979e-5
        r = np.array([r_geo, 0.0, 0.0])
        v = np.array([0.0, omega * r_geo, 0.0])  # inertial circular velocity
        when = datetime(2026, 8, 24, tzinfo=timezone.utc)
        _r_itrf, v_itrf = teme_to_itrf(r, v, when)
        assert np.linalg.norm(v) == pytest.approx(3.0746, abs=1e-3)
        assert np.linalg.norm(v_itrf) < 1e-9

    def test_ric_basis_is_orthonormal_and_right_handed(self):
        r = np.array([7000.0, 1500.0, -900.0])
        v = np.array([-1.5, 6.9, 2.1])
        m = ric_basis(r, v)
        assert np.abs(m @ m.T - np.eye(3)).max() < 1e-12
        assert np.linalg.det(m) == pytest.approx(1.0, abs=1e-12)

    def test_ric_radial_axis_points_along_position(self):
        r = np.array([7000.0, 1500.0, -900.0])
        v = np.array([-1.5, 6.9, 2.1])
        m = ric_basis(r, v)
        assert np.dot(m[0], r / np.linalg.norm(r)) == pytest.approx(1.0, abs=1e-12)

    def test_ric_in_track_equals_velocity_for_circular_orbit(self):
        """For a circular orbit the in-track axis coincides with v_hat."""
        r = np.array([7000.0, 0.0, 0.0])
        v = np.array([0.0, 7.546, 0.0])
        m = ric_basis(r, v)
        assert np.dot(m[1], v / np.linalg.norm(v)) == pytest.approx(1.0, abs=1e-9)

    def test_ric_rejects_degenerate_orbit(self):
        with pytest.raises(ValueError):
            ric_basis(np.array([7000.0, 0, 0]), np.array([1.0, 0, 0]))


class TestOrbitalElements:
    def test_circular_equatorial_orbit(self):
        """A known circular orbit must return the elements it was built from."""
        mu = 398600.4418
        radius = 7000.0
        speed = math.sqrt(mu / radius)
        el = orbital_elements(
            np.array([radius, 0.0, 0.0]), np.array([0.0, speed, 0.0])
        )
        assert el["semi_major_axis_km"] == pytest.approx(radius, rel=1e-9)
        assert el["eccentricity"] == pytest.approx(0.0, abs=1e-9)
        assert el["inclination_deg"] == pytest.approx(0.0, abs=1e-9)
        expected_period = 2 * math.pi * math.sqrt(radius**3 / mu) / 60.0
        assert el["period_min"] == pytest.approx(expected_period, rel=1e-9)

    def test_polar_orbit_inclination(self):
        mu = 398600.4418
        radius = 7000.0
        speed = math.sqrt(mu / radius)
        el = orbital_elements(
            np.array([radius, 0.0, 0.0]), np.array([0.0, 0.0, speed])
        )
        assert el["inclination_deg"] == pytest.approx(90.0, abs=1e-9)

    def test_osculating_period_matches_tle_mean_period_closely(self, iss):
        """
        Osculating and mean elements should be close but NOT identical. If they
        matched exactly, something would be wrong -- the TLE carries SGP4 mean
        elements and the state vector gives an instantaneous two-body fit.
        """
        state = propagate(iss, iss.epoch)
        el = orbital_elements(state.position_km, state.velocity_km_s)
        assert el["period_min"] == pytest.approx(iss.period_min, rel=0.01)
        assert el["period_min"] != iss.period_min

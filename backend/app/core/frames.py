"""
KAKSHA -- explicit reference-frame pipeline.

RULE: no vector crosses a frame boundary in this codebase without passing
through a named function in this module.  Every returned state carries the
frame it is expressed in, and the API echoes that frame to the client.

FRAMES
------
TEME   True Equator, Mean Equinox of date.  The NATIVE output frame of SGP4.
       Quasi-inertial.  Position km, velocity km/s.
ITRF   International Terrestrial Reference Frame (Earth-fixed).  Used ONLY for
       ground tracks, sub-satellite points and geodetic altitude.
GEO    WGS-84 geodetic latitude / longitude / altitude.
RIC    Radial / In-track / Cross-track, a.k.a. RSW.  Local orbit frame of a
       specific object.  The uncertainty model is defined here.
ECI_VIS  The frame handed to the 3D renderer.  It IS TEME, unrotated -- the
       browser rotates the Earth mesh by GMST instead of rotating 12,000
       satellite positions.  Same physics, one rotation instead of thousands.

WHY CONJUNCTION MATH STAYS IN TEME
----------------------------------
Both objects in a pair are propagated by the same SGP4 theory from TLEs that
are themselves *defined* in TEME.  Their relative position and velocity are
therefore consistent to the accuracy of the theory.  Converting to a
"better" frame such as GCRF would apply precession/nutation to both objects
identically, leaving the relative geometry unchanged while adding a
transformation that could introduce error.  Miss distance, relative velocity,
TCA and the B-plane are all *relative* quantities, so TEME is the correct and
defensible choice.  Earth-fixed conversion happens only for display.

APPROXIMATIONS, STATED
----------------------
* Polar motion (x_p, y_p) is neglected in TEME -> ITRF.  Effect: < 15 m on the
  sub-satellite point.  Zero effect on conjunction geometry.
* UT1 ~= UTC (see app/core/timebase).  Effect: < 0.5 km of longitude.  Zero
  effect on conjunction geometry.
Both are reported by the validation engine rather than hidden.
"""
from __future__ import annotations

import math
from datetime import datetime
from enum import StrEnum

import numpy as np

from app.core.timebase import OMEGA_EARTH_RAD_S, gmst_rad_at

# WGS-84 ellipsoid.
WGS84_A_KM = 6378.137
WGS84_F = 1.0 / 298.257223563
WGS84_B_KM = WGS84_A_KM * (1.0 - WGS84_F)
WGS84_E2 = WGS84_F * (2.0 - WGS84_F)
# Earth gravitational parameter, km^3/s^2 (WGS-84 / EGM-96 value used by SGP4).
MU_EARTH = 398600.4418


class Frame(StrEnum):
    TEME = "TEME"
    ITRF = "ITRF"
    GEODETIC = "GEODETIC_WGS84"
    RIC = "RIC"
    ECI_VIS = "ECI_VIS"


def rot3(theta: float) -> np.ndarray:
    """Rotation about the Z axis by `theta` radians (right-handed)."""
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, s, 0.0], [-s, c, 0.0], [0.0, 0.0, 1.0]], dtype=float)


def teme_to_itrf(
    r_teme_km: np.ndarray, v_teme_km_s: np.ndarray, when: datetime
) -> tuple[np.ndarray, np.ndarray]:
    """
    TEME -> ITRF (Earth-fixed).  Polar motion neglected (see module docstring).

    Position is a pure rotation by GMST.  Velocity additionally loses the
    transport term omega x r, because ITRF is a rotating frame:

        v_itrf = R3(theta) v_teme  -  omega_earth x r_itrf
    """
    theta = gmst_rad_at(when)
    r = rot3(theta) @ np.asarray(r_teme_km, dtype=float)
    omega = np.array([0.0, 0.0, OMEGA_EARTH_RAD_S])
    v = rot3(theta) @ np.asarray(v_teme_km_s, dtype=float) - np.cross(omega, r)
    return r, v


def itrf_to_geodetic(r_itrf_km: np.ndarray) -> tuple[float, float, float]:
    """
    ITRF Cartesian -> WGS-84 geodetic (lat_deg, lon_deg, altitude_km).

    Uses the closed-form Bowring-style iteration, which converges to
    sub-millimetre in a few passes for any altitude a catalogued object can
    have.  Returns geodetic (not geocentric) latitude and height above the
    ellipsoid -- the quantity people mean when they say "altitude".
    """
    x, y, z = (float(v) for v in r_itrf_km)
    lon = math.atan2(y, x)
    p = math.hypot(x, y)

    if p < 1e-9:  # over a pole; the iteration below is degenerate here
        lat = math.copysign(math.pi / 2.0, z)
        alt = abs(z) - WGS84_B_KM
        return math.degrees(lat), math.degrees(lon), alt

    lat = math.atan2(z, p * (1.0 - WGS84_E2))
    alt = 0.0
    for _ in range(6):
        sin_lat = math.sin(lat)
        n = WGS84_A_KM / math.sqrt(1.0 - WGS84_E2 * sin_lat * sin_lat)
        alt = p / math.cos(lat) - n
        lat_new = math.atan2(z, p * (1.0 - WGS84_E2 * n / (n + alt)))
        if abs(lat_new - lat) < 1e-13:
            lat = lat_new
            break
        lat = lat_new

    sin_lat = math.sin(lat)
    n = WGS84_A_KM / math.sqrt(1.0 - WGS84_E2 * sin_lat * sin_lat)
    alt = p / math.cos(lat) - n
    return math.degrees(lat), math.degrees(lon), alt


def teme_to_geodetic(
    r_teme_km: np.ndarray, v_teme_km_s: np.ndarray, when: datetime
) -> tuple[float, float, float]:
    """Convenience: TEME state -> (lat_deg, lon_deg, alt_km) for display."""
    r_itrf, _ = teme_to_itrf(r_teme_km, v_teme_km_s, when)
    return itrf_to_geodetic(r_itrf)


def ric_basis(r_km: np.ndarray, v_km_s: np.ndarray) -> np.ndarray:
    """
    Orthonormal RIC (radial / in-track / cross-track) basis for an object.

    Returned as a 3x3 matrix whose ROWS are the unit vectors, so

        x_ric = M @ x_inertial

    rotates an inertial vector into the local orbit frame of that object.

    R  = r_hat                     (radially outward)
    C  = (r x v)_hat               (orbit normal, cross-track)
    I  = C x R                     (completes the right-handed set; equals the
                                    velocity direction for a circular orbit)

    Note the in-track axis is NOT simply v_hat for an eccentric orbit -- using
    v_hat would give a non-orthogonal frame.  This is the standard RSW/RIC
    definition used for covariance in conjunction assessment.
    """
    r = np.asarray(r_km, dtype=float)
    v = np.asarray(v_km_s, dtype=float)
    r_norm = np.linalg.norm(r)
    if r_norm < 1e-9:
        raise ValueError("RIC basis undefined at the origin")
    r_hat = r / r_norm

    h = np.cross(r, v)
    h_norm = np.linalg.norm(h)
    if h_norm < 1e-12:
        raise ValueError("RIC basis undefined for a degenerate (rectilinear) orbit")
    c_hat = h / h_norm

    i_hat = np.cross(c_hat, r_hat)
    return np.vstack([r_hat, i_hat, c_hat])


def inertial_to_ric(
    vec: np.ndarray, r_km: np.ndarray, v_km_s: np.ndarray
) -> np.ndarray:
    """Rotate an inertial vector into the RIC frame of the given orbit state."""
    return ric_basis(r_km, v_km_s) @ np.asarray(vec, dtype=float)


def ric_to_inertial(
    vec_ric: np.ndarray, r_km: np.ndarray, v_km_s: np.ndarray
) -> np.ndarray:
    """Rotate an RIC vector back into the inertial (TEME) frame."""
    return ric_basis(r_km, v_km_s).T @ np.asarray(vec_ric, dtype=float)


def ric_covariance_to_inertial(
    cov_ric: np.ndarray, r_km: np.ndarray, v_km_s: np.ndarray
) -> np.ndarray:
    """
    Rotate a 3x3 position covariance from RIC into the inertial frame.

        C_inertial = M^T C_ric M

    where M rotates inertial -> RIC.  Congruence transform, so the result stays
    symmetric positive semi-definite by construction.
    """
    m = ric_basis(r_km, v_km_s)
    return m.T @ np.asarray(cov_ric, dtype=float) @ m


def orbital_elements(r_km: np.ndarray, v_km_s: np.ndarray) -> dict[str, float]:
    """
    Osculating Keplerian elements from an inertial (TEME) state vector.

    Used for the display panel and for the broad-phase apogee/perigee sieve.
    These are OSCULATING elements from the propagated state -- they differ
    slightly from the MEAN elements in the TLE, which is expected and correct:
    the TLE carries SGP4 mean elements, this is the instantaneous two-body fit.
    The API labels them accordingly.
    """
    r = np.asarray(r_km, dtype=float)
    v = np.asarray(v_km_s, dtype=float)
    r_mag = float(np.linalg.norm(r))
    v_mag = float(np.linalg.norm(v))

    h_vec = np.cross(r, v)
    h = float(np.linalg.norm(h_vec))
    n_vec = np.cross(np.array([0.0, 0.0, 1.0]), h_vec)
    n = float(np.linalg.norm(n_vec))

    e_vec = ((v_mag**2 - MU_EARTH / r_mag) * r - float(np.dot(r, v)) * v) / MU_EARTH
    ecc = float(np.linalg.norm(e_vec))

    energy = v_mag**2 / 2.0 - MU_EARTH / r_mag
    sma = -MU_EARTH / (2.0 * energy) if abs(energy) > 1e-12 else float("inf")

    inc = math.degrees(math.acos(max(-1.0, min(1.0, h_vec[2] / h)))) if h > 0 else 0.0

    raan = 0.0
    if n > 1e-9:
        raan = math.degrees(math.atan2(n_vec[1], n_vec[0])) % 360.0

    argp = 0.0
    if n > 1e-9 and ecc > 1e-9:
        argp = math.degrees(
            math.acos(max(-1.0, min(1.0, float(np.dot(n_vec, e_vec)) / (n * ecc))))
        )
        if e_vec[2] < 0:
            argp = 360.0 - argp

    ta = 0.0
    if ecc > 1e-9:
        ta = math.degrees(
            math.acos(max(-1.0, min(1.0, float(np.dot(e_vec, r)) / (ecc * r_mag))))
        )
        if float(np.dot(r, v)) < 0:
            ta = 360.0 - ta

    period_min = (
        2.0 * math.pi * math.sqrt(sma**3 / MU_EARTH) / 60.0
        if math.isfinite(sma) and sma > 0
        else float("nan")
    )
    apogee_km = sma * (1.0 + ecc) - WGS84_A_KM if math.isfinite(sma) else float("nan")
    perigee_km = sma * (1.0 - ecc) - WGS84_A_KM if math.isfinite(sma) else float("nan")

    return {
        "semi_major_axis_km": sma,
        "eccentricity": ecc,
        "inclination_deg": inc,
        "raan_deg": raan,
        "arg_perigee_deg": argp,
        "true_anomaly_deg": ta,
        "period_min": period_min,
        "apogee_km": apogee_km,
        "perigee_km": perigee_km,
        "specific_angular_momentum": h,
    }

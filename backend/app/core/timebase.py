"""
KAKSHA -- time base.

All astrodynamics in this project is driven from a single, explicit time
representation.  Mixing time scales silently is one of the classic ways an
orbital pipeline produces confident nonsense, so every conversion here is named
and documented.

TIME SCALES USED
----------------
UTC   Coordinated Universal Time.  The time the user sees and the simulation
      clock reports.  All API timestamps are UTC ISO-8601 with a 'Z'.
UT1   Earth-rotation time.  Drives GMST and therefore the Earth-fixed frame.
      UT1 = UTC + DUT1 with |DUT1| < 0.9 s.  We deliberately approximate
      UT1 ~= UTC.  Consequence: up to ~0.9 s of Earth rotation error, i.e.
      ~0.4 km of longitude error on the ground track.  This is IRRELEVANT to
      conjunction geometry (which is computed entirely in the inertial TEME
      frame and never touches Earth rotation) and only affects the displayed
      sub-satellite point.  This limitation is surfaced on the VALIDATION page.

SGP4 is fed Julian date UTC split into (jd, fr) to preserve precision: a naive
single float loses ~10 microseconds of resolution at modern epochs, which at
7.7 km/s is ~8 cm -- small, but there is no reason to give it away.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import numpy as np

# Julian date of the J2000.0 epoch (2000-01-01T12:00:00 TT).
JD_J2000 = 2451545.0
SECONDS_PER_DAY = 86400.0
# Earth rotation rate, rad/s (IERS, includes precession of the equinox).
OMEGA_EARTH_RAD_S = 7.292115146706979e-5


def ensure_utc(dt: datetime) -> datetime:
    """Attach UTC to a naive datetime; convert an aware one to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def datetime_to_jd(dt: datetime) -> tuple[float, float]:
    """
    UTC datetime -> (jd, fr) two-part Julian date for the SGP4 propagator.

    `jd` carries the integer-ish day number, `fr` the fraction of a day.  The
    split keeps sub-microsecond resolution across the whole catalogue.
    """
    dt = ensure_utc(dt)
    y, mo, d = dt.year, dt.month, dt.day
    if mo <= 2:
        y -= 1
        mo += 12
    a = y // 100
    b = 2 - a + a // 4
    jd = (
        math.floor(365.25 * (y + 4716))
        + math.floor(30.6001 * (mo + 1))
        + d
        + b
        - 1524.5
    )
    fr = (
        dt.hour * 3600.0 + dt.minute * 60.0 + dt.second + dt.microsecond * 1e-6
    ) / SECONDS_PER_DAY
    return jd, fr


def jd_to_datetime(jd: float, fr: float = 0.0) -> datetime:
    """Inverse of :func:`datetime_to_jd`, returning an aware UTC datetime."""
    total = jd + fr + 0.5
    z = math.floor(total)
    f = total - z
    if z >= 2299161:
        alpha = math.floor((z - 1867216.25) / 36524.25)
        z = z + 1 + alpha - math.floor(alpha / 4)
    b = z + 1524
    c = math.floor((b - 122.1) / 365.25)
    d = math.floor(365.25 * c)
    e = math.floor((b - d) / 30.6001)
    day = b - d - math.floor(30.6001 * e) + f
    month = e - 1 if e < 14 else e - 13
    year = c - 4716 if month > 2 else c - 4715
    day_int = int(math.floor(day))
    seconds = (day - day_int) * SECONDS_PER_DAY
    base = datetime(year, month, day_int, tzinfo=timezone.utc)
    return base + timedelta(seconds=seconds)


def julian_centuries_j2000(jd: float, fr: float = 0.0) -> float:
    """Julian centuries elapsed since J2000.0."""
    return ((jd - JD_J2000) + fr) / 36525.0


def gmst_rad(jd_ut1: float, fr_ut1: float = 0.0) -> float:
    """
    Greenwich Mean Sidereal Time in radians, IAU-1982 model.

    Vallado, *Fundamentals of Astrodynamics and Applications* (4th ed.),
    Eq. 3-47.  This is the GMST82 definition, which is the correct companion to
    the TEME frame produced by SGP4 -- TEME is referred to the *uniform equinox
    of date*, so the TEME -> Earth-fixed rotation uses GMST, not GAST.
    """
    t = julian_centuries_j2000(jd_ut1, fr_ut1)
    gmst_seconds = (
        67310.54841
        + (876600.0 * 3600.0 + 8640184.812866) * t
        + 0.093104 * t * t
        - 6.2e-6 * t * t * t
    )
    # 86400 s of sidereal time span 360 deg  ->  240 s per degree.
    gmst_deg = (gmst_seconds % SECONDS_PER_DAY) / 240.0
    return math.radians(gmst_deg % 360.0)


def gmst_rad_at(dt: datetime) -> float:
    """GMST for a UTC datetime, using the UT1 ~= UTC approximation."""
    jd, fr = datetime_to_jd(dt)
    return gmst_rad(jd, fr)


def sun_direction_teme(dt: datetime) -> np.ndarray:
    """
    Unit vector from Earth's centre toward the Sun, expressed in TEME.

    Low-precision analytic solar ephemeris (Vallado 4th ed., Algorithm 29),
    accurate to roughly 0.01 deg over 1950-2050.  That is far better than the
    ~0.25 deg angular radius of the Sun, so the day/night terminator it drives
    is correct to well under a pixel at any sane zoom level.

    Strictly this returns the Sun in MOD (mean equator, mean equinox of date).
    The MOD -> TEME difference is the equation of the equinoxes, under
    0.004 deg, which is below the accuracy of the ephemeris itself.  Documented
    rather than silently ignored.
    """
    jd, fr = datetime_to_jd(dt)
    t = julian_centuries_j2000(jd, fr)

    # Mean longitude and mean anomaly of the Sun, degrees.
    lambda_m = (280.460 + 36000.771 * t) % 360.0
    m = math.radians((357.5291092 + 35999.05034 * t) % 360.0)

    # Ecliptic longitude corrected for the equation of centre.
    lambda_ecl = math.radians(
        lambda_m + 1.914666471 * math.sin(m) + 0.019994643 * math.sin(2.0 * m)
    )
    # Obliquity of the ecliptic.
    eps = math.radians(23.439291 - 0.0130042 * t)

    return np.array(
        [
            math.cos(lambda_ecl),
            math.cos(eps) * math.sin(lambda_ecl),
            math.sin(eps) * math.sin(lambda_ecl),
        ],
        dtype=float,
    )


def iso(dt: datetime) -> str:
    """Canonical API timestamp: UTC, millisecond precision, trailing 'Z'."""
    return (
        ensure_utc(dt)
        .replace(microsecond=(ensure_utc(dt).microsecond // 1000) * 1000)
        .isoformat()
        .replace("+00:00", "Z")
    )


def now_utc() -> datetime:
    return datetime.now(timezone.utc)

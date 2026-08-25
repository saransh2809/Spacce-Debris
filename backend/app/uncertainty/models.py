"""
KAKSHA -- uncertainty modelling.

THE CENTRAL HONESTY PROBLEM
---------------------------
A real collision probability requires a real covariance.  Public TLE/GP data
does NOT publish covariance.  Any system that ingests TLEs and prints a
"probability of collision" to three significant figures is inventing the most
important input and hiding it behind a formula.

KAKSHA refuses to do that.  Instead:

  * Covariance always carries a SOURCE tag -- PUBLISHED, ASSUMED_MODEL, or
    UNAVAILABLE -- which travels with the number through the API to the UI.
  * When the source is ASSUMED_MODEL, the assumed 1-sigma values and their
    growth law are returned ALONGSIDE the result, so the reader can see the
    input that drove it.
  * A probability computed from an assumed covariance is never called
    "probability of collision".  It is
    `conditional_encounter_probability` and it is always accompanied by
    `is_operational_pc = False` and an explicit caveat string.
  * The headline ranking number is a RISK SCORE built from screening
    quantities, not a probability.  See app/risk/engine.py.

THE ASSUMED MODEL
-----------------
1-sigma position error in the RIC frame, growing linearly with time since the
element epoch:

    sigma_R(t) = sigma_R0 + growth_R * age_days
    sigma_I(t) = sigma_I0 + growth_I * age_days
    sigma_C(t) = sigma_C0 + growth_C * age_days

In-track dominates, which is the correct qualitative behaviour: TLE error is
overwhelmingly along-track, driven by mismodelled drag.  The coefficients live
in app/core/config.py and are stated on the VALIDATION page.  They are an
engineering assumption calibrated to published TLE-accuracy studies, and the
system says so.  They are NOT a measurement.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import StrEnum

import numpy as np

from app.core.config import settings
from app.core.frames import ric_covariance_to_inertial
from app.core.logging import get_logger

log = get_logger("uncertainty")


class CovarianceSource(StrEnum):
    """Provenance of the covariance used.  Travels with every result."""

    PUBLISHED = "PUBLISHED"            # from a CDM / operator ephemeris
    ASSUMED_MODEL = "ASSUMED_MODEL"    # from the documented model below
    UNAVAILABLE = "UNAVAILABLE"        # no usable uncertainty at all


@dataclass(slots=True)
class ObjectUncertainty:
    """Position uncertainty for one object at one instant."""

    norad_id: int
    source: CovarianceSource
    sigma_radial_km: float
    sigma_in_track_km: float
    sigma_cross_track_km: float
    age_days: float
    covariance_ric: np.ndarray        # 3x3, km^2, RIC frame
    covariance_inertial: np.ndarray   # 3x3, km^2, TEME frame

    @property
    def rss_sigma_km(self) -> float:
        """Root-sum-square 1-sigma position error -- a single-number summary."""
        return math.sqrt(
            self.sigma_radial_km**2
            + self.sigma_in_track_km**2
            + self.sigma_cross_track_km**2
        )


@dataclass(slots=True)
class EncounterUncertainty:
    """Combined uncertainty for a conjunction, expressed in the B-plane."""

    source: CovarianceSource
    object_a: ObjectUncertainty
    object_b: ObjectUncertainty

    # Combined relative-position covariance projected into the encounter plane.
    covariance_2d_km2: np.ndarray      # 2x2, km^2, (xi, zeta)
    sigma_major_km: float              # 1-sigma along the major axis
    sigma_minor_km: float
    ellipse_orientation_deg: float     # major axis, degrees from the xi axis

    # How many combined sigma the miss distance represents along the miss
    # direction.  This is the key uncertainty-aware screening quantity.
    mahalanobis_distance: float
    miss_over_sigma: float

    hard_body_radius_m: float
    hard_body_source: str

    # Probability-like output.  NEVER presented as an operational Pc unless
    # `is_operational_pc` is True, which requires PUBLISHED covariance.
    conditional_encounter_probability: float | None = None
    is_operational_pc: bool = False
    caveats: list[str] = field(default_factory=list)


def _assumed_sigmas(age_days: float) -> tuple[float, float, float]:
    """The documented assumed 1-sigma triple at a given propagation age."""
    age = max(0.0, float(age_days))
    return (
        settings.assumed_sigma_radial_km + settings.sigma_growth_radial_km_per_day * age,
        settings.assumed_sigma_in_track_km
        + settings.sigma_growth_in_track_km_per_day * age,
        settings.assumed_sigma_cross_track_km
        + settings.sigma_growth_cross_track_km_per_day * age,
    )


def build_object_uncertainty(
    norad_id: int,
    position_km: np.ndarray,
    velocity_km_s: np.ndarray,
    age_days: float,
    published_covariance_ric: np.ndarray | None = None,
) -> ObjectUncertainty:
    """
    Build the uncertainty for one object at one instant.

    If a published RIC covariance is supplied (e.g. parsed from a CDM) it is
    used verbatim and tagged PUBLISHED.  Otherwise the documented assumed model
    is applied and tagged ASSUMED_MODEL.  There is no third path in which a
    number appears without a provenance tag.
    """
    if published_covariance_ric is not None:
        cov_ric = np.asarray(published_covariance_ric, dtype=float)
        source = CovarianceSource.PUBLISHED
        sigma_r = math.sqrt(max(0.0, cov_ric[0, 0]))
        sigma_i = math.sqrt(max(0.0, cov_ric[1, 1]))
        sigma_c = math.sqrt(max(0.0, cov_ric[2, 2]))
    else:
        sigma_r, sigma_i, sigma_c = _assumed_sigmas(age_days)
        # Diagonal: the assumed model makes no claim about correlations, and
        # inventing off-diagonal terms would be a second fabrication on top of
        # the first.
        cov_ric = np.diag([sigma_r**2, sigma_i**2, sigma_c**2])
        source = CovarianceSource.ASSUMED_MODEL

    cov_inertial = ric_covariance_to_inertial(cov_ric, position_km, velocity_km_s)

    return ObjectUncertainty(
        norad_id=norad_id,
        source=source,
        sigma_radial_km=sigma_r,
        sigma_in_track_km=sigma_i,
        sigma_cross_track_km=sigma_c,
        age_days=age_days,
        covariance_ric=cov_ric,
        covariance_inertial=cov_inertial,
    )


def hard_body_radius_m(rcs_a_m2: float | None, rcs_b_m2: float | None) -> tuple[float, str]:
    """
    Combined hard-body radius for the pair, metres, plus its provenance.

    Each object's radius is estimated from its published radar cross-section as
    the radius of a disc of that area, r = sqrt(RCS / pi).  RCS is a radar
    observable, not a physical size, so this is an ESTIMATE and is labelled as
    one.  When RCS is missing the configured default is used and the label says
    "assumed default".
    """
    parts: list[float] = []
    sources: list[str] = []
    for rcs in (rcs_a_m2, rcs_b_m2):
        if rcs is not None and rcs > 0.0:
            parts.append(math.sqrt(rcs / math.pi))
            sources.append("RCS-derived")
        else:
            parts.append(settings.default_hard_body_radius_m)
            sources.append("assumed default")

    combined = float(sum(parts))
    if all(s == "RCS-derived" for s in sources):
        label = "RCS-derived (both objects)"
    elif all(s == "assumed default" for s in sources):
        label = "assumed default (both objects)"
    else:
        label = "RCS-derived for one object, assumed default for the other"
    return combined, label


def _ellipse_from_covariance(cov_2d: np.ndarray) -> tuple[float, float, float]:
    """
    Principal axes of a 2x2 covariance.

    Returns (sigma_major_km, sigma_minor_km, orientation_deg).  Eigenvalues are
    clamped at zero: a numerically tiny negative eigenvalue from round-off is
    not a real negative variance and must not become a NaN.
    """
    vals, vecs = np.linalg.eigh(np.asarray(cov_2d, dtype=float))
    vals = np.clip(vals, 0.0, None)
    order = np.argsort(vals)[::-1]
    vals = vals[order]
    vecs = vecs[:, order]
    major = math.sqrt(float(vals[0]))
    minor = math.sqrt(float(vals[1]))
    angle = math.degrees(math.atan2(float(vecs[1, 0]), float(vecs[0, 0])))
    return major, minor, angle


def encounter_probability_2d(
    b_xi_km: float,
    b_zeta_km: float,
    cov_2d_km2: np.ndarray,
    hard_body_radius_km: float,
    n_r: int = 96,
    n_theta: int = 192,
) -> float:
    """
    Foster 2D encounter-probability integral.

        P = integral over the hard-body disc of N(x; b, C) dA

    The relative position at TCA lies exactly in the encounter plane, and over
    the brief encounter the relative motion is rectilinear, so the collision
    condition reduces to "does the true relative position fall inside a disc of
    radius HBR".  This function evaluates that integral by Gauss-Legendre
    quadrature in polar coordinates -- no series expansion, no small-HBR
    approximation.

    The number returned is a probability CONDITIONAL ON THE SUPPLIED
    COVARIANCE.  Its meaning is only as good as that covariance.  The caller is
    responsible for labelling it correctly; see :func:`build_encounter_uncertainty`.
    """
    cov = np.asarray(cov_2d_km2, dtype=float)
    det = float(np.linalg.det(cov))
    if not np.isfinite(det) or det <= 0.0 or hard_body_radius_km <= 0.0:
        return 0.0

    try:
        inv = np.linalg.inv(cov)
    except np.linalg.LinAlgError:
        return 0.0

    b = np.array([b_xi_km, b_zeta_km], dtype=float)
    norm = 1.0 / (2.0 * math.pi * math.sqrt(det))

    # Gauss-Legendre nodes on r in [0, R]; uniform (periodic-exact) in theta.
    gl_x, gl_w = np.polynomial.legendre.leggauss(n_r)
    r = 0.5 * hard_body_radius_km * (gl_x + 1.0)
    w_r = 0.5 * hard_body_radius_km * gl_w

    theta = np.linspace(0.0, 2.0 * math.pi, n_theta, endpoint=False)
    w_t = 2.0 * math.pi / n_theta

    # Grid of points inside the disc, then the Gaussian density at each.
    rr, tt = np.meshgrid(r, theta, indexing="ij")
    x = rr * np.cos(tt) - b[0]
    y = rr * np.sin(tt) - b[1]

    q = inv[0, 0] * x * x + (inv[0, 1] + inv[1, 0]) * x * y + inv[1, 1] * y * y
    dens = norm * np.exp(-0.5 * q)

    # dA = r dr dtheta
    integral = float(np.sum(dens * rr * w_r[:, None]) * w_t)
    return float(min(1.0, max(0.0, integral)))


def build_encounter_uncertainty(
    unc_a: ObjectUncertainty,
    unc_b: ObjectUncertainty,
    bplane,
    b_xi_km: float,
    b_zeta_km: float,
    rcs_a_m2: float | None,
    rcs_b_m2: float | None,
) -> EncounterUncertainty:
    """
    Combine two object uncertainties into the encounter-plane uncertainty.

    The two objects are tracked independently, so their position errors are
    treated as uncorrelated and the RELATIVE position covariance is the sum:

        C_rel = C_a + C_b

    This is the standard assumption in conjunction assessment and is stated
    rather than buried.
    """
    cov_rel_inertial = unc_a.covariance_inertial + unc_b.covariance_inertial
    cov_2d = bplane.project_covariance(cov_rel_inertial)

    sigma_major, sigma_minor, orientation = _ellipse_from_covariance(cov_2d)

    b = np.array([b_xi_km, b_zeta_km], dtype=float)
    miss = float(np.linalg.norm(b))

    # Mahalanobis distance: the miss expressed in units of the local sigma.
    try:
        inv2 = np.linalg.inv(cov_2d)
        mahalanobis = float(math.sqrt(max(0.0, float(b @ inv2 @ b))))
    except np.linalg.LinAlgError:
        mahalanobis = float("inf")

    # 1-sigma extent of the ellipse along the miss direction -- the intuitive
    # "how many sigma away is it" that the risk engine consumes.
    if miss > 1e-9:
        u = b / miss
        sigma_along = math.sqrt(max(1e-12, float(u @ cov_2d @ u)))
        miss_over_sigma = miss / sigma_along
    else:
        miss_over_sigma = 0.0

    hbr_m, hbr_source = hard_body_radius_m(rcs_a_m2, rcs_b_m2)

    source = (
        CovarianceSource.PUBLISHED
        if unc_a.source is CovarianceSource.PUBLISHED
        and unc_b.source is CovarianceSource.PUBLISHED
        else CovarianceSource.ASSUMED_MODEL
    )

    prob = encounter_probability_2d(b_xi_km, b_zeta_km, cov_2d, hbr_m / 1000.0)

    caveats: list[str] = []
    if source is CovarianceSource.ASSUMED_MODEL:
        caveats.append(
            "Covariance is NOT published for public GP/TLE data. These values come "
            "from KAKSHA's documented assumed error model, which grows with time "
            "since the element epoch. The probability shown is conditional on that "
            "model and is NOT an operational probability of collision."
        )
    if "assumed default" in hbr_source:
        caveats.append(
            f"Hard-body radius is partly assumed ({hbr_source}); published radar "
            "cross-section was unavailable for at least one object."
        )
    if not bplane.linear_assumption_valid:
        caveats.append(
            f"Relative speed is {bplane.relative_speed_km_s:.3f} km/s. This is a slow "
            "or co-orbital encounter, where the linear-encounter assumption behind "
            "the 2D formulation degrades. Treat the probability as indicative only."
        )
    if bplane.degenerate_basis:
        caveats.append(
            "The two velocity vectors are nearly parallel, so the encounter-plane "
            "orientation is ill-conditioned. The miss distance remains valid; the "
            "in-plane axis directions are arbitrary."
        )

    return EncounterUncertainty(
        source=source,
        object_a=unc_a,
        object_b=unc_b,
        covariance_2d_km2=cov_2d,
        sigma_major_km=sigma_major,
        sigma_minor_km=sigma_minor,
        ellipse_orientation_deg=orientation,
        mahalanobis_distance=mahalanobis,
        miss_over_sigma=miss_over_sigma,
        hard_body_radius_m=hbr_m,
        hard_body_source=hbr_source,
        conditional_encounter_probability=prob,
        is_operational_pc=source is CovarianceSource.PUBLISHED,
        caveats=caveats,
    )


def model_description() -> dict:
    """
    Machine-readable description of the assumed model, for the VALIDATION page
    and the LLM prompt.  Keeping this in one place means the documentation and
    the computation can never drift apart.
    """
    return {
        "name": "KAKSHA assumed TLE position-error model",
        "frame": "RIC (radial / in-track / cross-track)",
        "form": "sigma(t) = sigma_0 + growth * age_days",
        "correlations": "none assumed (diagonal covariance)",
        "sigma_0_km": {
            "radial": settings.assumed_sigma_radial_km,
            "in_track": settings.assumed_sigma_in_track_km,
            "cross_track": settings.assumed_sigma_cross_track_km,
        },
        "growth_km_per_day": {
            "radial": settings.sigma_growth_radial_km_per_day,
            "in_track": settings.sigma_growth_in_track_km_per_day,
            "cross_track": settings.sigma_growth_cross_track_km_per_day,
        },
        "combination_rule": "C_relative = C_a + C_b (objects tracked independently)",
        "hard_body_radius": (
            "r = sqrt(RCS / pi) per object where radar cross-section is published; "
            f"otherwise {settings.default_hard_body_radius_m} m assumed"
        ),
        "limitations": [
            "Public GP/TLE data does not include covariance; these sigmas are an "
            "engineering assumption, not a measurement.",
            "The model is isotropic in time and does not account for manoeuvres, "
            "solar activity, or object-specific drag behaviour.",
            "Probabilities derived from it are conditional on the model and must "
            "not be used for operational collision avoidance.",
        ],
    }

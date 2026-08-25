"""
KAKSHA -- B-plane (encounter plane) construction.

MATHEMATICAL DEFINITION
-----------------------
The encounter plane, following Foster (1992) and the convention used in
operational conjunction assessment, is the plane through the primary object at
TCA whose normal is the relative velocity vector.  Its right-handed basis
(xi, eta, zeta) is:

    eta_hat  = v_rel / |v_rel|                     (normal to the plane)
    xi_hat   = (v_b x v_a) / |v_b x v_a|           (in-plane)
    zeta_hat = xi_hat x eta_hat                    (in-plane, completes triad)

xi_hat is perpendicular to both velocity vectors and therefore to their
difference, so it genuinely lies in the plane -- this is not an arbitrary
choice, it is the only direction fixed by the two orbits themselves.

WHY THIS FRAME
--------------
At TCA the range-rate is zero, i.e. r_rel . v_rel = 0, which means the relative
position vector ALREADY lies in the encounter plane.  The three-dimensional
encounter therefore collapses to an exact two-dimensional problem with no
approximation: the miss vector is

    b = (r_rel . xi_hat, r_rel . zeta_hat),      |b| = miss distance

and the eta component is zero to numerical precision.  That residual is
reported as `eta_residual_km` and is a direct check that the TCA solution is
genuinely at closest approach -- if it is not small, the TCA is wrong.

This reduction is what makes the 2D encounter plot meaningful rather than
decorative: it is the actual geometry of the encounter, not an illustration
of one.

RELATIVE MOTION IN THE PLANE
----------------------------
Over the short span of an encounter the relative motion is very nearly
rectilinear (the "linear encounter" assumption, valid when the encounter
duration is short compared with the orbital period -- true for every
high-speed conjunction).  The trajectory therefore pierces the plane at b,
travelling along eta_hat.  For slow, co-orbital encounters that assumption
degrades, and :func:`build_bplane` flags it via `linear_assumption_valid`
rather than presenting a plot that quietly stops being true.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import timedelta

import numpy as np

from app.core.frames import Frame
from app.conjunction.tca import ClosestApproach
from app.core.logging import get_logger

log = get_logger("conjunction.bplane")

# Below this relative speed the linear-encounter assumption is questionable and
# the pair should be treated as a slow/co-orbital encounter.
SLOW_ENCOUNTER_KM_S = 0.5
# |v_b x v_a| below this (km/s)^2 means the velocities are nearly parallel and
# xi_hat is ill-conditioned; an arbitrary but stable in-plane basis is used.
PARALLEL_VELOCITY_TOL = 1e-6


@dataclass(slots=True)
class BPlane:
    """The encounter plane and everything expressed in it."""

    # Basis vectors in the inertial (TEME) frame.
    xi_hat: np.ndarray
    eta_hat: np.ndarray
    zeta_hat: np.ndarray

    # Miss vector components in the plane, km.
    b_xi_km: float
    b_zeta_km: float
    miss_distance_km: float

    # Out-of-plane residual.  Should be ~0 at a correct TCA.
    eta_residual_km: float

    # Encounter geometry.
    relative_speed_km_s: float
    encounter_angle_deg: float        # angle between the two velocity vectors
    time_in_plane_s: float            # 1-sigma-ish crossing duration, see below

    degenerate_basis: bool = False
    linear_assumption_valid: bool = True
    frame: Frame = Frame.TEME

    def project(self, vec_inertial: np.ndarray) -> tuple[float, float, float]:
        """Express an inertial vector in (xi, eta, zeta) components."""
        v = np.asarray(vec_inertial, dtype=float)
        return (
            float(np.dot(v, self.xi_hat)),
            float(np.dot(v, self.eta_hat)),
            float(np.dot(v, self.zeta_hat)),
        )

    def basis_matrix_2d(self) -> np.ndarray:
        """(3, 2) matrix whose columns are the in-plane basis vectors."""
        return np.column_stack([self.xi_hat, self.zeta_hat])

    def project_covariance(self, cov_inertial: np.ndarray) -> np.ndarray:
        """
        Project a 3x3 inertial position covariance onto the encounter plane.

            C_2d = P^T C_3d P,   P = [xi_hat  zeta_hat]

        The result is the 2x2 covariance of the miss vector, which is exactly
        what a collision-probability integral needs.  The congruence form keeps
        it symmetric positive semi-definite.
        """
        p = self.basis_matrix_2d()
        return p.T @ np.asarray(cov_inertial, dtype=float) @ p


def _orthonormal_complement(eta_hat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Any stable orthonormal pair spanning the plane normal to `eta_hat`.

    Used only when the two velocity vectors are nearly parallel, which makes
    the physically-preferred xi_hat direction ill-conditioned.  Picking the
    world axis least aligned with eta_hat keeps the construction numerically
    stable instead of blowing up near a degeneracy.
    """
    axis = np.array([1.0, 0.0, 0.0])
    if abs(float(np.dot(eta_hat, axis))) > 0.9:
        axis = np.array([0.0, 0.0, 1.0])
    xi = np.cross(axis, eta_hat)
    xi /= np.linalg.norm(xi)
    zeta = np.cross(xi, eta_hat)
    zeta /= np.linalg.norm(zeta)
    return xi, zeta


def build_bplane(ca: ClosestApproach) -> BPlane:
    """Construct the encounter plane for a refined close approach."""
    v_a = np.asarray(ca.state_a.velocity_km_s, dtype=float)
    v_b = np.asarray(ca.state_b.velocity_km_s, dtype=float)
    v_rel = np.asarray(ca.relative_velocity_km_s, dtype=float)
    r_rel = np.asarray(ca.relative_position_km, dtype=float)

    v_rel_mag = float(np.linalg.norm(v_rel))
    if v_rel_mag < 1e-12:
        # Genuinely co-moving objects: no encounter plane exists.  Rather than
        # inventing one, return a degenerate frame flagged as such.
        eta_hat = np.array([0.0, 0.0, 1.0])
        xi_hat, zeta_hat = _orthonormal_complement(eta_hat)
        return BPlane(
            xi_hat=xi_hat,
            eta_hat=eta_hat,
            zeta_hat=zeta_hat,
            b_xi_km=0.0,
            b_zeta_km=0.0,
            miss_distance_km=ca.miss_distance_km,
            eta_residual_km=0.0,
            relative_speed_km_s=0.0,
            encounter_angle_deg=0.0,
            time_in_plane_s=float("inf"),
            degenerate_basis=True,
            linear_assumption_valid=False,
        )

    eta_hat = v_rel / v_rel_mag

    cross = np.cross(v_b, v_a)
    cross_mag = float(np.linalg.norm(cross))
    degenerate = cross_mag < PARALLEL_VELOCITY_TOL

    if degenerate:
        xi_hat, zeta_hat = _orthonormal_complement(eta_hat)
    else:
        xi_hat = cross / cross_mag
        # Re-orthogonalise against eta_hat.  Analytically xi_hat is already
        # perpendicular to it; this removes accumulated floating-point drift so
        # the basis stays orthonormal to machine precision.
        xi_hat = xi_hat - float(np.dot(xi_hat, eta_hat)) * eta_hat
        xi_hat /= np.linalg.norm(xi_hat)
        zeta_hat = np.cross(xi_hat, eta_hat)
        zeta_hat /= np.linalg.norm(zeta_hat)

    b_xi = float(np.dot(r_rel, xi_hat))
    b_zeta = float(np.dot(r_rel, zeta_hat))
    eta_residual = float(np.dot(r_rel, eta_hat))

    speed_a = float(np.linalg.norm(v_a))
    speed_b = float(np.linalg.norm(v_b))
    if speed_a > 1e-9 and speed_b > 1e-9:
        cos_angle = float(np.dot(v_a, v_b)) / (speed_a * speed_b)
        encounter_angle = math.degrees(math.acos(max(-1.0, min(1.0, cos_angle))))
    else:
        encounter_angle = 0.0

    # A characteristic crossing time: how long the objects spend within one
    # miss distance of closest approach.  Useful for judging whether the
    # linear-encounter assumption holds.
    time_in_plane = (
        ca.miss_distance_km / v_rel_mag if v_rel_mag > 1e-9 else float("inf")
    )

    return BPlane(
        xi_hat=xi_hat,
        eta_hat=eta_hat,
        zeta_hat=zeta_hat,
        b_xi_km=b_xi,
        b_zeta_km=b_zeta,
        miss_distance_km=float(math.hypot(b_xi, b_zeta)),
        eta_residual_km=eta_residual,
        relative_speed_km_s=v_rel_mag,
        encounter_angle_deg=encounter_angle,
        time_in_plane_s=time_in_plane,
        degenerate_basis=degenerate,
        linear_assumption_valid=v_rel_mag >= SLOW_ENCOUNTER_KM_S,
    )


def relative_trajectory_in_plane(
    ca: ClosestApproach,
    bplane: BPlane,
    half_window_s: float = 60.0,
    samples: int = 61,
) -> dict[str, list[float]]:
    """
    The true relative trajectory around TCA, expressed in encounter-plane
    coordinates, for the 2D visualisation.

    This is computed by propagating BOTH objects with SGP4 across the window
    and projecting the real relative position -- it is not a straight line
    drawn through the miss vector.  Comparing the curve against the linear
    prediction is what lets the UI show whether the linear assumption holds.
    """
    from app.data.catalog import get_catalog

    catalog = get_catalog()
    obj_a = catalog.get(ca.norad_a)
    obj_b = catalog.get(ca.norad_b)
    if obj_a is None or obj_b is None:
        return {"t_s": [], "xi_km": [], "eta_km": [], "zeta_km": []}

    from app.propagation.sgp4_engine import propagate_many

    offsets = np.linspace(-half_window_s, half_window_s, samples)
    times = [ca.tca + timedelta(seconds=float(s)) for s in offsets]
    pos, _vel, err = propagate_many(
        [obj_a.element_set, obj_b.element_set],
        times,
        [obj_a.satrec, obj_b.satrec],
    )
    ok = (err[0] == 0) & (err[1] == 0)
    r_rel = pos[0] - pos[1]

    xi = r_rel @ bplane.xi_hat
    eta = r_rel @ bplane.eta_hat
    zeta = r_rel @ bplane.zeta_hat

    return {
        "t_s": [float(s) for s, k in zip(offsets, ok) if k],
        "xi_km": [float(v) for v, k in zip(xi, ok) if k],
        "eta_km": [float(v) for v, k in zip(eta, ok) if k],
        "zeta_km": [float(v) for v, k in zip(zeta, ok) if k],
    }

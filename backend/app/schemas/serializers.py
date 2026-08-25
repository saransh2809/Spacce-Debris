"""
KAKSHA -- domain objects to API payloads.

Serialisation rules that the whole API obeys:

  * Every numerical value carries its UNITS in the field name (``_km``,
    ``_km_s``, ``_deg``, ``_s``).  No bare numbers.
  * Every state carries its FRAME.
  * Every derived result carries its PROVENANCE -- which element sets, which
    epochs, which model, which validation status.
  * Values that are unavailable are ``null`` with an accompanying reason, never
    a plausible-looking default.
  * NaN and infinity are converted to ``null``: they are not valid JSON, and
    silently emitting them produces a client-side parse error that looks like a
    network fault instead of a numerical one.
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any

import numpy as np

from app.core.frames import (
    itrf_to_geodetic,
    orbital_elements,
    teme_to_itrf,
)
from app.core.timebase import iso
from app.conjunction.encounter import ConjunctionEvent, ScreeningRun
from app.data.catalog import CatalogObject
from app.propagation.sgp4_engine import StateVector
from app.validation.engine import ValidationResult


def num(value: Any) -> float | None:
    """Finite float, or None.  The only numeric emitter used in this module."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def vec(v: Any) -> list[float | None] | None:
    if v is None:
        return None
    return [num(x) for x in np.asarray(v, dtype=float).ravel()]


def serialize_object(
    obj: CatalogObject, at: datetime | None = None, brief: bool = False
) -> dict:
    """Catalogue metadata for one object.  No propagated state -- see below."""
    age = obj.age_days(at)
    base = {
        "norad_id": obj.norad_id,
        "name": obj.name,
        "object_type": str(obj.object_type),
        "country": obj.meta.country,
        "country_iso": obj.meta.country_iso,
        "operator": obj.meta.operator,
        "attribution_available": obj.meta.attribution_available,
        "regime": str(obj.regime),
    }
    if brief:
        return base

    return {
        **base,
        "intl_designator": obj.element_set.intl_designator,
        "classification": obj.element_set.classification,
        "launch_date": obj.meta.launch_date,
        "rcs_m2": num(obj.meta.rcs_m2),
        "rcs_available": obj.meta.rcs_m2 is not None,
        "ops_status_code": obj.meta.ops_status,
        "apogee_km": num(obj.apogee_km),
        "perigee_km": num(obj.perigee_km),
        "propagation_model": obj.model,
        "element_set": {
            "epoch": iso(obj.element_set.epoch),
            "age_days": num(age),
            "is_stale": obj.is_stale(at),
            "element_set_number": obj.element_set.element_set_number,
            "rev_at_epoch": obj.element_set.rev_at_epoch,
            "mean_motion_rev_day": num(obj.element_set.mean_motion_rev_day),
            "eccentricity": num(obj.element_set.eccentricity),
            "inclination_deg": num(obj.element_set.inclination_deg),
            "raan_deg": num(obj.element_set.raan_deg),
            "arg_perigee_deg": num(obj.element_set.arg_perigee_deg),
            "mean_anomaly_deg": num(obj.element_set.mean_anomaly_deg),
            "bstar": num(obj.element_set.bstar),
            "period_min": num(obj.element_set.period_min),
            "semi_major_axis_km": num(obj.element_set.semi_major_axis_km),
            "source": obj.element_set.source,
            "element_type": "SGP4 mean elements (TEME)",
        },
    }


def serialize_state(state: StateVector, include_geodetic: bool = True) -> dict:
    """
    A propagated state.

    Emits the inertial TEME vectors AND, separately, the Earth-fixed geodetic
    projection -- clearly labelled, so nothing downstream can confuse the two.
    """
    payload: dict[str, Any] = {
        "norad_id": state.norad_id,
        "time": iso(state.time),
        "frame": str(state.frame),
        "position_km": vec(state.position_km),
        "velocity_km_s": vec(state.velocity_km_s),
        "radius_km": num(state.radius_km),
        "speed_km_s": num(state.speed_km_s),
        "propagation_model": state.model,
        "element_epoch": iso(state.epoch) if state.epoch else None,
        "propagated_days_from_epoch": num(state.age_from_epoch_days),
    }

    if include_geodetic:
        r_itrf, v_itrf = teme_to_itrf(
            state.position_km, state.velocity_km_s, state.time
        )
        lat, lon, alt = itrf_to_geodetic(r_itrf)
        payload["earth_fixed"] = {
            "frame": "ITRF (polar motion neglected, UT1 approximated by UTC)",
            "position_km": vec(r_itrf),
            "velocity_km_s": vec(v_itrf),
            "latitude_deg": num(lat),
            "longitude_deg": num(lon),
            "altitude_km": num(alt),
            "altitude_reference": "WGS-84 ellipsoid (geodetic height)",
        }

    elements = orbital_elements(state.position_km, state.velocity_km_s)
    payload["osculating_elements"] = {
        k: num(v) for k, v in elements.items()
    }
    payload["osculating_elements"]["note"] = (
        "Osculating two-body elements from the propagated state. These are not "
        "the SGP4 mean elements in the TLE and will differ slightly."
    )
    return payload


def serialize_validation(v: ValidationResult) -> dict:
    return {
        "status": str(v.status),
        "summary": v.summary(),
        "displayable": v.is_displayable,
        "checks_total": len(v.checks),
        "checks_passed": sum(1 for c in v.checks if c.passed),
        "checks": [
            {
                "name": c.name,
                "passed": c.passed,
                "status": str(c.status),
                "detail": c.detail,
                "measured": num(c.measured),
                "tolerance": num(c.tolerance),
                "units": c.units,
            }
            for c in v.checks
        ],
    }


def serialize_bplane(event: ConjunctionEvent, include_ellipse: bool = True) -> dict:
    bp = event.bplane
    unc = event.uncertainty
    payload: dict[str, Any] = {
        "definition": (
            "Encounter plane normal to the relative velocity at TCA. "
            "eta = v_rel/|v_rel|; xi = (v_b x v_a)/|v_b x v_a|; zeta = xi x eta."
        ),
        "frame": str(bp.frame),
        "axes_teme": {
            "xi_hat": vec(bp.xi_hat),
            "eta_hat": vec(bp.eta_hat),
            "zeta_hat": vec(bp.zeta_hat),
        },
        "miss_vector_km": {"xi": num(bp.b_xi_km), "zeta": num(bp.b_zeta_km)},
        "miss_distance_km": num(bp.miss_distance_km),
        "out_of_plane_residual_km": num(bp.eta_residual_km),
        "out_of_plane_residual_note": (
            "At a correct TCA the relative position is perpendicular to the "
            "relative velocity, so this is zero to numerical precision. It is a "
            "direct check on the TCA solution."
        ),
        "relative_speed_km_s": num(bp.relative_speed_km_s),
        "encounter_angle_deg": num(bp.encounter_angle_deg),
        "crossing_time_s": num(bp.time_in_plane_s),
        "linear_assumption_valid": bp.linear_assumption_valid,
        "degenerate_basis": bp.degenerate_basis,
    }

    if include_ellipse:
        payload["uncertainty_ellipse"] = {
            "covariance_2d_km2": [[num(x) for x in row] for row in unc.covariance_2d_km2],
            "sigma_major_km": num(unc.sigma_major_km),
            "sigma_minor_km": num(unc.sigma_minor_km),
            "orientation_deg": num(unc.ellipse_orientation_deg),
            "source": str(unc.source),
            "is_measured": unc.source.value == "PUBLISHED",
        }
        payload["hard_body_radius_m"] = num(unc.hard_body_radius_m)
        payload["hard_body_radius_source"] = unc.hard_body_source
    return payload


def serialize_uncertainty(event: ConjunctionEvent) -> dict:
    u = event.uncertainty
    return {
        "source": str(u.source),
        "is_measured_covariance": u.source.value == "PUBLISHED",
        "object_a": {
            "norad_id": u.object_a.norad_id,
            "sigma_radial_km": num(u.object_a.sigma_radial_km),
            "sigma_in_track_km": num(u.object_a.sigma_in_track_km),
            "sigma_cross_track_km": num(u.object_a.sigma_cross_track_km),
            "rss_sigma_km": num(u.object_a.rss_sigma_km),
            "propagated_days_from_epoch": num(u.object_a.age_days),
        },
        "object_b": {
            "norad_id": u.object_b.norad_id,
            "sigma_radial_km": num(u.object_b.sigma_radial_km),
            "sigma_in_track_km": num(u.object_b.sigma_in_track_km),
            "sigma_cross_track_km": num(u.object_b.sigma_cross_track_km),
            "rss_sigma_km": num(u.object_b.rss_sigma_km),
            "propagated_days_from_epoch": num(u.object_b.age_days),
        },
        "combined_2d": {
            "sigma_major_km": num(u.sigma_major_km),
            "sigma_minor_km": num(u.sigma_minor_km),
            "orientation_deg": num(u.ellipse_orientation_deg),
        },
        "mahalanobis_distance": num(u.mahalanobis_distance),
        "miss_over_sigma": num(u.miss_over_sigma),
        "hard_body_radius_m": num(u.hard_body_radius_m),
        "hard_body_radius_source": u.hard_body_source,
        "conditional_encounter_probability": num(
            u.conditional_encounter_probability
        ),
        "is_operational_pc": u.is_operational_pc,
        "probability_label": (
            "Probability of collision"
            if u.is_operational_pc
            else "Conditional encounter probability (assumed covariance model)"
        ),
        "caveats": u.caveats,
    }


def serialize_event(
    event: ConjunctionEvent,
    now: datetime,
    detail: bool = False,
) -> dict:
    """
    One conjunction.

    `detail=False` returns the compact form used by the ranked left-rail list.
    `detail=True` adds full states, B-plane, uncertainty and validation -- the
    payload behind the right-hand analysis panel and the CALCULATIONS page.
    """
    ca = event.closest_approach
    compact = {
        "event_id": event.event_id,
        "rank": event.rank,
        "risk_category": str(event.risk.category),
        "risk_score": num(event.risk.score),
        "object_a": serialize_object(event.object_a, now, brief=True),
        "object_b": serialize_object(event.object_b, now, brief=True),
        "tca": iso(ca.tca),
        "hours_to_tca": num(event.hours_to_tca(now)),
        "miss_distance_km": num(ca.miss_distance_km),
        "relative_speed_km_s": num(ca.relative_speed_km_s),
        "radial_separation_km": num(ca.radial_separation_km),
        "validation_status": str(event.validation.status),
        "covariance_source": str(event.uncertainty.source),
    }
    if not detail:
        return compact

    return {
        **compact,
        "screening_window": {
            "start": iso(event.screen_start) if event.screen_start else None,
            "end": iso(event.screen_end) if event.screen_end else None,
            "computed_at": iso(event.computed_at) if event.computed_at else None,
        },
        "objects": {
            "a": serialize_object(event.object_a, now),
            "b": serialize_object(event.object_b, now),
        },
        "closest_approach": {
            "tca": iso(ca.tca),
            "frame": str(ca.frame),
            "miss_distance_km": num(ca.miss_distance_km),
            "relative_position_km": vec(ca.relative_position_km),
            "relative_velocity_km_s": vec(ca.relative_velocity_km_s),
            "relative_speed_km_s": num(ca.relative_speed_km_s),
            "solver": {
                "method": ca.method,
                "converged": ca.converged,
                "roots_examined": ca.iterations,
                "fine_samples": ca.fine_samples,
                "range_rate_residual_km2_s": num(ca.range_rate_residual_km2_s),
                "note": (
                    "TCA is found by solving r_rel . v_rel = 0 with Brent's method, "
                    "not by taking the minimum of a sampled grid."
                ),
            },
            "state_a": serialize_state(ca.state_a),
            "state_b": serialize_state(ca.state_b),
        },
        "bplane": serialize_bplane(event),
        "uncertainty": serialize_uncertainty(event),
        "validation": serialize_validation(event.validation),
        "risk": event.risk.explain(),
    }


def serialize_run(run: ScreeningRun, now: datetime, from_cache: bool) -> dict:
    """Screening-run envelope: results plus the diagnostics that justify them."""
    r = run.report
    return {
        "window": {
            "start": iso(run.start),
            "end": iso(run.end),
            "hours": num((run.end - run.start).total_seconds() / 3600.0),
        },
        "computed_at": iso(run.computed_at),
        "from_cache": from_cache,
        "screening_threshold_km": num(run.threshold_km),
        "counts": run.counts,
        "total_conjunctions": len(run.events),
        "rejected_by_validation": len(run.rejected_events),
        "pipeline": {
            "objects_considered": r.objects_considered,
            "pairs_geometrically_possible": r.pairs_geometrically_possible,
            "pairs_after_coarse_sweep": r.pairs_after_coarse_sweep,
            "candidates_refined": run.refined_candidates,
            "refinement_failures": run.refinement_failures,
            "coarse_steps": r.coarse_steps,
            "coarse_step_s": num(r.coarse_step_s),
            "coarse_gate_km": num(r.coarse_gate_km),
            "required_gate_km": num(r.required_gate_km),
            "gate_is_safe": r.gate_is_safe,
            "propagation_failures": r.propagation_failures,
            "chunks": r.chunks,
            "screening_ms": num(r.elapsed_ms),
            "total_ms": num(run.elapsed_ms),
            "notes": r.notes,
        },
        "events": [serialize_event(e, now) for e in run.events],
    }

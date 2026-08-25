"""
KAKSHA -- central configuration.

Every tunable that affects a NUMERICAL result lives here, not scattered through
the engines and never in the frontend.  Screening thresholds, risk-score
weights and uncertainty defaults are configuration, so a reviewer can read one
file and know exactly what produced a given risk category.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_prefix="KAKSHA_",
        extra="ignore",
    )

    # ---------------------------------------------------------------- service
    app_name: str = "KAKSHA"
    app_subtitle: str = "Space Situational Awareness"
    version: str = "1.0.0"
    debug: bool = True
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # ------------------------------------------------------------ orbital data
    # Celestrak GP (General Perturbations) API -- public, no credentials.
    # The provider is swappable; see app/data/providers.py.
    data_provider: str = "celestrak"
    celestrak_base: str = "https://celestrak.org/NORAD/elements/gp.php"
    # Groups pulled on refresh.  Order matters only for de-duplication priority.
    celestrak_groups: list[str] = [
        "active",
        "last-30-days",
        "cosmos-1408-debris",
        "fengyun-1c-debris",
        "iridium-33-debris",
        "cosmos-2251-debris",
        "starlink",
        "oneweb",
        "stations",
    ]
    cache_dir: Path = BASE_DIR / "data_cache"
    # A TLE older than this is flagged STALE by the validation engine.  SGP4
    # accuracy degrades roughly 1-3 km/day of propagation from epoch for LEO.
    tle_max_age_days: float = 14.0
    tle_warn_age_days: float = 7.0
    # Refresh cadence for the background catalog updater.
    catalog_refresh_minutes: int = 180
    http_timeout_s: float = 45.0

    # ------------------------------------------------------ screening pipeline
    # Broad phase: two objects cannot conjoin if their perigee/apogee shells do
    # not overlap within this pad.  Cheap O(n log n) filter before any O(n^2).
    apogee_perigee_pad_km: float = 50.0
    # Coarse propagation timestep for the sieve, seconds.  A 60 s step cannot
    # miss an encounter whose approach speed is < ~200 km/s given the coarse
    # gate below, which is comfortably above any LEO closing speed (~15 km/s).
    coarse_step_s: float = 60.0
    # Coarse distance gate: pairs never within this range in the coarse sweep
    # are discarded before refinement.
    coarse_gate_km: float = 150.0
    # Fine refinement bracket half-width around a coarse minimum, seconds.
    fine_bracket_s: float = 120.0
    # A refined close approach is only reported if the miss distance is below
    # this.  This is the SCREENING VOLUME -- the headline number in the UI.
    screening_threshold_km: float = 25.0
    # Default look-ahead window for conjunction screening, hours.
    default_screen_hours: float = 48.0
    # Hard cap on catalogue size fed to the screener in one request.
    max_screen_objects: int = 4000

    # ------------------------------------------------------------- uncertainty
    # When no covariance is published (the normal case for public TLE data) we
    # apply a DOCUMENTED, ASSUMED position-error model.  These are 1-sigma
    # values in the RIC/RSW frame at epoch, in kilometres, and they GROW with
    # time since epoch.  They are an engineering assumption, NOT a measurement,
    # and the API labels them as such everywhere.
    assumed_sigma_radial_km: float = 0.20
    assumed_sigma_in_track_km: float = 1.00
    assumed_sigma_cross_track_km: float = 0.40
    # In-track error growth dominates; km of additional 1-sigma per day of
    # propagation away from the element epoch.
    sigma_growth_in_track_km_per_day: float = 1.20
    sigma_growth_radial_km_per_day: float = 0.15
    sigma_growth_cross_track_km_per_day: float = 0.30
    # Assumed hard-body radius when object dimensions are unknown, metres.
    default_hard_body_radius_m: float = 5.0

    # ------------------------------------------------------------- risk engine
    # Category boundaries on the composite risk score (0-100).
    risk_critical_score: float = 75.0
    risk_high_score: float = 55.0
    risk_moderate_score: float = 30.0
    # Component weights -- must sum to 1.0 (asserted at import).
    w_miss_distance: float = 0.40
    w_uncertainty_ratio: float = 0.30
    w_relative_velocity: float = 0.15
    w_time_to_tca: float = 0.10
    w_object_class: float = 0.05

    # -------------------------------------------------------------------- LLM
    anthropic_api_key: str = ""
    llm_model: str = "claude-opus-5"
    llm_max_tokens: int = 1200
    llm_enabled: bool = True

    @property
    def risk_weights_sum(self) -> float:
        return (
            self.w_miss_distance
            + self.w_uncertainty_ratio
            + self.w_relative_velocity
            + self.w_time_to_tca
            + self.w_object_class
        )


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.cache_dir.mkdir(parents=True, exist_ok=True)
    if abs(s.risk_weights_sum - 1.0) > 1e-9:
        raise ValueError(
            f"Risk engine weights must sum to 1.0, got {s.risk_weights_sum}"
        )
    return s


settings = get_settings()

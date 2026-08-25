/**
 * KAKSHA -- API response types.
 *
 * These mirror the backend serialisers. Note what is NOT here: there is no
 * type for "compute a position" or "score a risk", because the frontend does
 * neither. It receives finished numbers and renders them.
 */

export type RiskCategory = "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
export type ValidationStatus =
  | "VALIDATED"
  | "WARNING"
  | "INVALID"
  | "INSUFFICIENT_DATA";
export type CovarianceSource = "PUBLISHED" | "ASSUMED_MODEL" | "UNAVAILABLE";
export type ObjectTypeName =
  | "ACTIVE_SATELLITE"
  | "INACTIVE_SATELLITE"
  | "DEBRIS"
  | "ROCKET_BODY"
  | "SPACE_STATION"
  | "UNKNOWN";
export type Regime = "LEO" | "MEO" | "GEO" | "HEO" | "UNKNOWN";

export interface ObjectBrief {
  norad_id: number;
  name: string;
  object_type: ObjectTypeName;
  country: string;
  country_iso: string;
  operator: string;
  attribution_available: boolean;
  regime: Regime;
}

export interface ElementSetInfo {
  epoch: string;
  age_days: number | null;
  is_stale: boolean;
  element_set_number: number;
  rev_at_epoch: number;
  mean_motion_rev_day: number | null;
  eccentricity: number | null;
  inclination_deg: number | null;
  raan_deg: number | null;
  arg_perigee_deg: number | null;
  mean_anomaly_deg: number | null;
  bstar: number | null;
  period_min: number | null;
  semi_major_axis_km: number | null;
  source: string;
  element_type: string;
}

export interface ObjectDetail extends ObjectBrief {
  intl_designator: string;
  classification: string;
  launch_date: string | null;
  rcs_m2: number | null;
  rcs_available: boolean;
  ops_status_code: string;
  apogee_km: number | null;
  perigee_km: number | null;
  propagation_model: string;
  element_set: ElementSetInfo;
}

export interface EarthFixed {
  frame: string;
  position_km: (number | null)[];
  velocity_km_s: (number | null)[];
  latitude_deg: number | null;
  longitude_deg: number | null;
  altitude_km: number | null;
  altitude_reference: string;
}

export interface StateVector {
  norad_id: number;
  time: string;
  frame: string;
  position_km: (number | null)[];
  velocity_km_s: (number | null)[];
  radius_km: number | null;
  speed_km_s: number | null;
  propagation_model: string;
  element_epoch: string | null;
  propagated_days_from_epoch: number | null;
  earth_fixed?: EarthFixed;
  osculating_elements: Record<string, number | string | null>;
}

export interface ObjectResponse {
  object: ObjectDetail;
  time: string;
  state: StateVector | null;
  propagation_status: "OK" | "FAILED";
  propagation_error?: string;
}

export interface CountryNode {
  country: string;
  iso: string;
  count: number;
  operators: { operator: string; count: number }[];
}

export interface CatalogSummary {
  total_objects: number;
  by_type: Record<string, number>;
  by_regime: Record<string, number>;
  by_country: Record<string, number>;
  country_tree: CountryNode[];
  stale_objects: number;
  attribution_missing: number;
  rejected_records: number;
  rejection_reasons: Record<string, number>;
  data: {
    provider: string;
    retrieved_at: string | null;
    data_age_seconds: number | null;
    median_element_age_days: number | null;
    served_from_cache: boolean;
    degraded: boolean;
    notes: string[];
    group_counts: Record<string, number>;
    nature_of_data: string;
  };
  object_types: string[];
  regimes: string[];
}

export interface SceneResponse {
  time: string;
  frame: string;
  frame_note?: string;
  count: number;
  failed: number;
  requested?: number;
  norad_ids: number[];
  positions_km: number[];
  type_codes: number[];
  country_iso: string[];
  type_order: string[];
  gmst_rad: number;
  sun_direction_teme: number[];
  earth_radius_km: number;
}

export interface ClockState {
  mode: "REAL_TIME" | "SIMULATION";
  simulation_time: string;
  wall_time: string;
  offset_seconds: number;
  rate: number;
  paused: boolean;
  gmst_rad: number;
  sun_direction_teme: number[];
  allowed_rates: number[];
  note: string;
}

export interface RiskComponent {
  name: string;
  raw_value: number;
  units: string;
  normalised: number;
  weight: number;
  points_contributed: number;
  explanation: string;
}

export interface RiskExplain {
  score: number;
  category: RiskCategory;
  formula: string;
  category_boundaries: Record<string, number>;
  components: RiskComponent[];
  notes: string[];
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  status: ValidationStatus;
  detail: string;
  measured: number | null;
  tolerance: number | null;
  units: string;
}

export interface ValidationBlock {
  status: ValidationStatus;
  summary: string;
  displayable: boolean;
  checks_total: number;
  checks_passed: number;
  checks: ValidationCheck[];
}

export interface ConjunctionBrief {
  event_id: string;
  rank: number;
  risk_category: RiskCategory;
  risk_score: number;
  object_a: ObjectBrief;
  object_b: ObjectBrief;
  tca: string;
  hours_to_tca: number;
  miss_distance_km: number;
  relative_speed_km_s: number;
  radial_separation_km: number | null;
  validation_status: ValidationStatus;
  covariance_source: CovarianceSource;
}

export interface BPlaneBlock {
  definition: string;
  frame: string;
  axes_teme: {
    xi_hat: (number | null)[];
    eta_hat: (number | null)[];
    zeta_hat: (number | null)[];
  };
  miss_vector_km: { xi: number | null; zeta: number | null };
  miss_distance_km: number | null;
  out_of_plane_residual_km: number | null;
  out_of_plane_residual_note: string;
  relative_speed_km_s: number | null;
  encounter_angle_deg: number | null;
  crossing_time_s: number | null;
  linear_assumption_valid: boolean;
  degenerate_basis: boolean;
  uncertainty_ellipse?: {
    covariance_2d_km2: (number | null)[][];
    sigma_major_km: number | null;
    sigma_minor_km: number | null;
    orientation_deg: number | null;
    source: CovarianceSource;
    is_measured: boolean;
  };
  hard_body_radius_m?: number | null;
  hard_body_radius_source?: string;
}

export interface UncertaintyBlock {
  source: CovarianceSource;
  is_measured_covariance: boolean;
  object_a: Record<string, number | null>;
  object_b: Record<string, number | null>;
  combined_2d: {
    sigma_major_km: number | null;
    sigma_minor_km: number | null;
    orientation_deg: number | null;
  };
  mahalanobis_distance: number | null;
  miss_over_sigma: number | null;
  hard_body_radius_m: number | null;
  hard_body_radius_source: string;
  conditional_encounter_probability: number | null;
  is_operational_pc: boolean;
  probability_label: string;
  caveats: string[];
}

export interface ConjunctionDetail extends ConjunctionBrief {
  screening_window: {
    start: string | null;
    end: string | null;
    computed_at: string | null;
  };
  objects: { a: ObjectDetail; b: ObjectDetail };
  closest_approach: {
    tca: string;
    frame: string;
    miss_distance_km: number | null;
    relative_position_km: (number | null)[];
    relative_velocity_km_s: (number | null)[];
    relative_speed_km_s: number | null;
    solver: {
      method: string;
      converged: boolean;
      roots_examined: number;
      fine_samples: number;
      range_rate_residual_km2_s: number | null;
      note: string;
    };
    state_a: StateVector;
    state_b: StateVector;
  };
  bplane: BPlaneBlock;
  uncertainty: UncertaintyBlock;
  validation: ValidationBlock;
  risk: RiskExplain;
}

export interface PipelineReport {
  objects_considered: number;
  pairs_geometrically_possible: number;
  pairs_after_coarse_sweep: number;
  candidates_refined: number;
  refinement_failures: number;
  coarse_steps: number;
  coarse_step_s: number | null;
  coarse_gate_km: number | null;
  required_gate_km: number | null;
  gate_is_safe: boolean;
  propagation_failures: number;
  chunks: number;
  screening_ms: number | null;
  total_ms: number | null;
  notes: string[];
}

export interface ScreeningResponse {
  window: { start: string; end: string; hours: number | null };
  computed_at: string;
  from_cache: boolean;
  screening_threshold_km: number | null;
  counts: Record<RiskCategory, number>;
  total_conjunctions: number;
  rejected_by_validation: number;
  pipeline: PipelineReport;
  events: ConjunctionBrief[];
  returned?: number;
}

export interface ConjunctionSummary {
  counts: Record<RiskCategory, number>;
  total_conjunctions: number;
  rejected_by_validation: number;
  window_hours: number | null;
  screening_threshold_km: number | null;
  computed_at: string;
  from_cache: boolean;
  closest: ConjunctionBrief | null;
  soonest: ConjunctionBrief | null;
}

export interface OrbitTrack {
  norad_id: number;
  name: string;
  frame: string;
  time: string;
  period_min: number | null;
  revolutions: number;
  vertex_count: number;
  failed_samples: number;
  positions_km: number[];
  start: string;
  end: string;
}

export interface BPlaneResponse {
  event_id: string;
  tca: string;
  object_a: { norad_id: number; name: string };
  object_b: { norad_id: number; name: string };
  bplane: BPlaneBlock;
  uncertainty: UncertaintyBlock;
  relative_trajectory: {
    t_s: number[];
    xi_km: number[];
    eta_km: number[];
    zeta_km: number[];
  };
  trajectory_note: string;
  validation: ValidationBlock;
}

export interface ProfileResponse {
  event_id: string;
  tca: string;
  miss_distance_km: number | null;
  t_offset_s: (number | null)[];
  separation_km: (number | null)[];
  range_rate_km_s: (number | null)[];
  note: string;
}

export interface ExplainResponse {
  event_id: string;
  rank: number;
  risk_category: RiskCategory;
  explanation: string;
  model: string;
  source: "llm" | "deterministic-template";
  numeric_audit: {
    passed: boolean;
    numbers_found: number;
    numbers_verified: number;
    unverified_values: number[];
    notes: string[];
    method: string;
  };
  claim_violations: string[];
  verified: boolean;
  elapsed_ms: number;
  error: string | null;
  guarantee: string;
}

export interface Histogram {
  bin_edges: number[];
  counts: number[];
  excluded: number;
  total: number;
}

export interface AnalysisResponse {
  computed_at: string;
  from_cache: boolean;
  window_hours: number | null;
  total_conjunctions: number;
  risk_distribution: Record<RiskCategory, number>;
  miss_distance_histogram: Histogram;
  relative_velocity_histogram: Histogram;
  uncertainty_ratio_histogram: Histogram;
  encounter_angle_histogram: Histogram;
  conjunctions_per_hour: {
    buckets: number;
    hours_per_bucket: number | null;
    counts: number[];
  };
  partner_country_distribution: Record<string, number>;
  partner_type_distribution: Record<string, number>;
  catalog_distribution: {
    by_type: Record<string, number>;
    by_regime: Record<string, number>;
    by_country: Record<string, number>;
  };
  extremes: {
    closest: ConjunctionBrief | null;
    fastest: ConjunctionBrief | null;
    soonest: ConjunctionBrief | null;
  };
  top_events: ConjunctionBrief[];
}

export interface ValidationPageResponse {
  computed_at: string;
  from_cache: boolean;
  data_quality: {
    provider: string;
    retrieved_at: string | null;
    data_age_seconds: number | null;
    served_from_cache: boolean;
    degraded: boolean;
    notes: string[];
    total_objects: number;
    median_element_age_days: number | null;
    stale_objects: number;
    stale_threshold_days: number;
    warn_threshold_days: number;
    rejected_records: number;
    rejection_reasons: Record<string, number>;
    attribution_missing: number;
  };
  catalog_validation: ValidationBlock;
  conjunction_validation: {
    status_counts: Record<string, number>;
    check_totals: Record<string, { passed: number; failed: number }>;
    rejected_events: (ConjunctionBrief & { failed_checks: string[] })[];
  };
  pipeline_diagnostics: Record<string, number | boolean | null>;
  uncertainty_model: Record<string, unknown>;
  risk_model: Record<string, unknown>;
  stated_limitations: string[];
}

export interface MethodologyResponse {
  pipeline: string[];
  frames: Record<string, string>;
  tca_method: Record<string, string>;
  screening: Record<string, number | string>;
  risk: Record<string, unknown>;
  uncertainty: Record<string, unknown>;
  terminology: Record<string, string>;
}

export interface DebugResponse {
  clock: Record<string, string | number | boolean | null>;
  catalog: Record<string, string | number | boolean | null>;
  screening_cache: Record<string, unknown>[];
  config: Record<string, string | number | boolean>;
  recent_events: Record<string, unknown>[];
  server_time: string;
}

export interface EnvironmentResponse {
  time: string;
  gmst_rad: number;
  gmst_deg: number;
  sun_direction_teme: number[];
  sun_model: string;
  earth_radius_km: number;
  earth_flattening: number;
}

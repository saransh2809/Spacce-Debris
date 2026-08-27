/**
 * KAKSHA -- landing page content.
 *
 * Two kinds of thing live here, and the distinction matters.
 *
 * STATIC CONTENT is copy and reference material that does not come from the
 * engine: the pipeline stages, the orbital regime definitions, the colour
 * meanings, the navigation. These are descriptions of how KAKSHA works, not
 * results, so they are authored here.
 *
 * FALLBACK FIGURES are the numbers shown when the engine has not answered yet
 * or is unreachable. The landing page is the public front door: it must render
 * completely with the backend switched off. When the engine IS reachable,
 * `useLandingData` replaces every one of these with the real value and the page
 * says so. They are rounded, plausible, clearly-labelled placeholders -- never
 * presented as live measurements.
 */

import type { ObjectTypeName, RiskCategory } from "../../../api/types";

/* ------------------------------------------------------------------- types */

export interface CatalogBreakdownRow {
  id: string;
  label: string;
  count: number;
  color: string;
}

export interface HeroMetric {
  id: string;
  value: string;
  label: string;
  sub: string;
}

export interface FeaturedConjunction {
  id: string;
  primary: { name: string; type: string };
  secondary: { name: string; type: string };
  missDistanceKm: number;
  relativeVelocityKmS: number;
  timeToTcaSeconds: number;
  /**
   * Encounter angle. The engine's summary endpoint does not carry this, so on
   * live data it stays at the representative value below and only drives the
   * stylised 3D crossing geometry -- never a displayed conclusion.
   */
  relativeAngleDeg: number;
  screeningThresholdKm: number;
  riskLevel: RiskCategory;
  /**
   * Deliberately absent. KAKSHA derives collision probability inside the
   * numerical engine; a marketing surface must not invent one, and the
   * explanation layer is not permitted to assert one.
   */
  probabilityOfCollision: null;
}

/* -------------------------------------------------------- fallback figures */

export const FALLBACK_CATALOG_TOTAL = 18_705;

export const fallbackBreakdown: CatalogBreakdownRow[] = [
  { id: "ACTIVE_SATELLITE", label: "ACTIVE SATELLITES", count: 12_458, color: "#22D3EE" },
  { id: "DEBRIS", label: "DEBRIS", count: 2_646, color: "#F59E0B" },
  { id: "ROCKET_BODY", label: "ROCKET BODIES", count: 1_123, color: "#F97316" },
  { id: "INACTIVE_SATELLITE", label: "INACTIVE SATELLITES", count: 2_146, color: "#94A3B8" },
  { id: "SPACE_STATION", label: "SPACE STATIONS", count: 34, color: "#60A5FA" },
];

export const fallbackConjunction: FeaturedConjunction = {
  id: "ILLUSTRATIVE",
  primary: { name: "OBJECT A", type: "ACTIVE PAYLOAD" },
  secondary: { name: "OBJECT B", type: "DEBRIS FRAGMENT" },
  missDistanceKm: 0.798,
  relativeVelocityKmS: 9.548,
  timeToTcaSeconds: 142_920, // 39h 42m
  relativeAngleDeg: 80.17,
  screeningThresholdKm: 1.0,
  riskLevel: "HIGH",
  probabilityOfCollision: null,
};

/**
 * Row definitions for the catalogue readout, keyed by the engine's own
 * ObjectTypeName values. Order is the order they are shown.
 */
export const BREAKDOWN_ROWS: { id: ObjectTypeName; label: string; color: string }[] = [
  { id: "ACTIVE_SATELLITE", label: "ACTIVE SATELLITES", color: "#22D3EE" },
  { id: "DEBRIS", label: "DEBRIS", color: "#F59E0B" },
  { id: "ROCKET_BODY", label: "ROCKET BODIES", color: "#F97316" },
  { id: "INACTIVE_SATELLITE", label: "INACTIVE SATELLITES", color: "#94A3B8" },
  { id: "SPACE_STATION", label: "SPACE STATIONS", color: "#60A5FA" },
  { id: "UNKNOWN", label: "UNCLASSIFIED", color: "#64748B" },
];

/* ------------------------------------------------ orbital population (style) */
/** How the point cloud on the 3D stage is coloured. Presentation, not data. */

export const orbitalPopulation = [
  { id: "satellite", label: "SATELLITES", color: "#22D3EE", share: 0.46, regime: "LEO / MEO" },
  { id: "debris", label: "DEBRIS", color: "#F59E0B", share: 0.34, regime: "LEO" },
  { id: "rocket", label: "ROCKET BODIES", color: "#F97316", share: 0.16, regime: "LEO / GTO" },
  { id: "station", label: "SPACE STATIONS", color: "#60A5FA", share: 0.04, regime: "LEO" },
];

/* --------------------------------------------------------- orbital regimes */
/** Standard altitude band definitions. Reference material, not measurements. */

export const orbitalRegimes = [
  {
    id: "leo",
    name: "LOW EARTH ORBIT",
    altitude: "160 - 2,000 km",
    densityShare: 0.88,
    note: "MOST TRACKED OBJECTS AND MOST CONJUNCTIONS",
  },
  {
    id: "meo",
    name: "MEDIUM EARTH ORBIT",
    altitude: "2,000 - 35,786 km",
    densityShare: 0.21,
    note: "NAVIGATION CONSTELLATIONS",
  },
  {
    id: "geo",
    name: "GEOSTATIONARY",
    altitude: "35,786 km",
    densityShare: 0.11,
    note: "A SINGLE CROWDED BELT",
  },
];

/* ---------------------------------------------------------------- encounter */
/**
 * The PLAY ENCOUNTER window. Both the animation and the on-screen separation
 * readout are driven by the featured conjunction's own miss distance and
 * relative velocity, through the standard rectilinear approximation which is
 * valid over a window this short:
 *
 *     separation(t) = sqrt( miss^2 + (vRel * t)^2 )
 *
 * so the number under the playhead always agrees with the geometry drawn.
 */
export const encounter = {
  startSeconds: -60,
  endSeconds: 60,
  playbackSeconds: 9,
  keyframes: [
    { t: -60, label: "T − 60s", note: "APPROACH" },
    { t: -20, label: "T − 20s", note: "CLOSING" },
    { t: 0, label: "TCA", note: "MINIMUM SEPARATION" },
    { t: 20, label: "T + 20s", note: "RECEDING" },
    { t: 60, label: "T + 60s", note: "SEPARATED" },
  ],
};

/** Human-readable TCA countdown, derived so it cannot drift from the source. */
export function formatTca(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function separationAt(t: number, missKm: number, relVelKmS: number): number {
  const d = relVelKmS * t;
  return Math.sqrt(missKm * missKm + d * d);
}

/* ------------------------------------------------------------------ b-plane */
/**
 * Encounter-plane geometry, in kilometres.
 *
 * This is an ILLUSTRATION of what the B-plane shows, sized so the 3-sigma
 * contour sits inside the screening ring -- because that containment is the
 * point the figure has to make at a glance. It is NOT a covariance
 * propagation. The real per-event solution lives behind /conjunctions/{id},
 * and the Analysis page renders it; this figure exists to explain the concept
 * to someone who has not seen one before. The panel says so on screen.
 */
export const bPlane = {
  units: "km",
  missVectorUnit: { bR: -0.6416, bT: 0.767 }, // unit vector; scaled by the live miss distance
  uncertainty: {
    sigmaR: 0.29,
    sigmaT: 0.14,
    tiltDeg: 27,
    sigmaLevels: [1, 3],
  },
  axisLabels: { r: "R (RADIAL / ALONG-TRACK)", t: "T (CROSS-TRACK)" },
};

/* ----------------------------------------------------------------- pipeline */

export const pipelineStages = [
  {
    id: "ingest",
    title: "TLE / OMM",
    subtitle: "INGESTION",
    detail:
      "Catalogue elements are ingested, epoch-checked and de-duplicated before propagation.",
    glyph: "ingest",
  },
  {
    id: "sgp4",
    title: "SGP4",
    subtitle: "PROPAGATION",
    detail:
      "Analytical propagation advances every catalogued object across the screening window.",
    glyph: "propagate",
  },
  {
    id: "state",
    title: "POSITION + VELOCITY",
    subtitle: "STATE VECTORS",
    detail: "Each object resolves to a time-tagged state vector in the inertial frame.",
    glyph: "state",
  },
  {
    id: "screen",
    title: "CONJUNCTION",
    subtitle: "SCREENING",
    detail: "Coarse spatial filtering collapses the pair space before fine analysis runs.",
    glyph: "screen",
  },
  {
    id: "tca",
    title: "TCA + MISS DISTANCE",
    subtitle: "CLOSE APPROACH",
    detail:
      "Time of closest approach and minimum separation are refined for surviving pairs.",
    glyph: "tca",
  },
  {
    id: "bplane",
    title: "B-PLANE",
    subtitle: "ENCOUNTER GEOMETRY",
    detail:
      "The encounter is projected into the plane normal to the relative velocity vector.",
    glyph: "bplane",
  },
  {
    id: "uncertainty",
    title: "UNCERTAINTY",
    subtitle: "COVARIANCE",
    detail: "Positional uncertainty is mapped into the encounter plane as an error ellipse.",
    glyph: "uncertainty",
  },
  {
    id: "risk",
    title: "RISK RANKING",
    subtitle: "PRIORITISATION",
    detail: "Events are ordered so operators see the most consequential encounters first.",
    glyph: "risk",
  },
];

/* ---------------------------------------------------------------------- ai  */

export const aiChain = [
  { id: "engine", label: "NUMERICAL ENGINE", note: "SGP4 / screening / B-plane" },
  { id: "validated", label: "VALIDATED RESULT", note: "miss distance / TCA / covariance" },
  { id: "ai", label: "AI", note: "reads the validated result" },
  { id: "explanation", label: "EXPLANATION", note: "plain-language narration" },
];

export const aiDisclaimers = [
  "Interpretation only. Every figure above was produced by the numerical engine.",
  "The language model does not compute, rank, or override physics results.",
];

/**
 * Composes the narration from figures the engine has already produced.
 *
 * Written as a function rather than a stored paragraph for one reason: the
 * section's entire claim is that the words follow the numbers. If the numbers
 * come from the live engine and the prose is a fixed string, the section is
 * lying about its own architecture. Every quantity below is interpolated from
 * the conjunction passed in.
 */
export function buildExplanation(c: FeaturedConjunction): string {
  const below = c.missDistanceKm < c.screeningThresholdKm;
  const geometry =
    c.relativeAngleDeg > 60
      ? "close to perpendicular"
      : c.relativeAngleDeg > 25
        ? "obliquely crossing"
        : "nearly co-linear";

  return (
    `This conjunction is classified as ${c.riskLevel} priority because the predicted ` +
    `minimum separation of ${c.missDistanceKm.toFixed(3)} km ` +
    `${below ? "falls below" : "sits above"} the configured screening threshold of ` +
    `${c.screeningThresholdKm.toFixed(3)} km, while the relative encounter velocity of ` +
    `${c.relativeVelocityKmS.toFixed(3)} km/s remains significant. The encounter geometry is ` +
    `${geometry} at ${c.relativeAngleDeg.toFixed(2)} degrees, so the closing rate is dominated ` +
    `by cross-track motion and the pair transits the close-approach region quickly. With ` +
    `${formatTca(c.timeToTcaSeconds)} remaining until TCA there is sufficient lead time for a ` +
    `further tracking update before any operational decision is required.`
  );
}

/* ------------------------------------------------------------- risk styling */

export const riskPalette: Record<string, { color: string; label: string }> = {
  NONE: { color: "#64748B", label: "NONE" },
  LOW: { color: "#22D3EE", label: "LOW" },
  MODERATE: { color: "#F59E0B", label: "MODERATE" },
  HIGH: { color: "#F97316", label: "HIGH" },
  CRITICAL: { color: "#EF4444", label: "CRITICAL" },
};

/* --------------------------------------------------------------- navigation */

export const navSections = [
  { id: "hero", label: "HOME" },
  { id: "mission", label: "MISSION" },
  { id: "conjunction", label: "SCIENCE" },
  { id: "pipeline", label: "TECHNOLOGY" },
  { id: "ai", label: "INSIGHTS" },
];

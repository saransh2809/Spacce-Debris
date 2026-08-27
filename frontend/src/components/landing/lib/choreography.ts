/**
 * SCROLL CHOREOGRAPHY
 * ===================
 * The narrative of spec 12 written as data. One keyframe per section; the scene
 * director interpolates between them from the scroll position, so the 3D stage
 * reads as one continuous camera move rather than seven unrelated scenes.
 *
 *   EARTH -> ORBITAL ENVIRONMENT -> CONJUNCTION -> PIPELINE
 *         -> B-PLANE -> AI EXPLANATION -> MISSION CONTROL
 *
 * Units: Earth radius = 1.
 */

/** DOM ids, in scroll order. Section elements register against these. */
export const SECTION_IDS = [
  'hero',
  'mission',
  'conjunction',
  'pipeline',
  'bplane',
  'ai',
  'cta',
]

/**
 * Where the featured close approach is staged.
 *
 * Deliberately well clear of the surface. At a realistic LEO altitude the
 * encounter sits directly against Earth's disc from every camera angle — the
 * planet is simply too close and too large — and the two objects disappear into
 * the lit limb. Standing the encounter off gives it dark sky to read against
 * while Earth stays in frame as the horizon it belongs to.
 */
export const TCA_POINT: [number, number, number] = [1.913, 0.864, 1.164]

/**
 * Camera keyframes.
 *
 *   look        world point the camera orbits
 *   dist        distance from `look`
 *   yaw/pitch   spherical placement around `look` (radians)
 *   subjectX/Y  where `look` should sit on screen, as a fraction of the half
 *               viewport. +0.34 puts the subject a third of the way right of
 *               centre, which is what leaves room for the copy column on the
 *               left. Resolving this in screen space (rather than as a world
 *               offset) keeps framing stable across every viewport ratio.
 */
export interface CameraKeyframe {
  look: [number, number, number]
  dist: number
  yaw: number
  pitch: number
  subjectX: number
  subjectY: number
  /** Optional camera roll, in radians. */
  roll?: number
}

export interface LayerKeyframe {
  orbit: number
  rings: number
  pair: number
  earth: number
  stars: number
  atmosphere: number
}

export const CAMERA_KEYFRAMES: CameraKeyframe[] = [
  // 0 — HERO: Earth large, right of centre, headline on the left.
  { look: [0, 0, 0], dist: 5.5, yaw: 0.34, pitch: 0.12, subjectX: 0.32, subjectY: -0.02 },

  // 1 — MISSION: pull back and rise; the orbital shell becomes the subject.
  { look: [0, 0, 0], dist: 7.2, yaw: 0.86, pitch: 0.34, subjectX: 0.02, subjectY: 0.1 },

  // 2 — CONJUNCTION: dive to the encounter; everything else falls away.
  // yaw/pitch here are not arbitrary: they place the camera about 40 degrees off
  // the local radial at TCA, which is what shows the two crossing tracks close
  // to face-on. Viewing them edge-on foreshortens the whole encounter into a
  // couple of hundred pixels of near-invisible line.
  //
  // subjectX biases the encounter left of centre so the tracks -- and the
  // labels that ride on them -- stay clear of the readout panel on the right.
  { look: TCA_POINT, dist: 2.9, yaw: 1.77, pitch: 0.67, subjectX: -0.26, subjectY: 0.04 },

  // 3 — PIPELINE: Earth retreats to a small lit body far right, scene dims.
  { look: [0, 0, 0], dist: 11.0, yaw: 1.75, pitch: 0.14, subjectX: 0.98, subjectY: 0.12 },

  // 4 — B-PLANE: the 2D encounter-plane figure carries this section.
  { look: [0, 0, 0], dist: 11.5, yaw: 2.05, pitch: 0.05, subjectX: 0.86, subjectY: -0.1 },

  // 5 — AI: Earth crosses to the far left, leaving the panel column clear.
  { look: [0, 0, 0], dist: 11.0, yaw: 2.45, pitch: -0.03, subjectX: -0.86, subjectY: -0.05 },

  // 6 — CTA: drop to the limb. Earth becomes a horizon under the closing line.
  { look: [0, 0, 0], dist: 2.5, yaw: 3.0, pitch: -0.5, subjectX: 0.0, subjectY: -0.82 },
]

/**
 * Per-layer intensity. Same index space as the camera track.
 *   orbit      the instanced satellite / debris / rocket-body cloud
 *   rings      faint orbit-path lines
 *   pair       the two featured conjunction objects and their trails
 *   earth      Earth surface brightness multiplier
 *   stars      starfield brightness
 *   atmosphere rim-glow strength
 */
export const LAYER_KEYFRAMES: LayerKeyframe[] = [
  // 0 — HERO
  { orbit: 0.62, rings: 0.5, pair: 0.0, earth: 1.0, stars: 1.0, atmosphere: 1.0 },
  // 1 — MISSION: peak orbital density
  { orbit: 1.0, rings: 1.0, pair: 0.1, earth: 1.0, stars: 0.95, atmosphere: 0.95 },
  // 2 — CONJUNCTION: the crowd fades, two objects remain
  { orbit: 0.1, rings: 0.12, pair: 1.0, earth: 0.3, stars: 0.9, atmosphere: 0.5 },
  // 3 — PIPELINE
  { orbit: 0.1, rings: 0.09, pair: 0.0, earth: 0.3, stars: 0.75, atmosphere: 0.4 },
  // 4 — B-PLANE
  { orbit: 0.05, rings: 0.04, pair: 0.0, earth: 0.34, stars: 0.65, atmosphere: 0.4 },
  // 5 — AI
  { orbit: 0.05, rings: 0.04, pair: 0.0, earth: 0.36, stars: 0.65, atmosphere: 0.4 },
  // 6 — CTA: back up to full for the closing frame
  { orbit: 0.34, rings: 0.2, pair: 0.0, earth: 1.0, stars: 1.0, atmosphere: 1.15 },
]

/**
 * Sun direction for the day/night terminator, as a unit vector.
 * The prototype runs on a fixed, clearly-simulated presentation time (spec 8)
 * so the lit crescent is identical in every screenshot and review pass. Real
 * KAKSHA would derive this from the actual epoch instead.
 */
export const PRESENTATION_EPOCH = '2026-08-27T04:12:00Z'
/**
 * Chosen so the terminator sits roughly 70 degrees off the hero camera axis:
 * the planet is lit from the left, the night side (and its city lights) falls
 * on the right where the catalogue readout sits, and by the closing CTA the sun
 * is behind the limb — which is what turns that last shot into a night horizon.
 */
export const SUN_DIRECTION: [number, number, number] = [-0.78, 0.16, 0.6]

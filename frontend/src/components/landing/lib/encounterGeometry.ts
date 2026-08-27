/**
 * KAKSHA -- landing page encounter geometry.
 *
 * Builds the two crossing tracks drawn in the conjunction section, in the same
 * world units as the rest of the stage (Earth radius = 1).
 *
 * WHAT IS REAL
 *   The relative geometry is constructed properly: the two velocity directions
 *   are separated by a stated encounter angle, and the offset between the
 *   tracks is perpendicular to the relative velocity -- so closest approach
 *   genuinely falls at t = 0 and the separation curve genuinely has the shape
 *   sqrt(miss^2 + (vRel * t)^2).
 *
 * WHAT IS EXAGGERATED
 *   Scale, and only scale. A sub-kilometre miss against a 6371 km Earth radius
 *   is roughly a thousandth of a pixel, so the cross-track offset is magnified
 *   (see `missExaggeration`). The section states the factor on screen, and the
 *   numeric readout is always COMPUTED from the engine's values rather than
 *   measured off the drawing.
 *
 * The encounter angle here drives the stylised crossing only. It is never
 * displayed as a conclusion, because the summary endpoint does not carry it.
 */

import * as THREE from "three";
import { TCA_POINT } from "./choreography";
import { encounter } from "../data/landingContent";

const EARTH_RADIUS_KM = 6371;

/** Encounter angle used to lay out the crossing. Presentation only. */
const LAYOUT_ANGLE_DEG = 80.17;

/** Half-length of each drawn track, in world units. */
export const ARC_HALF_LENGTH = 0.78;
/** How far the tracks bow toward Earth across the window -- an orbital arc. */
export const ARC_BEND = 0.17;
/** Drawn cross-track separation at TCA, in world units. */
export const MISS_VISUAL = 0.16;

/** Magnification applied to the cross-track offset, for the on-screen note. */
export function missExaggeration(missKm: number): number {
  if (!missKm) return 0;
  return Math.round(MISS_VISUAL / (missKm / EARTH_RADIUS_KM));
}

/* ------------------------------------------------------------ local frame  */

const tca = new THREE.Vector3(...TCA_POINT);
/** Local radial ("up") direction at the encounter. */
const radial = tca.clone().normalize();

const e1 = new THREE.Vector3().crossVectors(radial, new THREE.Vector3(0, 1, 0)).normalize();
const e2 = new THREE.Vector3().crossVectors(radial, e1).normalize();

const angle = (LAYOUT_ANGLE_DEG * Math.PI) / 180;

/** Unit velocity directions, separated by the layout angle. */
export const dirA = e1.clone();
export const dirB = e1
  .clone()
  .multiplyScalar(Math.cos(angle))
  .addScaledVector(e2, Math.sin(angle));

/** Relative velocity direction. */
const relDir = dirA.clone().sub(dirB).normalize();

/**
 * The miss vector must be perpendicular to the relative velocity, or closest
 * approach would not land at t = 0. `radial` already satisfies that (relDir
 * lies in the e1/e2 plane), and so does relDir x radial -- any blend of the two
 * is valid. This blend simply reads well from the section's camera angle.
 */
const missDir = radial
  .clone()
  .multiplyScalar(0.72)
  .addScaledVector(new THREE.Vector3().crossVectors(relDir, radial).normalize(), 0.69)
  .normalize();

export const missOffset = missDir.clone().multiplyScalar(MISS_VISUAL);

/* ------------------------------------------------------------- track paths */

const _v = new THREE.Vector3();

/**
 * Position of a tracked object at time `t` seconds relative to TCA.
 *
 * `out` is required at call sites inside the render loop; the shared scratch
 * default exists only for one-off use during module setup.
 */
export function trackPosition(
  dir: THREE.Vector3,
  t: number,
  offset: THREE.Vector3 | null,
  out: THREE.Vector3 = _v,
): THREE.Vector3 {
  const s = t / encounter.endSeconds; // -1 .. 1 across the window
  out.copy(tca);
  out.addScaledVector(dir, s * ARC_HALF_LENGTH);
  out.addScaledVector(radial, -s * s * ARC_BEND);
  if (offset) out.add(offset);
  return out;
}

export function positionA(t: number, out: THREE.Vector3): THREE.Vector3 {
  return trackPosition(dirA, t, null, out);
}

export function positionB(t: number, out: THREE.Vector3): THREE.Vector3 {
  return trackPosition(dirB, t, missOffset, out);
}

export interface TrackRibbon {
  positions: Float32Array;
  params: Float32Array;
  indices: Uint16Array;
}

/**
 * Samples one track as a tapered ribbon.
 *
 * GL lines are one pixel wide on every desktop driver, far too thin for the
 * subject of a hero section. The ribbon is built in the local encounter plane,
 * offset perpendicular to the direction of travel, and tapered at both ends so
 * each track fades into the dark rather than stopping on a blunt edge.
 */
export function buildTrackRibbon(
  dir: THREE.Vector3,
  offset: THREE.Vector3 | null,
  segments = 168,
  halfWidth = 0.0095,
): TrackRibbon {
  const perp = new THREE.Vector3().crossVectors(radial, dir).normalize();

  const positions = new Float32Array((segments + 1) * 2 * 3);
  const params = new Float32Array((segments + 1) * 2);
  const indices = new Uint16Array(segments * 6);

  const v = new THREE.Vector3();
  const t0 = encounter.startSeconds;
  const t1 = encounter.endSeconds;

  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    const t = t0 + (t1 - t0) * s;
    trackPosition(dir, t, offset, v);

    // Taper: full width across the middle, drawn to a thread at the ends.
    const w = halfWidth * (0.18 + 0.82 * Math.pow(Math.sin(Math.PI * s), 0.4));

    const a = i * 2;
    const b = a + 1;
    positions[a * 3] = v.x + perp.x * w;
    positions[a * 3 + 1] = v.y + perp.y * w;
    positions[a * 3 + 2] = v.z + perp.z * w;
    positions[b * 3] = v.x - perp.x * w;
    positions[b * 3 + 1] = v.y - perp.y * w;
    positions[b * 3 + 2] = v.z - perp.z * w;
    params[a] = t;
    params[b] = t;

    if (i < segments) {
      const c = (i + 1) * 2;
      const d = c + 1;
      indices.set([a, b, c, b, d, c], i * 6);
    }
  }

  return { positions, params, indices };
}

/** World-space midpoint of the closest approach -- where the TCA marker sits. */
export const tcaMidpoint = positionA(0, new THREE.Vector3())
  .clone()
  .add(positionB(0, new THREE.Vector3()))
  .multiplyScalar(0.5);

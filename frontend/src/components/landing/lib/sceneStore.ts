/**
 * KAKSHA -- landing page scene director.
 *
 * One mutable module singleton holds the live scroll and pointer state. The
 * render loop reads it directly every frame, so scrolling never triggers a
 * React re-render -- which is what keeps the WebGL stage smooth while the DOM
 * content scrolls above it.
 *
 * A tiny subscription channel exists alongside it for the few things that
 * genuinely need React (the active navigation item). Those fire a handful of
 * times per scroll, not per frame.
 */

import { CAMERA_KEYFRAMES, LAYER_KEYFRAMES, SECTION_IDS } from "./choreography";

/* ------------------------------------------------------------------- types */

/** Per-layer intensities, mutated in place by the rig and read by each layer. */
export interface LayerState {
  orbit: number;
  rings: number;
  pair: number;
  earth: number;
  stars: number;
  atmosphere: number;
}

/** Interpolated camera placement for the current scroll position. */
export interface CameraState {
  lookX: number;
  lookY: number;
  lookZ: number;
  dist: number;
  yaw: number;
  pitch: number;
  subjectX: number;
  subjectY: number;
  roll: number;
}

export type CameraKey = keyof CameraState;

/* ------------------------------------------------------------------- state */

export const scene = {
  /** Continuous position along the narrative, 0 .. SECTION_IDS.length - 1 */
  stage: 0,
  /** Whole-document scroll progress, 0 .. 1 */
  progress: 0,
  scrollY: 0,
  viewportH: typeof window === "undefined" ? 900 : window.innerHeight,

  /** Smoothed pointer in -1..1, driving a very small camera parallax. */
  pointer: { x: 0, y: 0 },
  pointerTarget: { x: 0, y: 0 },

  /** Environment flags, resolved at bind time and on media-query changes. */
  reducedMotion: false,
  isMobile: false,

  /** PLAY ENCOUNTER interaction state. */
  encounter: {
    playing: false,
    /** Seconds relative to TCA; the section shows it live. */
    t: -60,
    /** True once the user has played it at least once. */
    everPlayed: false,
    /**
     * Wall-clock anchors for playback. Accumulating clamped frame deltas made
     * a run take far longer than its stated duration whenever the browser
     * throttled the frame loop; anchoring to performance.now() keeps it honest
     * at any frame rate.
     */
    playStartedAt: null as number | null,
    playFrom: -60,
  },

  /** Set true once the WebGL stage has created its renderer. */
  ready: false,
};

/* ----------------------------------------------------- section measurement */

const registry = new Map<string, HTMLElement>();
/** Document-space centre of each section, in SECTION_IDS order. */
let anchors: (number | null)[] = [];
/** Cached in measure(). update() runs per frame and must never force a reflow. */
let docHeight = 1;

export function registerSection(id: string, el: HTMLElement | null): void {
  if (!el) {
    registry.delete(id);
    return;
  }
  registry.set(id, el);
  measure();
}

export function measure(): void {
  const next: (number | null)[] = [];
  for (const id of SECTION_IDS) {
    const el = registry.get(id);
    if (!el) {
      next.push(null);
      continue;
    }
    const rect = el.getBoundingClientRect();
    next.push(rect.top + window.scrollY + rect.height / 2);
  }
  anchors = next;
  scene.viewportH = window.innerHeight;
  docHeight = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  update();
}

/* ------------------------------------------------------- stage computation */

function computeStage(focus: number): number {
  if (!anchors.length) return 0;
  const last = anchors.length - 1;

  // Sections that never mounted fall back to an even spread, so the camera path
  // still resolves rather than collapsing to stage 0.
  const a = anchors.map((v, i) => (v == null ? (i / last) * docHeight : v));

  if (focus <= a[0]) return 0;
  if (focus >= a[last]) return last;

  for (let i = 0; i < last; i++) {
    if (focus >= a[i] && focus < a[i + 1]) {
      const span = a[i + 1] - a[i] || 1;
      return i + (focus - a[i]) / span;
    }
  }
  return last;
}

/* ------------------------------------------------------------- subscribers */

type SectionListener = (index: number) => void;
const listeners = new Set<SectionListener>();
let lastSectionIndex = -1;

export function subscribeSection(fn: SectionListener): () => void {
  listeners.add(fn);
  fn(lastSectionIndex);
  return () => {
    listeners.delete(fn);
  };
}

/* ------------------------------------------------------------------ update */

export function update(): void {
  const y = window.scrollY || window.pageYOffset || 0;

  scene.scrollY = y;
  scene.progress = Math.min(1, Math.max(0, y / docHeight));
  scene.stage = computeStage(y + scene.viewportH * 0.5);

  const idx = Math.round(scene.stage);
  if (idx !== lastSectionIndex) {
    lastSectionIndex = idx;
    for (const fn of listeners) fn(idx);
  }
}

/* ------------------------------------------------------- keyframe sampling */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => t * t * (3 - 2 * t);

function sampleTrack<T>(track: T[], stage: number): { a: T; b: T; t: number } {
  const last = track.length - 1;
  const i = Math.max(0, Math.min(last, Math.floor(stage)));
  const j = Math.min(last, i + 1);
  const t = smoothstep(Math.max(0, Math.min(1, stage - i)));
  return { a: track[i], b: track[j], t };
}

/** Interpolated camera keyframe for the current stage. Mutates `out`. */
export function sampleCamera(stage: number, out: CameraState): CameraState {
  const { a, b, t } = sampleTrack(CAMERA_KEYFRAMES, stage);
  out.lookX = lerp(a.look[0], b.look[0], t);
  out.lookY = lerp(a.look[1], b.look[1], t);
  out.lookZ = lerp(a.look[2], b.look[2], t);
  out.dist = lerp(a.dist, b.dist, t);
  out.yaw = lerp(a.yaw, b.yaw, t);
  out.pitch = lerp(a.pitch, b.pitch, t);
  out.subjectX = lerp(a.subjectX, b.subjectX, t);
  out.subjectY = lerp(a.subjectY, b.subjectY, t);
  out.roll = lerp(a.roll ?? 0, b.roll ?? 0, t);
  return out;
}

/** Interpolated per-layer intensity for the current stage. Mutates `out`. */
export function sampleLayers(stage: number, out: LayerState): LayerState {
  const { a, b, t } = sampleTrack(LAYER_KEYFRAMES, stage);
  out.orbit = lerp(a.orbit, b.orbit, t);
  out.rings = lerp(a.rings, b.rings, t);
  out.pair = lerp(a.pair, b.pair, t);
  out.earth = lerp(a.earth, b.earth, t);
  out.stars = lerp(a.stars, b.stars, t);
  out.atmosphere = lerp(a.atmosphere, b.atmosphere, t);
  return out;
}

/* -------------------------------------------------------------------- boot */

let bound = false;

/**
 * Binds scroll, pointer and media-query listeners.
 *
 * Returns a teardown, and is safe to call twice: the landing page mounts and
 * unmounts as a route, and a leaked scroll listener writing into this module
 * after unmount would keep the camera state alive across navigations.
 */
export function bindScene(): () => void {
  if (bound || typeof window === "undefined") return () => {};
  bound = true;

  const mqReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mqMobile = window.matchMedia("(max-width: 820px)");

  const applyEnv = () => {
    scene.reducedMotion = mqReduced.matches;
    scene.isMobile = mqMobile.matches;
  };
  applyEnv();

  const onScroll = () => update();
  const onResize = () => {
    applyEnv();
    measure();
  };
  const onPointer = (e: PointerEvent) => {
    scene.pointerTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
    scene.pointerTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  const onPointerLeave = () => {
    scene.pointerTarget.x = 0;
    scene.pointerTarget.y = 0;
  };

  // Section heights shift as fonts load and reveals run; re-measure when they do.
  const ro = new ResizeObserver(() => measure());
  ro.observe(document.body);

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("pointerleave", onPointerLeave);
  mqReduced.addEventListener("change", applyEnv);
  mqMobile.addEventListener("change", onResize);

  measure();

  return () => {
    ro.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointermove", onPointer);
    window.removeEventListener("pointerleave", onPointerLeave);
    mqReduced.removeEventListener("change", applyEnv);
    mqMobile.removeEventListener("change", onResize);
    registry.clear();
    listeners.clear();
    lastSectionIndex = -1;
    bound = false;
  };
}

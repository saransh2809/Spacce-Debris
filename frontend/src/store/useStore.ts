/**
 * KAKSHA -- client state.
 *
 * THE CLOCK
 * ---------
 * The backend owns the authoritative simulation clock. The browser cannot ask
 * it for the time sixty times a second, so it keeps a local mirror: an anchor
 * (simulation time + wall time at the moment of the last sync) and a rate.
 * Local time is then anchor + elapsed * rate, which advances smoothly for
 * rendering.
 *
 * Crucially, the mirror is used ONLY to drive animation and to choose the
 * `at` parameter of the next request. It never produces a number that appears
 * in a panel. Every displayed value still comes from the server, evaluated at
 * an explicit instant. Earth rotation and satellite positions therefore stay
 * consistent even when the local clock has drifted a few milliseconds.
 */
import { create } from "zustand";
import type { ClockState, ObjectTypeName, RiskCategory } from "../api/types";

export type ViewMode = "OBJECTS" | "ORBITS" | "RISK" | "DENSITY";
export type SelectionMode = "SATELLITE" | "DEBRIS" | "CONJUNCTION" | "ORBIT";

export interface LayerToggles {
  satellites: boolean;
  debris: boolean;
  rocketBodies: boolean;
  stations: boolean;
  inactive: boolean;
  orbits: boolean;
  conjunctions: boolean;
}

export interface RiskFilters {
  CRITICAL: boolean;
  HIGH: boolean;
  MODERATE: boolean;
  LOW: boolean;
}

interface KakshaState {
  // --- clock mirror ---
  clockMode: "REAL_TIME" | "SIMULATION";
  anchorSimMs: number;
  anchorWallMs: number;
  rate: number;
  paused: boolean;
  /** Bumped whenever the clock is re-anchored, so queries can key off it. */
  clockEpoch: number;

  syncClock: (state: ClockState) => void;
  simNow: () => Date;
  /** Sim time quantised to `stepMs`, for use as a stable query key. */
  simQuantised: (stepMs: number) => string;

  // --- selection ---
  selectedNorad: number | null;
  selectedEventId: string | null;
  hoveredNorad: number | null;
  selectionMode: SelectionMode;
  setSelectedNorad: (id: number | null) => void;
  setSelectedEvent: (id: string | null) => void;
  setHoveredNorad: (id: number | null) => void;
  setSelectionMode: (m: SelectionMode) => void;

  // --- view ---
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  focusIndia: boolean;
  toggleFocusIndia: () => void;
  followSelected: boolean;
  setFollowSelected: (v: boolean) => void;

  /**
   * Side-panel visibility. Independent, so all four combinations are reachable
   * and the centre viewport reclaims whatever space is freed.
   */
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;

  /**
   * Whether the 3D globe is mounted.
   *
   * The dashboard opens on a summary view; the globe is revealed on demand.
   * This flag controls MOUNTING, and everything the globe depends on --
   * simulation time, selection, filters, camera intent -- lives elsewhere in
   * this store, so hiding and re-showing it restores the same scene rather
   * than resetting the session.
   */
  globeVisible: boolean;
  setGlobeVisible: (v: boolean) => void;
  toggleGlobe: () => void;
  /** Idle camera drift, so the globe is visibly turning without user input. */
  autoRotate: boolean;
  setAutoRotate: (v: boolean) => void;
  toggleAutoRotate: () => void;
  /**
   * How many objects the globe draws. This is a DISPLAY cap only -- screening
   * and every numerical result always run against the full catalogue. Drawing
   * all 18,700 at once is legible as a density field but useless for picking
   * out an individual asset, so the default shows a readable subset.
   */
  maxObjects: number;
  setMaxObjects: (n: number) => void;

  // --- filters ---
  layers: LayerToggles;
  toggleLayer: (key: keyof LayerToggles) => void;
  riskFilters: RiskFilters;
  toggleRisk: (key: RiskCategory) => void;
  countries: string[];
  toggleCountry: (country: string) => void;
  clearCountries: () => void;
  regime: string | null;
  setRegime: (r: string | null) => void;
  resetFilters: () => void;

  // --- screening parameters ---
  windowHours: number;
  setWindowHours: (h: number) => void;
  thresholdKm: number;
  setThresholdKm: (km: number) => void;

  // --- derived helpers ---
  activeObjectTypes: () => ObjectTypeName[];
  activeRiskCategories: () => RiskCategory[];
}

const DEFAULT_LAYERS: LayerToggles = {
  satellites: true,
  debris: true,
  rocketBodies: true,
  stations: true,
  inactive: true,
  orbits: true,
  conjunctions: true,
};

const DEFAULT_RISK: RiskFilters = {
  CRITICAL: true,
  HIGH: true,
  MODERATE: true,
  LOW: true,
};

export const useStore = create<KakshaState>((set, get) => ({
  // ------------------------------------------------------------------ clock
  clockMode: "REAL_TIME",
  anchorSimMs: Date.now(),
  anchorWallMs: Date.now(),
  rate: 1,
  paused: false,
  clockEpoch: 0,

  syncClock: (state) =>
    set((prev) => ({
      clockMode: state.mode,
      anchorSimMs: new Date(state.simulation_time).getTime(),
      anchorWallMs: Date.now(),
      rate: state.rate,
      paused: state.paused,
      clockEpoch: prev.clockEpoch + 1,
    })),

  simNow: () => {
    const { clockMode, anchorSimMs, anchorWallMs, rate, paused } = get();
    if (clockMode === "REAL_TIME") return new Date();
    if (paused || rate === 0) return new Date(anchorSimMs);
    return new Date(anchorSimMs + (Date.now() - anchorWallMs) * rate);
  },

  simQuantised: (stepMs) => {
    const t = get().simNow().getTime();
    return new Date(Math.floor(t / stepMs) * stepMs).toISOString();
  },

  // -------------------------------------------------------------- selection
  selectedNorad: null,
  selectedEventId: null,
  hoveredNorad: null,
  selectionMode: "SATELLITE",
  setSelectedNorad: (id) => set({ selectedNorad: id }),
  setSelectedEvent: (id) =>
    set({ selectedEventId: id, selectionMode: id ? "CONJUNCTION" : "SATELLITE" }),
  setHoveredNorad: (id) => set({ hoveredNorad: id }),
  setSelectionMode: (m) => set({ selectionMode: m }),

  // ------------------------------------------------------------------- view
  viewMode: "OBJECTS",
  setViewMode: (v) => set({ viewMode: v }),
  focusIndia: false,
  toggleFocusIndia: () =>
    set((s) => ({
      focusIndia: !s.focusIndia,
      countries: !s.focusIndia ? ["India"] : [],
    })),
  followSelected: false,
  setFollowSelected: (v) => set({ followSelected: v }),

  leftPanelOpen: true,
  rightPanelOpen: true,
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),

  globeVisible: false,
  setGlobeVisible: (v) => set({ globeVisible: v }),
  toggleGlobe: () => set((s) => ({ globeVisible: !s.globeVisible })),
  autoRotate: true,
  setAutoRotate: (v) => set({ autoRotate: v }),
  toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
  maxObjects: 4000,
  setMaxObjects: (n) => set({ maxObjects: n }),

  // ---------------------------------------------------------------- filters
  layers: { ...DEFAULT_LAYERS },
  toggleLayer: (key) =>
    set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),

  riskFilters: { ...DEFAULT_RISK },
  toggleRisk: (key) =>
    set((s) => ({ riskFilters: { ...s.riskFilters, [key]: !s.riskFilters[key] } })),

  countries: [],
  toggleCountry: (country) =>
    set((s) => ({
      countries: s.countries.includes(country)
        ? s.countries.filter((c) => c !== country)
        : [...s.countries, country],
      focusIndia: false,
    })),
  clearCountries: () => set({ countries: [], focusIndia: false }),

  regime: null,
  setRegime: (r) => set({ regime: r }),

  resetFilters: () =>
    set({
      layers: { ...DEFAULT_LAYERS },
      riskFilters: { ...DEFAULT_RISK },
      countries: [],
      regime: null,
      focusIndia: false,
    }),

  // ------------------------------------------------------ screening params
  windowHours: 48,
  setWindowHours: (h) => set({ windowHours: h }),
  thresholdKm: 25,
  setThresholdKm: (km) => set({ thresholdKm: km }),

  // ---------------------------------------------------------------- derived
  activeObjectTypes: () => {
    const { layers } = get();
    const out: ObjectTypeName[] = [];
    if (layers.satellites) out.push("ACTIVE_SATELLITE");
    if (layers.inactive) out.push("INACTIVE_SATELLITE");
    if (layers.debris) out.push("DEBRIS");
    if (layers.rocketBodies) out.push("ROCKET_BODY");
    if (layers.stations) out.push("SPACE_STATION");
    return out;
  },

  activeRiskCategories: () => {
    const { riskFilters } = get();
    return (Object.keys(riskFilters) as RiskCategory[]).filter(
      (k) => riskFilters[k],
    );
  },
}));

/** Colour for an object class. Single source of truth for the legend and the 3D scene. */
export const TYPE_COLOR: Record<string, string> = {
  ACTIVE_SATELLITE: "#2dd4bf",
  INACTIVE_SATELLITE: "#5b7d94",
  DEBRIS: "#7d8899",
  ROCKET_BODY: "#e8913c",
  SPACE_STATION: "#8be9fd",
  UNKNOWN: "#4a5568",
  INDIA: "#f0a030",
  HIGH_RISK: "#f04747",
};

export const RISK_COLOR: Record<RiskCategory, string> = {
  CRITICAL: "#ff3d54",
  HIGH: "#f04747",
  MODERATE: "#f0a030",
  LOW: "#4a9eda",
};

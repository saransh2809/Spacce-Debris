/**
 * KAKSHA -- API client.
 *
 * Thin, typed wrappers over the backend. Deliberately dumb: no computation, no
 * derived physics, no caching of numerical results beyond what React Query
 * does for network responses. Everything numerical is server-authoritative.
 *
 * Errors are surfaced with the backend's structured detail intact, because
 * "CATALOG_NOT_LOADED, still fetching 18,000 element sets" is a useful thing
 * for the UI to say and "Request failed" is not.
 */
import type {
  AnalysisResponse,
  CatalogSummary,
  ClockState,
  ConjunctionDetail,
  ConjunctionSummary,
  BPlaneResponse,
  DebugResponse,
  EnvironmentResponse,
  ExplainResponse,
  MethodologyResponse,
  ObjectBrief,
  ObjectResponse,
  OrbitTrack,
  ProfileResponse,
  SceneResponse,
  ScreeningResponse,
  ValidationPageResponse,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  status: number;
  code: string;
  detail: unknown;

  constructor(status: number, code: string, message: string, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    throw new ApiError(
      0,
      "NETWORK_UNREACHABLE",
      "Cannot reach the KAKSHA backend. Is it running on port 8000?",
      cause,
    );
  }

  if (!response.ok) {
    let detail: unknown = null;
    let code = `HTTP_${response.status}`;
    let message = response.statusText || "Request failed";
    try {
      const body = await response.json();
      detail = body?.detail ?? body;
      if (detail && typeof detail === "object") {
        const d = detail as Record<string, string>;
        code = d.error ?? code;
        message = d.message ?? message;
      }
    } catch {
      /* body was not JSON; keep the status text */
    }
    throw new ApiError(response.status, code, message, detail);
  }

  return (await response.json()) as T;
}

/** Build a query string, dropping null/undefined and expanding arrays. */
function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v !== undefined && v !== null) sp.append(key, String(v));
    } else {
      sp.append(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export interface ScreenParams {
  at?: string;
  countries?: string[];
  norad_ids?: number[];
  hours?: number;
  threshold_km?: number;
  categories?: string[];
  limit?: number;
}

export const api = {
  // ---------------------------------------------------------------- system
  health: () =>
    request<{
      status: string;
      catalog_loaded: boolean;
      catalog_loading: boolean;
      objects: number;
      data_age_seconds: number | null;
      /**
       * Resolved state of the explanation layer, not merely "a key exists".
       * `configured: false` with a populated `detail` is the normal way a
       * misconfigured key is surfaced.
       */
      llm: {
        configured: boolean;
        provider: string;
        model: string;
        detail: string;
      };
      server_time: string;
      version: string;
    }>("/api/health"),

  debug: (limit = 100, stage?: string) =>
    request<DebugResponse>(`/api/debug${qs({ limit, stage })}`),

  // --------------------------------------------------------------- catalog
  summary: () => request<CatalogSummary>("/api/catalog/summary"),

  search: (q: string, limit = 25) =>
    request<{ query: string; count: number; results: ObjectBrief[] }>(
      `/api/catalog/search${qs({ q, limit })}`,
    ),

  objects: (params: {
    object_types?: string[];
    countries?: string[];
    operators?: string[];
    regimes?: string[];
    limit?: number;
    offset?: number;
  }) =>
    request<{
      total_matched: number;
      offset: number;
      limit: number;
      objects: ObjectBrief[];
    }>(`/api/catalog/objects${qs(params)}`),

  object: (noradId: number, at?: string) =>
    request<ObjectResponse>(`/api/catalog/object/${noradId}${qs({ at })}`),

  scene: (params: {
    at?: string;
    object_types?: string[];
    countries?: string[];
    regimes?: string[];
    limit?: number;
  }) => request<SceneResponse>(`/api/catalog/scene${qs(params)}`),

  refreshCatalog: () =>
    request<{ status: string; total_objects: number }>("/api/catalog/refresh", {
      method: "POST",
    }),

  // ----------------------------------------------------------- propagation
  orbit: (noradId: number, params: { at?: string; revolutions?: number; samples?: number }) =>
    request<OrbitTrack>(`/api/orbit/${noradId}${qs(params)}`),

  groundTrack: (noradId: number, params: { at?: string; revolutions?: number }) =>
    request<{
      latitude_deg: (number | null)[];
      longitude_deg: (number | null)[];
      altitude_km: (number | null)[];
      approximations: string[];
      sample_count: number;
    }>(`/api/groundtrack/${noradId}${qs(params)}`),

  environment: (at?: string) =>
    request<EnvironmentResponse>(`/api/environment${qs({ at })}`),

  // ------------------------------------------------------------------ clock
  clock: () => request<ClockState>("/api/clock"),
  clockRealtime: () => request<ClockState>("/api/clock/realtime", { method: "POST" }),
  clockJump: (body: { time?: string; offset_seconds?: number }) =>
    request<ClockState>("/api/clock/jump", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  clockRate: (rate: number) =>
    request<ClockState>("/api/clock/rate", {
      method: "POST",
      body: JSON.stringify({ rate }),
    }),
  clockPause: () => request<ClockState>("/api/clock/pause", { method: "POST" }),
  clockPlay: () => request<ClockState>("/api/clock/play", { method: "POST" }),

  // ----------------------------------------------------------- conjunctions
  conjunctions: (params: ScreenParams) =>
    request<ScreeningResponse>(`/api/conjunctions${qs(params)}`),

  conjunctionSummary: (params: { at?: string; countries?: string[]; hours?: number }) =>
    request<ConjunctionSummary>(`/api/conjunctions/summary${qs(params)}`),

  conjunction: (eventId: string, params: ScreenParams = {}) =>
    request<ConjunctionDetail>(`/api/conjunctions/${eventId}${qs(params)}`),

  bplane: (
    eventId: string,
    params: ScreenParams & { half_window_s?: number; samples?: number } = {},
  ) => request<BPlaneResponse>(`/api/conjunctions/${eventId}/bplane${qs(params)}`),

  profile: (
    eventId: string,
    params: ScreenParams & { half_window_s?: number; samples?: number } = {},
  ) => request<ProfileResponse>(`/api/conjunctions/${eventId}/profile${qs(params)}`),

  methodology: () => request<MethodologyResponse>("/api/conjunctions/methodology"),

  // -------------------------------------------------------------- analysis
  analysis: (params: { at?: string; countries?: string[]; hours?: number }) =>
    request<AnalysisResponse>(`/api/analysis${qs(params)}`),

  validation: (params: { at?: string; hours?: number } = {}) =>
    request<ValidationPageResponse>(`/api/validation${qs(params)}`),

  explain: (eventId: string, params: ScreenParams = {}) =>
    request<ExplainResponse>(`/api/explain/${eventId}${qs(params)}`, {
      method: "POST",
    }),
};

// ---------------------------------------------------------------- formatting
// Display helpers live here so that "how a number is shown" is decided once.
// They never change a value -- only its presentation.

/** Fixed-decimal formatting that renders unavailable data honestly. */
export function fmt(
  value: number | null | undefined,
  digits = 3,
  fallback = "—",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return value.toFixed(digits);
}

export function fmtInt(value: number | null | undefined, fallback = "—"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return Math.round(value).toLocaleString("en-US");
}

/** Scientific notation for probabilities and residuals. */
export function fmtSci(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return value.toExponential(digits);
}

/** UTC clock string, HH:MM:SS. */
export function fmtTimeUTC(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(11, 19);
}

/** UTC date, e.g. "25 Aug 2026". */
export function fmtDateUTC(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Compact duration, e.g. "06h 42m" or "-12m". */
export function fmtDuration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "—";
  const sign = hours < 0 ? "-" : "";
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  if (h === 0) return `${sign}${m}m`;
  return `${sign}${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
}

/** Seconds since an ISO timestamp, phrased for a staleness indicator. */
export function fmtAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h ago`;
  return `${(seconds / 86400).toFixed(1)}d ago`;
}

/** Regional-indicator flag glyph from an ISO-3166 alpha-2 code. */
export function flagOf(iso: string | null | undefined): string {
  if (!iso || iso.length !== 2) return "";
  if (iso === "EU") return "🇪🇺";
  const base = 0x1f1e6;
  const cp = [...iso.toUpperCase()].map((c) => base + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...cp);
}

/**
 * KAKSHA -- data hooks.
 *
 * All server state flows through React Query. The important detail is the
 * QUANTISED TIME KEY: the scene needs new positions continuously, but issuing
 * a request per animation frame would be absurd. Instead the simulation time is
 * quantised to a step, and that quantised value is part of the query key.
 * Requests therefore fire at a bounded rate, and every response is tied to an
 * explicit instant rather than to "whenever it arrived".
 *
 * The rendered scene interpolates nothing between samples: what is drawn is
 * what the propagator returned for that instant.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { useStore } from "../store/useStore";

/** Live wall/simulation clock ticking locally at ~10 Hz for display. */
export function useTickingTime(hz = 10): Date {
  const simNow = useStore((s) => s.simNow);
  const clockEpoch = useStore((s) => s.clockEpoch);
  const [now, setNow] = useState(() => simNow());

  useEffect(() => {
    setNow(simNow());
    const id = window.setInterval(() => setNow(simNow()), 1000 / hz);
    return () => window.clearInterval(id);
  }, [simNow, hz, clockEpoch]);

  return now;
}

/**
 * Simulation time quantised to `stepMs`, as an ISO string.
 * Used as the `at` parameter and as part of query keys.
 */
export function useQuantisedTime(stepMs: number): string {
  const simQuantised = useStore((s) => s.simQuantised);
  const clockEpoch = useStore((s) => s.clockEpoch);
  const rate = useStore((s) => s.rate);
  const paused = useStore((s) => s.paused);
  const [value, setValue] = useState(() => simQuantised(stepMs));

  useEffect(() => {
    setValue(simQuantised(stepMs));
    // Poll a little faster than the quantisation step so a boundary is never
    // missed by a whole step.
    const id = window.setInterval(
      () => setValue(simQuantised(stepMs)),
      Math.max(120, stepMs / 3),
    );
    return () => window.clearInterval(id);
  }, [simQuantised, stepMs, clockEpoch, rate, paused]);

  return value;
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 15_000,
    retry: 3,
    retryDelay: 1500,
  });
}

export function useCatalogSummary() {
  return useQuery({
    queryKey: ["catalog", "summary"],
    queryFn: () => api.summary(),
    staleTime: 120_000,
    retry: (count, error) =>
      error instanceof ApiError && error.code === "CATALOG_NOT_LOADED"
        ? count < 30
        : count < 2,
    retryDelay: 2500,
  });
}

/** Bulk positions for the 3D view. */
export function useScene(params: {
  objectTypes?: string[];
  countries?: string[];
  regime?: string | null;
  limit?: number;
  stepMs?: number;
  enabled?: boolean;
}) {
  const stepMs = params.stepMs ?? 1000;
  const at = useQuantisedTime(stepMs);

  return useQuery({
    queryKey: [
      "scene",
      at,
      params.objectTypes?.join(","),
      params.countries?.join(","),
      params.regime,
      params.limit,
    ],
    queryFn: () =>
      api.scene({
        at,
        object_types: params.objectTypes,
        countries: params.countries,
        regimes: params.regime ? [params.regime] : undefined,
        limit: params.limit,
      }),
    enabled: params.enabled !== false,
    // Keep the previous frame on screen while the next one loads: blanking the
    // scene every tick would make the globe strobe.
    placeholderData: (prev) => prev,
    staleTime: stepMs,
    retry: (count, error) =>
      error instanceof ApiError && error.code === "CATALOG_NOT_LOADED"
        ? count < 30
        : count < 2,
    retryDelay: 2000,
  });
}

export function useEnvironment(stepMs = 1000) {
  const at = useQuantisedTime(stepMs);
  return useQuery({
    queryKey: ["environment", at],
    queryFn: () => api.environment(at),
    placeholderData: (prev) => prev,
    staleTime: stepMs,
  });
}

export function useObject(noradId: number | null, stepMs = 2000) {
  const at = useQuantisedTime(stepMs);
  return useQuery({
    queryKey: ["object", noradId, at],
    queryFn: () => api.object(noradId as number, at),
    enabled: noradId !== null,
    placeholderData: (prev) => prev,
    staleTime: stepMs,
  });
}

export function useOrbit(noradId: number | null, revolutions = 1) {
  // Orbit geometry changes slowly; a 60 s quantisation is ample and avoids
  // re-fetching a 256-point path every second.
  const at = useQuantisedTime(60_000);
  return useQuery({
    queryKey: ["orbit", noradId, revolutions, at],
    queryFn: () => api.orbit(noradId as number, { at, revolutions, samples: 320 }),
    enabled: noradId !== null,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
}

/** Screening parameters shared by every conjunction query. */
export function useScreenParams() {
  const countries = useStore((s) => s.countries);
  const windowHours = useStore((s) => s.windowHours);
  const thresholdKm = useStore((s) => s.thresholdKm);
  // Screening runs are cached server-side for 10 minutes; quantising the
  // client's `at` to 5 minutes keeps requests landing on the same cache entry.
  const at = useQuantisedTime(300_000);

  return useMemo(
    () => ({
      at,
      countries: countries.length ? countries : undefined,
      hours: windowHours,
      threshold_km: thresholdKm,
    }),
    [at, countries, windowHours, thresholdKm],
  );
}

export function useConjunctions(limit = 200) {
  const params = useScreenParams();
  const categories = useStore((s) => s.activeRiskCategories)();

  return useQuery({
    queryKey: ["conjunctions", params, categories.join(","), limit],
    queryFn: () =>
      api.conjunctions({
        ...params,
        categories: categories.length === 4 ? undefined : categories,
        limit,
      }),
    placeholderData: (prev) => prev,
    staleTime: 300_000,
    retry: (count, error) =>
      error instanceof ApiError &&
      (error.code === "CATALOG_NOT_LOADED" || error.status === 503)
        ? count < 30
        : count < 2,
    retryDelay: 2500,
  });
}

export function useConjunctionSummary() {
  const params = useScreenParams();
  return useQuery({
    queryKey: ["conjunction-summary", params],
    queryFn: () =>
      api.conjunctionSummary({
        at: params.at,
        countries: params.countries,
        hours: params.hours,
      }),
    placeholderData: (prev) => prev,
    staleTime: 300_000,
    retry: (count, error) =>
      error instanceof ApiError && error.status === 503 ? count < 30 : count < 2,
    retryDelay: 2500,
  });
}

export function useConjunctionDetail(eventId: string | null) {
  const params = useScreenParams();
  return useQuery({
    queryKey: ["conjunction", eventId, params],
    queryFn: () => api.conjunction(eventId as string, params),
    enabled: !!eventId,
    placeholderData: (prev) => prev,
    staleTime: 300_000,
  });
}

export function useBPlane(eventId: string | null) {
  const params = useScreenParams();
  return useQuery({
    queryKey: ["bplane", eventId, params],
    queryFn: () =>
      api.bplane(eventId as string, { ...params, half_window_s: 60, samples: 121 }),
    enabled: !!eventId,
    placeholderData: (prev) => prev,
    staleTime: 300_000,
  });
}

export function useProfile(eventId: string | null, halfWindowS = 600) {
  const params = useScreenParams();
  return useQuery({
    queryKey: ["profile", eventId, halfWindowS, params],
    queryFn: () =>
      api.profile(eventId as string, {
        ...params,
        half_window_s: halfWindowS,
        samples: 301,
      }),
    enabled: !!eventId,
    placeholderData: (prev) => prev,
    staleTime: 300_000,
  });
}

export function useAnalysis() {
  const params = useScreenParams();
  return useQuery({
    queryKey: ["analysis", params],
    queryFn: () =>
      api.analysis({ at: params.at, countries: params.countries, hours: params.hours }),
    placeholderData: (prev) => prev,
    staleTime: 300_000,
    retry: (count, error) =>
      error instanceof ApiError && error.status === 503 ? count < 20 : count < 2,
    retryDelay: 2500,
  });
}

export function useValidation() {
  return useQuery({
    queryKey: ["validation"],
    queryFn: () => api.validation({}),
    staleTime: 120_000,
    retry: (count, error) =>
      error instanceof ApiError && error.status === 503 ? count < 20 : count < 2,
    retryDelay: 2500,
  });
}

export function useMethodology() {
  return useQuery({
    queryKey: ["methodology"],
    queryFn: () => api.methodology(),
    staleTime: Infinity,
  });
}

export function useDebug(enabled = true) {
  return useQuery({
    queryKey: ["debug"],
    queryFn: () => api.debug(120),
    enabled,
    refetchInterval: 4000,
  });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => api.search(query, 30),
    enabled: query.trim().length >= 2,
    staleTime: 60_000,
  });
}

/** Clock mutations that also re-sync the local mirror. */
export function useClockControls() {
  const syncClock = useStore((s) => s.syncClock);
  const queryClient = useQueryClient();

  const apply = async (fn: () => Promise<Parameters<typeof syncClock>[0]>) => {
    const state = await fn();
    syncClock(state);
    // Time-dependent queries must not serve results computed for a different
    // instant, so drop them rather than showing a stale frame.
    await queryClient.invalidateQueries({ queryKey: ["scene"] });
    await queryClient.invalidateQueries({ queryKey: ["environment"] });
    await queryClient.invalidateQueries({ queryKey: ["object"] });
    return state;
  };

  return useMemo(
    () => ({
      realtime: () => apply(() => api.clockRealtime()),
      jumpTo: (time: Date) => apply(() => api.clockJump({ time: time.toISOString() })),
      offset: (seconds: number) => apply(() => api.clockJump({ offset_seconds: seconds })),
      setRate: (rate: number) => apply(() => api.clockRate(rate)),
      pause: () => apply(() => api.clockPause()),
      play: () => apply(() => api.clockPlay()),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncClock, queryClient],
  );
}

/** Sync the local clock mirror from the server once at startup. */
export function useClockSync() {
  const syncClock = useStore((s) => s.syncClock);
  const { data } = useQuery({
    queryKey: ["clock"],
    queryFn: () => api.clock(),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (data) syncClock(data);
  }, [data, syncClock]);

  return data;
}

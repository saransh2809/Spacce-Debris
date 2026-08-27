/**
 * KAKSHA -- landing page data adapter.
 *
 * The landing page is the public front door, so it has one hard requirement the
 * console pages do not: it must render completely and look finished with the
 * backend switched off. Nothing here is allowed to throw, suspend, or surface a
 * loading state — an unreachable engine simply means the fallback figures from
 * `landingContent` are shown and `live` reports false.
 *
 * When the engine IS answering, every headline number on the page is a real
 * result: catalogue size and composition from /catalog/summary, and the
 * featured close approach from the closest event in the current screening
 * window. The page then says so rather than carrying a placeholder badge.
 *
 * Both queries are the same ones the console already uses, so on a warm cache
 * this costs no extra network traffic.
 */

import { useMemo } from "react";
import { useCatalogSummary, useConjunctionSummary } from "../../../hooks/useKaksha";
import {
  BREAKDOWN_ROWS,
  FALLBACK_CATALOG_TOTAL,
  fallbackBreakdown,
  fallbackConjunction,
  type CatalogBreakdownRow,
  type FeaturedConjunction,
  type HeroMetric,
} from "./landingContent";

export interface LandingData {
  /** True only when the featured figures came from the engine. */
  live: boolean;
  /** True when the catalogue figures specifically are live. */
  catalogLive: boolean;
  /** True when the featured conjunction specifically is live. */
  conjunctionLive: boolean;

  totalObjects: number;
  breakdown: CatalogBreakdownRow[];
  metrics: HeroMetric[];
  conjunction: FeaturedConjunction;

  screeningWindowHours: number;
  /** Element-set provenance, shown under the catalogue readout. */
  sourceLabel: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** ACTIVE_SATELLITE -> ACTIVE SATELLITE. The enum is an API detail, not copy. */
const typeLabel = (t: string) => t.replace(/_/g, " ");

/**
 * Maps the engine's object-type buckets onto the readout rows.
 *
 * Keys are the API's own ObjectTypeName values, so this cannot silently drift:
 * a renamed bucket produces a missing row rather than a wrong number. Rows the
 * catalogue has no objects for are dropped, so a feed without a bucket does not
 * leave a zero sitting on the page.
 */
function breakdownFromTypes(byType: Record<string, number>): CatalogBreakdownRow[] {
  return BREAKDOWN_ROWS.map((row) => ({
    id: row.id,
    label: row.label,
    color: row.color,
    count: byType[row.id] ?? 0,
  })).filter((row) => row.count > 0);
}

export function useLandingData(): LandingData {
  const catalogQuery = useCatalogSummary();
  const conjQuery = useConjunctionSummary();

  const catalog = catalogQuery.data;
  const conj = conjQuery.data;

  return useMemo<LandingData>(() => {
    const catalogLive = !!catalog && catalog.total_objects > 0;
    const totalObjects = catalogLive ? catalog!.total_objects : FALLBACK_CATALOG_TOTAL;

    const liveRows = catalogLive ? breakdownFromTypes(catalog!.by_type ?? {}) : [];
    const breakdown = liveRows.length ? liveRows : fallbackBreakdown;

    const windowHours = conj?.window_hours ?? 48;
    const threshold = conj?.screening_threshold_km ?? fallbackConjunction.screeningThresholdKm;

    /* ---- the featured close approach ---- */
    const closest = conj?.closest ?? null;
    const conjunctionLive = !!closest;

    const featured: FeaturedConjunction = closest
      ? {
          id: closest.event_id,
          primary: { name: closest.object_a.name, type: typeLabel(closest.object_a.object_type) },
          secondary: { name: closest.object_b.name, type: typeLabel(closest.object_b.object_type) },
          missDistanceKm: closest.miss_distance_km,
          relativeVelocityKmS: closest.relative_speed_km_s,
          timeToTcaSeconds: Math.max(0, closest.hours_to_tca * 3600),
          // Not carried by the summary endpoint; drives the stylised crossing
          // geometry only, never a displayed conclusion.
          relativeAngleDeg: fallbackConjunction.relativeAngleDeg,
          screeningThresholdKm: threshold,
          riskLevel: closest.risk_category,
          probabilityOfCollision: null,
        }
      : { ...fallbackConjunction, screeningThresholdKm: threshold };

    const totalConjunctions = conj?.total_conjunctions ?? 155;

    const metrics: HeroMetric[] = [
      {
        id: "tracked",
        value: fmt(totalObjects),
        label: "TRACKED OBJECTS",
        sub: "CATALOGUED",
      },
      {
        id: "conj",
        value: fmt(totalConjunctions),
        label: "CONJUNCTIONS",
        sub: "IN WINDOW",
      },
      {
        id: "window",
        value: `${windowHours}H`,
        label: "SCREENING WINDOW",
        sub: "FORWARD",
      },
      {
        id: "engine",
        value: "SGP4",
        label: "PROPAGATION ENGINE",
        sub: "ANALYTICAL",
      },
    ];

    const provider = catalog?.data?.provider;
    const sourceLabel = catalogLive
      ? `ELEMENT SETS VIA ${(provider ?? "CELESTRAK").toUpperCase()}`
      : "REPRESENTATIVE FIGURES — ENGINE NOT CONNECTED";

    return {
      live: catalogLive && conjunctionLive,
      catalogLive,
      conjunctionLive,
      totalObjects,
      breakdown,
      metrics,
      conjunction: featured,
      screeningWindowHours: windowHours,
      sourceLabel,
    };
  }, [catalog, conj]);
}

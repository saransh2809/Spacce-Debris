/**
 * KAKSHA -- ANALYSIS page.
 *
 * Distributions over the live screening run. Every chart is computed from the
 * same validated result set that populates the dashboard, so the totals here
 * and the counters there can never disagree.
 */
import { fmt, fmtDuration, fmtInt, flagOf } from "../api/client";
import { useAnalysis, useCatalogSummary } from "../hooks/useKaksha";
import { useStore } from "../store/useStore";
import { BarList, Histogram, TimelineChart } from "../components/charts/Charts";
import type { ConjunctionBrief } from "../api/types";

function ExtremeCard({
  label,
  event,
  metric,
}: {
  label: string;
  event: ConjunctionBrief | null;
  metric: string;
}) {
  const setSelectedEvent = useStore((s) => s.setSelectedEvent);
  if (!event) {
    return (
      <div className="panel" style={{ padding: 12 }}>
        <div className="label">{label}</div>
        <div className="empty" style={{ padding: 12 }}>
          none
        </div>
      </div>
    );
  }
  return (
    <button
      className="panel"
      onClick={() => setSelectedEvent(event.event_id)}
      style={{ padding: 12, textAlign: "left", cursor: "pointer", display: "block" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="label">{label}</span>
        <span className={`chip chip-${event.risk_category}`}>{event.risk_category}</span>
      </div>
      <div style={{ fontSize: "var(--fs-small)", color: "var(--text-bright)", lineHeight: 1.45 }}>
        {flagOf(event.object_a.country_iso)} {event.object_a.name}
      </div>
      <div style={{ fontSize: "var(--fs-small)", color: "var(--text-dim)", lineHeight: 1.45 }}>
        {flagOf(event.object_b.country_iso)} {event.object_b.name}
      </div>
      <div
        className="mono"
        style={{ fontSize: 17, color: "var(--teal)", marginTop: 6, fontWeight: 600 }}
      >
        {metric}
      </div>
      <div className="note">TCA in {fmtDuration(event.hours_to_tca)}</div>
    </button>
  );
}

export function Analysis() {
  const { data, isLoading } = useAnalysis();
  const { data: summary } = useCatalogSummary();
  const windowHours = useStore((s) => s.windowHours);
  const setWindowHours = useStore((s) => s.setWindowHours);

  return (
    <div className="scroll" style={{ flex: 1, background: "var(--bg-app)" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "22px 28px 60px" }}>
        <header
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 20,
            marginBottom: 24,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "var(--fs-huge)",
                fontWeight: 300,
                color: "var(--text-bright)",
                margin: "0 0 6px",
              }}
            >
              Analysis
            </h1>
            <p
              style={{
                fontSize: "var(--fs-med)",
                color: "var(--text-dim)",
                margin: 0,
                maxWidth: 680,
                lineHeight: 1.65,
              }}
            >
              Distributions across the current screening run
              {data && ` — ${fmtInt(data.total_conjunctions)} conjunctions over ${fmt(data.window_hours, 0)} hours`}.
            </p>
          </div>
          <div className="segmented">
            {[6, 12, 24, 48, 72].map((h) => (
              <button key={h} data-active={windowHours === h} onClick={() => setWindowHours(h)}>
                {h}h
              </button>
            ))}
          </div>
        </header>

        {isLoading && !data ? (
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 190 }} />
            ))}
          </div>
        ) : !data ? (
          <div className="empty">No analysis available.</div>
        ) : (
          <>
            {/* --- extremes --- */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 14,
                marginBottom: 26,
              }}
            >
              <ExtremeCard
                label="Closest approach"
                event={data.extremes.closest}
                metric={`${fmt(data.extremes.closest?.miss_distance_km, 3)} km`}
              />
              <ExtremeCard
                label="Highest relative velocity"
                event={data.extremes.fastest}
                metric={`${fmt(data.extremes.fastest?.relative_speed_km_s, 3)} km/s`}
              />
              <ExtremeCard
                label="Soonest encounter"
                event={data.extremes.soonest}
                metric={fmtDuration(data.extremes.soonest?.hours_to_tca)}
              />
            </div>

            {/* --- distributions --- */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 22,
                marginBottom: 26,
              }}
            >
              <div className="panel" style={{ padding: 14 }}>
                <Histogram
                  data={data.miss_distance_histogram}
                  label="Miss Distance Distribution"
                  unit="km"
                  color="#f04747"
                />
                <div className="note" style={{ marginTop: 8 }}>
                  Counts of predicted minimum separations across the screening
                  volume. The left-hand bins are the encounters that matter.
                </div>
              </div>

              <div className="panel" style={{ padding: 14 }}>
                <Histogram
                  data={data.relative_velocity_histogram}
                  label="Relative Velocity Distribution"
                  unit="km/s"
                  color="#2dd4bf"
                />
                <div className="note" style={{ marginTop: 8 }}>
                  Encounter speeds. The cluster near 14–15 km/s is head-on
                  crossings between orbits of opposing inclination.
                </div>
              </div>

              <div className="panel" style={{ padding: 14 }}>
                <Histogram
                  data={data.uncertainty_ratio_histogram}
                  label="Miss Distance in Sigma Units"
                  unit="σ"
                  color="#f0a030"
                />
                <div className="note" style={{ marginTop: 8 }}>
                  Miss distance divided by the combined position uncertainty.
                  Values below about 3 σ mean the separation is not comfortably
                  larger than the error in knowing where the objects are.
                </div>
              </div>

              <div className="panel" style={{ padding: 14 }}>
                <Histogram
                  data={data.encounter_angle_histogram}
                  label="Encounter Geometry — Angle Between Velocity Vectors"
                  unit="degrees"
                  color="#4a9eda"
                />
                <div className="note" style={{ marginTop: 8 }}>
                  0° is a co-orbital overtake, 90° a perpendicular crossing, 180°
                  a head-on encounter.
                </div>
              </div>
            </div>

            {/* --- temporal --- */}
            <div className="panel" style={{ padding: 14, marginBottom: 26 }}>
              <TimelineChart
                counts={data.conjunctions_per_hour.counts}
                hoursPerBucket={data.conjunctions_per_hour.hours_per_bucket}
              />
            </div>

            {/* --- breakdowns --- */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 22,
              }}
            >
              <div className="panel" style={{ padding: 14 }}>
                <BarList
                  data={data.risk_distribution as unknown as Record<string, number>}
                  label="Risk Category"
                  color="#f04747"
                />
              </div>
              <div className="panel" style={{ padding: 14 }}>
                <BarList
                  data={data.partner_country_distribution}
                  label="Conjunction Partner — Country"
                  color="#f0a030"
                />
              </div>
              <div className="panel" style={{ padding: 14 }}>
                <BarList
                  data={data.partner_type_distribution}
                  label="Conjunction Partner — Object Type"
                  color="#7d8899"
                />
              </div>
              <div className="panel" style={{ padding: 14 }}>
                <BarList
                  data={data.catalog_distribution.by_regime}
                  label="Catalogue by Regime"
                  color="#2dd4bf"
                />
                <div style={{ marginTop: 16 }}>
                  <BarList
                    data={data.catalog_distribution.by_type}
                    label="Catalogue by Object Type"
                    color="#4a9eda"
                  />
                </div>
              </div>
            </div>

            {summary && (
              <div className="note" style={{ marginTop: 22, lineHeight: 1.7, maxWidth: 900 }}>
                Catalogue: {fmtInt(summary.total_objects)} objects from{" "}
                {summary.data.provider}, median element age{" "}
                {fmt(summary.data.median_element_age_days, 2)} days.{" "}
                {summary.data.nature_of_data}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

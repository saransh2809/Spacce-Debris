/**
 * KAKSHA -- CONJUNCTIONS page.
 *
 * Full ranked table plus the encounter-plane view and the separation profile
 * for whichever row is selected. This is the page for working through a
 * screening run rather than glancing at it.
 */
import {
  fmt,
  fmtDateUTC,
  fmtDuration,
  fmtInt,
  fmtTimeUTC,
  flagOf,
} from "../api/client";
import {
  useConjunctionDetail,
  useConjunctions,
  useProfile,
} from "../hooks/useKaksha";
import { useStore } from "../store/useStore";
import { BPlaneView } from "../components/bplane/BPlaneView";
import { ProfileChart } from "../components/charts/Charts";
import { ExplanationPanel } from "../components/panels/ExplanationPanel";

const WINDOWS = [6, 12, 24, 48, 72];
const THRESHOLDS = [5, 10, 25, 50];

export function Conjunctions() {
  const { data: screening, isLoading } = useConjunctions(500);
  const selectedEventId = useStore((s) => s.selectedEventId);
  const setSelectedEvent = useStore((s) => s.setSelectedEvent);
  const windowHours = useStore((s) => s.windowHours);
  const setWindowHours = useStore((s) => s.setWindowHours);
  const thresholdKm = useStore((s) => s.thresholdKm);
  const setThresholdKm = useStore((s) => s.setThresholdKm);
  const focusIndia = useStore((s) => s.focusIndia);
  const toggleFocusIndia = useStore((s) => s.toggleFocusIndia);

  const { data: detail } = useConjunctionDetail(selectedEventId);
  const { data: profile } = useProfile(selectedEventId, 900);

  const events = screening?.events ?? [];

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* --- table --- */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-app)",
        }}
      >
        <div
          style={{
            padding: "11px 16px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            background: "var(--bg-panel)",
          }}
        >
          <div>
            <div className="label" style={{ marginBottom: 4 }}>
              Screening Window
            </div>
            <div className="segmented">
              {WINDOWS.map((h) => (
                <button
                  key={h}
                  data-active={windowHours === h}
                  onClick={() => setWindowHours(h)}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="label" style={{ marginBottom: 4 }}>
              Screening Volume
            </div>
            <div className="segmented">
              {THRESHOLDS.map((km) => (
                <button
                  key={km}
                  data-active={thresholdKm === km}
                  onClick={() => setThresholdKm(km)}
                >
                  {km} km
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="label" style={{ marginBottom: 4 }}>
              Primary Set
            </div>
            <button
              className={focusIndia ? "btn btn-accent" : "btn"}
              onClick={toggleFocusIndia}
            >
              🇮🇳 {focusIndia ? "Indian assets" : "Default set"}
            </button>
          </div>

          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div className="label">Result</div>
            <div className="mono" style={{ fontSize: 13, color: "var(--text-bright)" }}>
              {fmtInt(screening?.total_conjunctions)} conjunctions
            </div>
            <div className="note">
              {screening?.from_cache ? "cached" : "computed"} ·{" "}
              {fmt((screening?.pipeline.total_ms ?? 0) / 1000, 1)} s ·{" "}
              {fmtInt(screening?.pipeline.candidates_refined)} refined
            </div>
          </div>
        </div>

        <div className="scroll" style={{ flex: 1 }}>
          {isLoading && !events.length ? (
            <div style={{ padding: 20, display: "grid", gap: 6 }}>
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 30 }} />
              ))}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 42 }}>Rank</th>
                  <th style={{ width: 82 }}>Risk</th>
                  <th style={{ width: 50 }}>Score</th>
                  <th>Primary</th>
                  <th>Secondary</th>
                  <th style={{ width: 88 }}>Miss (km)</th>
                  <th style={{ width: 88 }}>V-rel (km/s)</th>
                  <th style={{ width: 92 }}>TCA (UTC)</th>
                  <th style={{ width: 74 }}>In</th>
                  <th style={{ width: 78 }}>Valid</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.event_id}
                    onClick={() => setSelectedEvent(e.event_id)}
                    style={{
                      cursor: "pointer",
                      background:
                        e.event_id === selectedEventId ? "var(--bg-active)" : undefined,
                    }}
                  >
                    <td className="mono" style={{ color: "var(--text-muted)" }}>
                      #{e.rank}
                    </td>
                    <td>
                      <span className={`chip chip-${e.risk_category}`}>
                        {e.risk_category}
                      </span>
                    </td>
                    <td className="mono">{fmt(e.risk_score, 1)}</td>
                    <td
                      style={{
                        maxWidth: 190,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {flagOf(e.object_a.country_iso)} {e.object_a.name}
                    </td>
                    <td
                      style={{
                        maxWidth: 190,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: "var(--text-dim)",
                      }}
                    >
                      {flagOf(e.object_b.country_iso)} {e.object_b.name}
                    </td>
                    <td className="mono" style={{ color: "var(--high)" }}>
                      {fmt(e.miss_distance_km, 3)}
                    </td>
                    <td className="mono">{fmt(e.relative_speed_km_s, 3)}</td>
                    <td className="mono" style={{ fontSize: 10.5 }}>
                      {fmtTimeUTC(e.tca)}
                    </td>
                    <td className="mono" style={{ fontSize: 10.5 }}>
                      {fmtDuration(e.hours_to_tca)}
                    </td>
                    <td>
                      <span
                        className={`chip chip-${e.validation_status}`}
                        style={{ fontSize: 8 }}
                      >
                        {e.validation_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* --- encounter detail --- */}
      <div
        style={{
          width: 560,
          flexShrink: 0,
          borderLeft: "1px solid var(--line)",
          background: "var(--bg-panel)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="scroll" style={{ flex: 1, padding: 16 }}>
          {!detail ? (
            <div className="empty" style={{ paddingTop: 80 }}>
              <strong>Select a conjunction</strong>
              <span style={{ fontSize: 10.5, maxWidth: 260, lineHeight: 1.6 }}>
                The encounter plane, the propagated separation profile and the
                explanation layer all appear here.
              </span>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <span className={`chip chip-${detail.risk_category}`}>
                    {detail.risk_category}
                  </span>
                  <span className={`chip chip-${detail.validation_status}`}>
                    {detail.validation_status}
                  </span>
                  <span className={`chip chip-${detail.covariance_source}`}>
                    {detail.covariance_source.replace("_", " ")}
                  </span>
                </div>
                <h2
                  style={{
                    fontSize: "var(--fs-med)",
                    fontWeight: 600,
                    color: "var(--text-bright)",
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  {detail.object_a.name}
                  <span style={{ color: "var(--text-faint)" }}> ↔ </span>
                  {detail.object_b.name}
                </h2>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                  TCA {fmtDateUTC(detail.tca)} {fmtTimeUTC(detail.tca)} UTC ·{" "}
                  {fmtDuration(detail.hours_to_tca)} away
                </div>
              </div>

              <BPlaneView eventId={detail.event_id} />

              <div style={{ marginTop: 20 }}>
                {profile && (
                  <ProfileChart
                    tOffsetS={profile.t_offset_s}
                    separationKm={profile.separation_km}
                    rangeRateKmS={profile.range_rate_km_s}
                    missDistanceKm={profile.miss_distance_km}
                  />
                )}
                {profile && (
                  <div className="note" style={{ marginTop: 6 }}>
                    {profile.note}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 22 }}>
                <ExplanationPanel eventId={detail.event_id} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

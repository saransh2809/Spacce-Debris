/**
 * KAKSHA -- right rail: selected object and conjunction analysis.
 *
 * A rule this panel follows throughout: CALCULATED values and METADATA are
 * visually separated, and anything ASSUMED is labelled at the point of use, not
 * in a footnote. A reader must never have to guess whether a number was
 * measured, propagated, or invented by a default.
 */
import { useState } from "react";
import { Glyph, glyphForType } from "../globe/glyphs";
import {
  fmt,
  fmtDateUTC,
  fmtDuration,
  fmtSci,
  fmtTimeUTC,
  flagOf,
} from "../../api/client";
import {
  useConjunctionDetail,
  useConjunctions,
  useObject,
} from "../../hooks/useKaksha";
import { useStore } from "../../store/useStore";
import { BPlaneView } from "../bplane/BPlaneView";
import { ExplanationPanel } from "./ExplanationPanel";
import type { ConjunctionDetail, ObjectResponse } from "../../api/types";

function Row({
  k,
  v,
  mono = true,
  accent,
  title,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
  accent?: string;
  title?: string;
}) {
  return (
    <div className="kv" title={title}>
      <span className="kv-key">{k}</span>
      <span
        className={mono ? "kv-val" : undefined}
        style={{
          color: accent ?? "var(--text-bright)",
          textAlign: "right",
          fontSize: mono ? "var(--fs-small)" : "var(--fs-small)",
          fontFamily: mono ? "var(--font-mono)" : "inherit",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function SectionHead({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 13px 7px",
        borderBottom: "1px solid var(--line)",
        background: "var(--bg-panel-raised)",
      }}
    >
      <span className="section-title">{children}</span>
      {right}
    </div>
  );
}

function Vector({ v, unit }: { v: (number | null)[]; unit: string }) {
  return (
    <span className="mono" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
      {v.map((x, i) => (
        <span key={i} style={{ display: "block" }}>
          <span style={{ color: "var(--text-faint)" }}>{"xyz"[i]}</span>{" "}
          {fmt(x, 3)} {unit}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- object view

function ObjectView({ data }: { data: ObjectResponse }) {
  const o = data.object;
  const s = data.state;
  const setSelectedEvent = useStore((s2) => s2.setSelectedEvent);
  const setFollowSelected = useStore((s2) => s2.setFollowSelected);
  const followSelected = useStore((s2) => s2.followSelected);
  const { data: screening } = useConjunctions(200);

  // The next close approach involving THIS object, taken from the ranked run.
  const next = screening?.events.find(
    (e) => e.object_a.norad_id === o.norad_id || e.object_b.norad_id === o.norad_id,
  );

  return (
    <>
      <SectionHead
        right={
          <span className={`chip chip-${o.element_set.is_stale ? "WARNING" : "OK"}`}>
            {o.element_set.is_stale ? "STALE ELEMENTS" : "ELEMENTS FRESH"}
          </span>
        }
      >
        Selected Object
      </SectionHead>

      <div style={{ padding: "12px 13px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
          <div
            style={{
              width: 42,
              height: 42,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--bg-input)",
              border: "1px solid var(--line-strong)",
              borderRadius: 3,
              fontSize: 19,
            }}
          >
            {/* Same silhouette as the globe and the legend, tinted by class. */}
            <Glyph
              kind={glyphForType(o.object_type)}
              size={30}
              color={OBJECT_TYPE_COLOR[o.object_type] ?? "var(--text-dim)"}
              title={o.object_type}
            />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: "var(--fs-large)",
                fontWeight: 600,
                color: "var(--text-bright)",
                lineHeight: 1.2,
                wordBreak: "break-word",
              }}
            >
              {o.name}
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
              NORAD {o.norad_id} · {o.intl_designator || "—"}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginTop: 4,
                fontSize: 10.5,
                color: "var(--text-dim)",
              }}
            >
              <span style={{ fontSize: 12 }}>{flagOf(o.country_iso)}</span>
              {o.attribution_available ? (
                <span>
                  {o.country} / {o.operator}
                </span>
              ) : (
                <span style={{ color: "var(--warn)" }}>Attribution unavailable</span>
              )}
            </div>
          </div>
        </div>

        <Row k="Object Type" v={o.object_type.replace(/_/g, " ")} mono={false} />
        <Row k="Orbital Regime" v={o.regime} accent="var(--teal)" />
        <Row
          k="Altitude"
          v={s?.earth_fixed ? `${fmt(s.earth_fixed.altitude_km, 2)} km` : "—"}
          title="Geodetic height above the WGS-84 ellipsoid."
        />
        <Row
          k="Perigee × Apogee"
          v={`${fmt(o.perigee_km, 0)} × ${fmt(o.apogee_km, 0)} km`}
        />
        <Row k="Inclination" v={`${fmt(o.element_set.inclination_deg, 3)}°`} />
        <Row k="Period" v={`${fmt(o.element_set.period_min, 2)} min`} />
        <Row k="Eccentricity" v={fmt(o.element_set.eccentricity, 6)} />
        <Row k="RAAN" v={`${fmt(o.element_set.raan_deg, 3)}°`} />
        <Row
          k="Position (lat/lon)"
          v={
            s?.earth_fixed
              ? `${fmt(s.earth_fixed.latitude_deg, 3)}° / ${fmt(s.earth_fixed.longitude_deg, 3)}°`
              : "—"
          }
          title="Sub-satellite point, WGS-84 geodetic."
        />
        <Row k="Speed" v={`${fmt(s?.speed_km_s, 4)} km/s`} />
        <Row
          k="Element Epoch"
          v={`${fmtDateUTC(o.element_set.epoch)} ${fmtTimeUTC(o.element_set.epoch)}`}
        />
        <Row
          k="Propagated"
          v={`${fmt(s?.propagated_days_from_epoch, 3)} d from epoch`}
          accent={o.element_set.is_stale ? "var(--warn)" : undefined}
          title="SGP4 position error grows with distance from the element epoch."
        />
        <Row k="Model" v={s?.propagation_model ?? o.propagation_model} />
        <Row k="Frame" v={s?.frame ?? "TEME"} title="Native SGP4 output frame." />
        <Row
          k="RCS"
          v={o.rcs_available ? `${fmt(o.rcs_m2, 4)} m²` : "not published"}
          accent={o.rcs_available ? undefined : "var(--text-muted)"}
        />

        {data.propagation_status === "FAILED" && (
          <div className="caveat" style={{ marginTop: 10 }}>
            <strong>Propagation failed.</strong> {data.propagation_error}
          </div>
        )}

        <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
          <button
            className={followSelected ? "btn btn-accent" : "btn"}
            onClick={() => setFollowSelected(!followSelected)}
            style={{ width: "100%" }}
          >
            {followSelected ? "◉ Following Object" : "◎ Follow / View Orbit"}
          </button>
          {next && (
            <button
              className="btn btn-danger"
              onClick={() => setSelectedEvent(next.event_id)}
              style={{ width: "100%" }}
            >
              ⚠ Find Close Approaches
            </button>
          )}
        </div>
      </div>

      {next && (
        <>
          <SectionHead
            right={<span className={`chip chip-${next.risk_category}`}>{next.risk_category}</span>}
          >
            Next Close Approach
          </SectionHead>
          <div style={{ padding: "11px 13px" }}>
            <div
              style={{
                textAlign: "center",
                fontSize: "var(--fs-med)",
                color: "var(--text-bright)",
                lineHeight: 1.45,
                marginBottom: 9,
              }}
            >
              <div style={{ wordBreak: "break-word" }}>{next.object_a.name}</div>
              <div style={{ color: "var(--text-faint)", fontSize: 15, margin: "1px 0" }}>
                ⇕
              </div>
              <div style={{ wordBreak: "break-word" }}>{next.object_b.name}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div className="label" style={{ marginBottom: 2 }}>
                  Min Distance
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 17, color: "var(--high)", fontWeight: 600 }}
                >
                  {fmt(next.miss_distance_km, 2)} km
                </div>
              </div>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div className="label" style={{ marginBottom: 2 }}>
                  Time to CA
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 17, color: "var(--text-bright)", fontWeight: 600 }}
                >
                  {fmtDuration(next.hours_to_tca)}
                </div>
              </div>
            </div>
            <button
              className="btn btn-danger"
              style={{ width: "100%", marginTop: 10 }}
              onClick={() => setSelectedEvent(next.event_id)}
            >
              View Event
            </button>
          </div>
        </>
      )}
    </>
  );
}

// ----------------------------------------------------------- conjunction view

function ConjunctionView({ detail }: { detail: ConjunctionDetail }) {
  const [tab, setTab] = useState<"SUMMARY" | "BPLANE" | "WHY" | "EXPLAIN">("SUMMARY");
  const setSelectedEvent = useStore((s) => s.setSelectedEvent);
  const ca = detail.closest_approach;
  const u = detail.uncertainty;
  const bp = detail.bplane;

  return (
    <>
      <SectionHead
        right={
          <button
            className="btn"
            style={{ padding: "4px 8px", fontSize: 9 }}
            onClick={() => setSelectedEvent(null)}
          >
            ✕ Close
          </button>
        }
      >
        Conjunction #{detail.rank}
      </SectionHead>

      <div
        style={{
          padding: "11px 13px",
          borderBottom: "1px solid var(--line)",
          background: "var(--bg-panel-raised)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span className={`chip chip-${detail.risk_category}`}>
            {detail.risk_category}
          </span>
          <span className={`chip chip-${detail.validation_status}`}>
            {detail.validation_status}
          </span>
          <span
            className="mono"
            style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)" }}
          >
            score {fmt(detail.risk_score, 1)}
          </span>
        </div>

        <div style={{ fontSize: "var(--fs-med)", lineHeight: 1.5 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 13 }}>{flagOf(detail.object_a.country_iso)}</span>
            <span style={{ color: "var(--text-bright)", wordBreak: "break-word" }}>
              {detail.object_a.name}
            </span>
          </div>
          <div style={{ color: "var(--text-faint)", fontSize: 12, paddingLeft: 4 }}>↕</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 13 }}>{flagOf(detail.object_b.country_iso)}</span>
            <span style={{ color: "var(--text-bright)", wordBreak: "break-word" }}>
              {detail.object_b.name}
            </span>
          </div>
        </div>
      </div>

      {/* --- headline calculated values --- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          borderBottom: "1px solid var(--line)",
        }}
      >
        {[
          { label: "Miss Distance", value: `${fmt(detail.miss_distance_km, 3)} km`, accent: "var(--high)" },
          { label: "Relative Velocity", value: `${fmt(detail.relative_speed_km_s, 3)} km/s` },
          { label: "Time to TCA", value: fmtDuration(detail.hours_to_tca) },
          { label: "Encounter Angle", value: `${fmt(bp.encounter_angle_deg, 2)}°` },
        ].map((cell, i) => (
          <div
            key={cell.label}
            style={{
              padding: "9px 13px",
              borderRight: i % 2 === 0 ? "1px solid var(--line)" : undefined,
              borderTop: i > 1 ? "1px solid var(--line-faint)" : undefined,
            }}
          >
            <div className="label" style={{ marginBottom: 2 }}>
              {cell.label}
            </div>
            <div
              className="mono"
              style={{ fontSize: 15, color: cell.accent ?? "var(--text-bright)", fontWeight: 600 }}
            >
              {cell.value}
            </div>
          </div>
        ))}
      </div>

      {/* --- tabs --- */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
        {(["SUMMARY", "BPLANE", "WHY", "EXPLAIN"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "8px 4px",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: tab === t ? "var(--teal)" : "var(--text-muted)",
              background: tab === t ? "var(--teal-glow)" : "transparent",
              borderBottom: tab === t ? "2px solid var(--teal)" : "2px solid transparent",
            }}
          >
            {t === "BPLANE" ? "B-PLANE" : t}
          </button>
        ))}
      </div>

      <div style={{ padding: "10px 13px" }}>
        {tab === "SUMMARY" && (
          <>
            <div className="label" style={{ marginBottom: 4 }}>
              Closest Approach — calculated
            </div>
            <Row k="TCA (UTC)" v={`${fmtDateUTC(ca.tca)} ${fmtTimeUTC(ca.tca)}`} />
            <Row k="Miss Distance" v={`${fmt(ca.miss_distance_km, 6)} km`} accent="var(--high)" />
            <Row k="Relative Speed" v={`${fmt(ca.relative_speed_km_s, 6)} km/s`} />
            <Row
              k="Radial Separation"
              v={`${fmt(detail.radial_separation_km, 3)} km`}
              title="How much of the miss is a difference in altitude."
            />
            <Row k="Frame" v={ca.frame} />

            <div className="label" style={{ margin: "12px 0 4px" }}>
              Relative State at TCA
            </div>
            <Row k="Rel. Position" v={<Vector v={ca.relative_position_km} unit="km" />} />
            <Row k="Rel. Velocity" v={<Vector v={ca.relative_velocity_km_s} unit="km/s" />} />

            <div className="label" style={{ margin: "12px 0 4px" }}>
              TCA Solver
            </div>
            <Row k="Method" v={ca.solver.method} mono={false} />
            <Row
              k="Converged"
              v={ca.solver.converged ? "Yes" : "No — window edge"}
              accent={ca.solver.converged ? "var(--ok)" : "var(--warn)"}
            />
            <Row
              k="r·v Residual"
              v={`${fmtSci(ca.solver.range_rate_residual_km2_s, 2)} km²/s`}
              title="Range rate at the reported TCA. Zero to numerical precision means the solver landed exactly on the closest approach."
            />
            <Row k="Fine Samples" v={String(ca.solver.fine_samples)} />

            <div className="label" style={{ margin: "12px 0 4px" }}>
              Uncertainty
            </div>
            <Row
              k="Covariance Source"
              v={
                <span className={`chip chip-${u.source}`}>
                  {u.source.replace("_", " ")}
                </span>
              }
              mono={false}
            />
            <Row
              k="Miss / σ"
              v={`${fmt(u.miss_over_sigma, 3)} σ`}
              accent={
                (u.miss_over_sigma ?? 99) < 2 ? "var(--warn)" : "var(--text-bright)"
              }
              title="Miss distance expressed in combined 1-sigma units."
            />
            <Row k="Mahalanobis" v={fmt(u.mahalanobis_distance, 3)} />
            <Row
              k="σ major / minor"
              v={`${fmt(u.combined_2d.sigma_major_km, 3)} / ${fmt(u.combined_2d.sigma_minor_km, 3)} km`}
            />
            <Row
              k="Hard-Body Radius"
              v={`${fmt(u.hard_body_radius_m, 1)} m`}
              title={u.hard_body_radius_source}
              accent={
                u.hard_body_radius_source.includes("assumed")
                  ? "var(--warn)"
                  : undefined
              }
            />
            <Row
              k={u.is_operational_pc ? "Probability" : "Cond. Probability"}
              v={fmtSci(u.conditional_encounter_probability, 3)}
              accent="var(--text-dim)"
            />

            {u.caveats.map((c, i) => (
              <div className="caveat" key={i} style={{ marginTop: 8 }}>
                {c}
              </div>
            ))}

            <div className="label" style={{ margin: "12px 0 4px" }}>
              Validation
            </div>
            <Row
              k="Status"
              v={
                <span className={`chip chip-${detail.validation.status}`}>
                  {detail.validation.status}
                </span>
              }
              mono={false}
            />
            <Row
              k="Checks Passed"
              v={`${detail.validation.checks_passed} / ${detail.validation.checks_total}`}
            />
            <div className="note" style={{ marginTop: 6 }}>
              {detail.validation.summary}
            </div>
          </>
        )}

        {tab === "BPLANE" && <BPlaneView eventId={detail.event_id} compact />}

        {tab === "WHY" && (
          <>
            <div className="note" style={{ marginBottom: 10 }}>
              {detail.risk.formula}. Category boundaries:{" "}
              {Object.entries(detail.risk.category_boundaries)
                .map(([k, v]) => `${k} ≥ ${v}`)
                .join(", ")}
              .
            </div>
            {detail.risk.components.map((c) => (
              <div
                key={c.name}
                style={{
                  marginBottom: 10,
                  paddingBottom: 9,
                  borderBottom: "1px solid var(--line-faint)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: 3,
                  }}
                >
                  <span
                    style={{
                      fontSize: "var(--fs-small)",
                      color: "var(--text)",
                      textTransform: "capitalize",
                    }}
                  >
                    {c.name.replace(/_/g, " ")}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--teal)" }}>
                    +{fmt(c.points_contributed, 2)} pts
                  </span>
                </div>
                <div
                  style={{
                    height: 4,
                    background: "var(--bg-input)",
                    borderRadius: 2,
                    overflow: "hidden",
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      width: `${c.normalised * 100}%`,
                      height: "100%",
                      background: "var(--teal-dim)",
                    }}
                  />
                </div>
                <div className="mono" style={{ fontSize: 9.5, color: "var(--text-muted)" }}>
                  raw {c.raw_value} {c.units} → normalised {fmt(c.normalised, 4)} × weight{" "}
                  {c.weight}
                </div>
                <div className="note" style={{ marginTop: 3 }}>
                  {c.explanation}
                </div>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                paddingTop: 4,
                fontSize: "var(--fs-small)",
              }}
            >
              <span style={{ color: "var(--text-dim)" }}>Total score</span>
              <span className="mono" style={{ color: "var(--text-bright)", fontWeight: 600 }}>
                {fmt(detail.risk.score, 2)} / 100 → {detail.risk.category}
              </span>
            </div>
            {detail.risk.notes.map((n, i) => (
              <div className="caveat" key={i} style={{ marginTop: 8 }}>
                {n}
              </div>
            ))}
          </>
        )}

        {tab === "EXPLAIN" && <ExplanationPanel eventId={detail.event_id} />}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ container

/** Class colours, kept identical to TYPE_COLORS in Satellites.tsx. */
const OBJECT_TYPE_COLOR: Record<string, string> = {
  ACTIVE_SATELLITE: "#2dd4bf",
  INACTIVE_SATELLITE: "#6b8fa8",
  DEBRIS: "#8792a3",
  ROCKET_BODY: "#e8913c",
  SPACE_STATION: "#8be9fd",
  UNKNOWN: "#5a6478",
};

export function RightRail() {
  const selectedNorad = useStore((s) => s.selectedNorad);
  const selectedEventId = useStore((s) => s.selectedEventId);
  const { data: objectData } = useObject(selectedEventId ? null : selectedNorad);
  const { data: detail, isLoading } = useConjunctionDetail(selectedEventId);

  return (
    <aside
      style={{
        width: "var(--rail-right)",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--line)",
        minHeight: 0,
      }}
    >
      <div className="scroll" style={{ flex: 1 }}>
        {selectedEventId ? (
          isLoading && !detail ? (
            <div style={{ padding: 13, display: "grid", gap: 8 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 26 }} />
              ))}
            </div>
          ) : detail ? (
            <ConjunctionView detail={detail} />
          ) : (
            <div className="empty">Conjunction unavailable.</div>
          )
        ) : objectData ? (
          <ObjectView data={objectData} />
        ) : (
          <>
            <SectionHead>Analysis Panel</SectionHead>
            <div className="empty" style={{ padding: "40px 20px" }}>
              <div style={{ fontSize: 26, opacity: 0.4 }}>🛰</div>
              <strong style={{ color: "var(--text-dim)" }}>Nothing selected</strong>
              <span style={{ fontSize: 10.5, lineHeight: 1.6, maxWidth: 240 }}>
                Click an object on the globe to inspect its propagated state, or
                select a conjunction from the ranked list to open the full
                encounter analysis.
              </span>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

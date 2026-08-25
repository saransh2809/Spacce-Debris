/**
 * KAKSHA -- CALCULATIONS page.
 *
 * The transparency page. It walks a single conjunction from element sets to
 * risk category, showing the actual numbers at each stage and naming the method
 * used. If a reviewer wants to know where a figure came from, this is the page
 * that answers it without anyone having to open the source.
 */
import { useEffect } from "react";
import { fmt, fmtDateUTC, fmtSci, fmtTimeUTC } from "../api/client";
import {
  useConjunctionDetail,
  useConjunctions,
  useMethodology,
} from "../hooks/useKaksha";
import { useStore } from "../store/useStore";

function Stage({
  index,
  title,
  method,
  children,
}: {
  index: number;
  title: string;
  method?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        display: "flex",
        gap: 14,
        paddingBottom: 20,
        marginBottom: 20,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div style={{ flexShrink: 0, width: 30 }}>
        <div
          className="mono"
          style={{
            width: 26,
            height: 26,
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
            border: "1px solid var(--teal-line)",
            color: "var(--teal)",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {index}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3
          style={{
            fontSize: "var(--fs-med)",
            fontWeight: 600,
            color: "var(--text-bright)",
            margin: "2px 0 3px",
          }}
        >
          {title}
        </h3>
        {method && (
          <div
            className="mono"
            style={{
              fontSize: 10.5,
              color: "var(--teal)",
              marginBottom: 9,
              background: "var(--bg-input)",
              padding: "5px 8px",
              borderRadius: 2,
              border: "1px solid var(--line)",
              display: "inline-block",
            }}
          >
            {method}
          </div>
        )}
        <div>{children}</div>
      </div>
    </section>
  );
}

function KV({ k, v, note }: { k: string; v: React.ReactNode; note?: string }) {
  return (
    <div className="kv">
      <span className="kv-key" title={note}>
        {k}
      </span>
      <span className="kv-val">{v}</span>
    </div>
  );
}

export function Calculations() {
  const { data: methodology } = useMethodology();
  const { data: screening } = useConjunctions(50);
  const selectedEventId = useStore((s) => s.selectedEventId);
  const setSelectedEvent = useStore((s) => s.setSelectedEvent);
  const { data: d } = useConjunctionDetail(selectedEventId);

  // Default to the top-ranked event so the page is never empty.
  useEffect(() => {
    if (!selectedEventId && screening?.events.length) {
      setSelectedEvent(screening.events[0].event_id);
    }
  }, [selectedEventId, screening, setSelectedEvent]);

  const ca = d?.closest_approach;
  const bp = d?.bplane;
  const u = d?.uncertainty;

  return (
    <div className="scroll" style={{ flex: 1, background: "var(--bg-app)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "22px 28px 60px" }}>
        <header style={{ marginBottom: 22 }}>
          <h1
            style={{
              fontSize: "var(--fs-huge)",
              fontWeight: 300,
              color: "var(--text-bright)",
              margin: "0 0 6px",
              letterSpacing: "-0.01em",
            }}
          >
            Calculations
          </h1>
          <p
            style={{
              fontSize: "var(--fs-med)",
              color: "var(--text-dim)",
              margin: 0,
              maxWidth: 720,
              lineHeight: 1.65,
            }}
          >
            Every stage of the pipeline for one conjunction, with the actual
            values and the method that produced them. Nothing on this page is
            precomputed or illustrative.
          </p>
        </header>

        {/* event selector */}
        <div style={{ marginBottom: 24 }}>
          <div className="label" style={{ marginBottom: 6 }}>
            Trace a conjunction
          </div>
          <select
            value={selectedEventId ?? ""}
            onChange={(e) => setSelectedEvent(e.target.value || null)}
            style={{ maxWidth: 620 }}
          >
            <option value="">Select…</option>
            {screening?.events.map((e) => (
              <option key={e.event_id} value={e.event_id}>
                #{e.rank} [{e.risk_category}] {e.object_a.name} ↔ {e.object_b.name} —{" "}
                {fmt(e.miss_distance_km, 3)} km
              </option>
            ))}
          </select>
        </div>

        {!d ? (
          <div className="empty">Select a conjunction to trace.</div>
        ) : (
          <>
            <Stage
              index={1}
              title="Orbital element sets"
              method="TLE parse → checksum verify → physical range check"
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {[d.objects.a, d.objects.b].map((o, i) => (
                  <div key={o.norad_id}>
                    <div
                      style={{
                        fontSize: "var(--fs-small)",
                        color: i === 0 ? "var(--teal)" : "var(--amber)",
                        marginBottom: 5,
                        fontWeight: 600,
                      }}
                    >
                      {o.name}
                    </div>
                    <KV k="NORAD" v={o.norad_id} />
                    <KV k="Epoch" v={`${fmtDateUTC(o.element_set.epoch)} ${fmtTimeUTC(o.element_set.epoch)}`} />
                    <KV k="Age at TCA" v={`${fmt(o.element_set.age_days, 4)} d`} />
                    <KV k="Mean motion" v={`${fmt(o.element_set.mean_motion_rev_day, 8)} rev/d`} />
                    <KV k="Eccentricity" v={fmt(o.element_set.eccentricity, 7)} />
                    <KV k="Inclination" v={`${fmt(o.element_set.inclination_deg, 4)}°`} />
                    <KV k="B*" v={o.element_set.bstar?.toExponential(5) ?? "—"} />
                    <KV k="Element type" v={o.element_set.element_type} />
                  </div>
                ))}
              </div>
            </Stage>

            <Stage
              index={2}
              title="SGP4 propagation to TCA"
              method={`${ca?.state_a.propagation_model ?? "SGP4"} → position, velocity in ${ca?.frame ?? "TEME"}`}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {[ca?.state_a, ca?.state_b].map((s, i) =>
                  s ? (
                    <div key={i}>
                      <div
                        style={{
                          fontSize: "var(--fs-small)",
                          color: i === 0 ? "var(--teal)" : "var(--amber)",
                          marginBottom: 5,
                          fontWeight: 600,
                        }}
                      >
                        {i === 0 ? d.object_a.name : d.object_b.name}
                      </div>
                      <KV k="r (TEME)" v={`${s.position_km.map((v) => fmt(v, 4)).join(", ")} km`} />
                      <KV k="v (TEME)" v={`${s.velocity_km_s.map((v) => fmt(v, 6)).join(", ")} km/s`} />
                      <KV k="|r|" v={`${fmt(s.radius_km, 4)} km`} />
                      <KV k="|v|" v={`${fmt(s.speed_km_s, 6)} km/s`} />
                      <KV k="Propagated" v={`${fmt(s.propagated_days_from_epoch, 5)} d from epoch`} />
                    </div>
                  ) : null,
                )}
              </div>
            </Stage>

            <Stage
              index={3}
              title="Broad-phase screening"
              method="apogee/perigee shell overlap → k-d tree spatial query on a coarse time grid"
            >
              {screening && (
                <>
                  <KV
                    k="Objects after shell filter"
                    v={screening.pipeline.objects_considered.toLocaleString()}
                  />
                  <KV
                    k="Geometrically possible pairs"
                    v={screening.pipeline.pairs_geometrically_possible.toLocaleString()}
                  />
                  <KV
                    k="Pairs within coarse gate"
                    v={screening.pipeline.pairs_after_coarse_sweep.toLocaleString()}
                  />
                  <KV k="Coarse step" v={`${fmt(screening.pipeline.coarse_step_s, 0)} s`} />
                  <KV
                    k="Coarse gate"
                    v={`${fmt(screening.pipeline.coarse_gate_km, 1)} km`}
                    note="Distance within which a pair is kept for refinement."
                  />
                  <KV
                    k="Required gate"
                    v={`${fmt(screening.pipeline.required_gate_km, 1)} km`}
                    note="threshold + v_max·step/2. The screener refuses to run below this."
                  />
                  <KV
                    k="Gate is safe"
                    v={
                      <span
                        className={`chip chip-${screening.pipeline.gate_is_safe ? "OK" : "FAILED"}`}
                      >
                        {screening.pipeline.gate_is_safe ? "YES" : "NO"}
                      </span>
                    }
                  />
                  <div className="note" style={{ marginTop: 8, lineHeight: 1.6 }}>
                    A coarse step of {fmt(screening.pipeline.coarse_step_s, 0)} s can hide an
                    encounter unless the gate exceeds the distance two objects can
                    close between samples. With a worst-case relative speed of
                    16 km/s the gate must be at least{" "}
                    {fmt(screening.pipeline.required_gate_km, 1)} km, and the screener
                    refuses to run otherwise rather than silently missing conjunctions.
                  </div>
                </>
              )}
            </Stage>

            <Stage
              index={4}
              title="Time of closest approach"
              method={ca?.solver.method ?? "brentq(range-rate)"}
            >
              <KV k="TCA" v={`${fmtDateUTC(ca?.tca)} ${fmtTimeUTC(ca?.tca)} UTC`} />
              <KV k="Converged" v={ca?.solver.converged ? "yes" : "no — window edge"} />
              <KV k="Fine samples" v={ca?.solver.fine_samples ?? "—"} />
              <KV k="Roots examined" v={ca?.solver.roots_examined ?? "—"} />
              <KV
                k="r·v at TCA"
                v={`${fmtSci(ca?.solver.range_rate_residual_km2_s, 3)} km²/s`}
                note="Should be zero at a true closest approach."
              />
              <div className="note" style={{ marginTop: 8, lineHeight: 1.6 }}>
                {ca?.solver.note}
              </div>
            </Stage>

            <Stage
              index={5}
              title="Relative motion and miss distance"
              method="r_rel = r_a − r_b, evaluated at the refined TCA"
            >
              <KV k="Relative position" v={`${ca?.relative_position_km.map((v) => fmt(v, 5)).join(", ")} km`} />
              <KV k="Relative velocity" v={`${ca?.relative_velocity_km_s.map((v) => fmt(v, 6)).join(", ")} km/s`} />
              <KV k="Miss distance |r_rel|" v={`${fmt(ca?.miss_distance_km, 6)} km`} />
              <KV k="Relative speed |v_rel|" v={`${fmt(ca?.relative_speed_km_s, 6)} km/s`} />
              <KV k="Radial separation" v={`${fmt(d.radial_separation_km, 4)} km`} />
            </Stage>

            <Stage
              index={6}
              title="Encounter plane (B-plane)"
              method="η = v_rel/|v_rel| · ξ = (v_b × v_a)/|v_b × v_a| · ζ = ξ × η"
            >
              <KV k="ξ̂ (TEME)" v={bp?.axes_teme.xi_hat.map((v) => fmt(v, 6)).join(", ")} />
              <KV k="η̂ (TEME)" v={bp?.axes_teme.eta_hat.map((v) => fmt(v, 6)).join(", ")} />
              <KV k="ζ̂ (TEME)" v={bp?.axes_teme.zeta_hat.map((v) => fmt(v, 6)).join(", ")} />
              <KV k="Miss vector b" v={`ξ ${fmt(bp?.miss_vector_km.xi, 5)}, ζ ${fmt(bp?.miss_vector_km.zeta, 5)} km`} />
              <KV k="|b|" v={`${fmt(bp?.miss_distance_km, 6)} km`} />
              <KV
                k="η residual"
                v={`${fmtSci(bp?.out_of_plane_residual_km, 3)} km`}
                note="Out-of-plane component of the miss vector."
              />
              <KV k="Encounter angle" v={`${fmt(bp?.encounter_angle_deg, 4)}°`} />
              <div className="note" style={{ marginTop: 8, lineHeight: 1.6 }}>
                {bp?.out_of_plane_residual_note}
              </div>
            </Stage>

            <Stage
              index={7}
              title="Uncertainty"
              method={`covariance source: ${u?.source} · C_rel = C_a + C_b · projected to the encounter plane`}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {[
                  { label: d.object_a.name, o: u?.object_a },
                  { label: d.object_b.name, o: u?.object_b },
                ].map((entry, i) => (
                  <div key={i}>
                    <div
                      style={{
                        fontSize: "var(--fs-small)",
                        color: i === 0 ? "var(--teal)" : "var(--amber)",
                        marginBottom: 5,
                        fontWeight: 600,
                      }}
                    >
                      {entry.label}
                    </div>
                    <KV k="σ radial" v={`${fmt(entry.o?.sigma_radial_km, 4)} km`} />
                    <KV k="σ in-track" v={`${fmt(entry.o?.sigma_in_track_km, 4)} km`} />
                    <KV k="σ cross-track" v={`${fmt(entry.o?.sigma_cross_track_km, 4)} km`} />
                    <KV k="RSS σ" v={`${fmt(entry.o?.rss_sigma_km, 4)} km`} />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <KV k="σ major (2D)" v={`${fmt(u?.combined_2d.sigma_major_km, 5)} km`} />
                <KV k="σ minor (2D)" v={`${fmt(u?.combined_2d.sigma_minor_km, 5)} km`} />
                <KV k="Ellipse orientation" v={`${fmt(u?.combined_2d.orientation_deg, 3)}°`} />
                <KV k="Mahalanobis distance" v={fmt(u?.mahalanobis_distance, 4)} />
                <KV k="Miss / σ" v={`${fmt(u?.miss_over_sigma, 4)} σ`} />
                <KV k="Hard-body radius" v={`${fmt(u?.hard_body_radius_m, 2)} m (${u?.hard_body_radius_source})`} />
                <KV k={u?.probability_label ?? "Probability"} v={fmtSci(u?.conditional_encounter_probability, 4)} />
              </div>
              {u?.caveats.map((c, i) => (
                <div className="caveat" key={i} style={{ marginTop: 9 }}>
                  {c}
                </div>
              ))}
            </Stage>

            <Stage
              index={8}
              title="Validation"
              method="independent re-derivation from the state vectors, with tolerances"
            >
              <div style={{ marginBottom: 10 }}>
                <span className={`chip chip-${d.validation.status}`}>
                  {d.validation.status}
                </span>
                <span
                  className="mono"
                  style={{ marginLeft: 10, fontSize: 11, color: "var(--text-dim)" }}
                >
                  {d.validation.checks_passed} / {d.validation.checks_total} checks passed
                </span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Check</th>
                    <th style={{ width: 60 }}>Result</th>
                    <th style={{ width: 110 }}>Measured</th>
                    <th style={{ width: 110 }}>Tolerance</th>
                  </tr>
                </thead>
                <tbody>
                  {d.validation.checks.map((c) => (
                    <tr key={c.name}>
                      <td>
                        <div style={{ color: "var(--text)" }}>
                          {c.name.replace(/_/g, " ")}
                        </div>
                        <div className="note">{c.detail}</div>
                      </td>
                      <td>
                        <span
                          className={`chip chip-${c.passed ? "OK" : c.status}`}
                          style={{ fontSize: 8 }}
                        >
                          {c.passed ? "PASS" : c.status}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 10.5 }}>
                        {c.measured !== null ? `${fmtSci(c.measured, 3)} ${c.units}` : "—"}
                      </td>
                      <td className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                        {c.tolerance !== null ? `${fmtSci(c.tolerance, 3)} ${c.units}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Stage>

            <Stage index={9} title="Risk score" method={d.risk.formula}>
              <table>
                <thead>
                  <tr>
                    <th>Component</th>
                    <th style={{ width: 110 }}>Raw</th>
                    <th style={{ width: 90 }}>Normalised</th>
                    <th style={{ width: 70 }}>Weight</th>
                    <th style={{ width: 70 }}>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {d.risk.components.map((c) => (
                    <tr key={c.name}>
                      <td>
                        <div style={{ textTransform: "capitalize" }}>
                          {c.name.replace(/_/g, " ")}
                        </div>
                        <div className="note">{c.explanation}</div>
                      </td>
                      <td className="mono">
                        {c.raw_value} {c.units}
                      </td>
                      <td className="mono">{fmt(c.normalised, 4)}</td>
                      <td className="mono">{c.weight}</td>
                      <td className="mono" style={{ color: "var(--teal)" }}>
                        {fmt(c.points_contributed, 2)}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: "var(--bg-panel-raised)" }}>
                    <td colSpan={4} style={{ textAlign: "right", fontWeight: 600 }}>
                      Total score
                    </td>
                    <td className="mono" style={{ color: "var(--text-bright)", fontWeight: 600 }}>
                      {fmt(d.risk.score, 2)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div style={{ marginTop: 10 }}>
                <span className="label">Category boundaries: </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {Object.entries(d.risk.category_boundaries)
                    .map(([k, v]) => `${k} ≥ ${v}`)
                    .join("  ·  ")}
                </span>
                <span style={{ marginLeft: 12 }}>
                  <span className={`chip chip-${d.risk_category}`}>{d.risk_category}</span>
                </span>
              </div>
            </Stage>

            {/* --- methodology reference --- */}
            {methodology && (
              <section style={{ marginTop: 8 }}>
                <h2
                  style={{
                    fontSize: "var(--fs-large)",
                    fontWeight: 500,
                    color: "var(--text-bright)",
                    margin: "0 0 12px",
                  }}
                >
                  Reference frames and terminology
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                  <div>
                    <div className="label" style={{ marginBottom: 6 }}>
                      Frames
                    </div>
                    {Object.entries(methodology.frames).map(([k, v]) => (
                      <KV key={k} k={k.replace(/_/g, " ")} v={v} />
                    ))}
                  </div>
                  <div>
                    <div className="label" style={{ marginBottom: 6 }}>
                      Terminology
                    </div>
                    {Object.entries(methodology.terminology).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 8 }}>
                        <div
                          className="mono"
                          style={{ fontSize: 11, color: "var(--teal)" }}
                        >
                          {k.replace(/_/g, " ")}
                        </div>
                        <div className="note">{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

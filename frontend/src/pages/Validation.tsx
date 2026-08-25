/**
 * KAKSHA -- VALIDATION page.
 *
 * The page that argues for the credibility of everything else. It reports data
 * quality, the outcome of every numerical check, the assumed uncertainty model
 * in full, and a plain-language list of what the system cannot do.
 *
 * Stating limitations explicitly is not a weakness in a scientific tool. A
 * system that cannot describe its own error budget is the one to distrust.
 */
import { useState } from "react";
import { fmt, fmtAge, fmtInt, fmtSci } from "../api/client";
import { useDebug, useValidation } from "../hooks/useKaksha";

function Panel({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-header">
        <span className="section-title">{title}</span>
        {right}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function KV({ k, v, accent }: { k: string; v: React.ReactNode; accent?: string }) {
  return (
    <div className="kv">
      <span className="kv-key">{k}</span>
      <span className="kv-val" style={{ color: accent }}>
        {v}
      </span>
    </div>
  );
}

export function Validation() {
  const { data, isLoading } = useValidation();
  const [debugOpen, setDebugOpen] = useState(false);
  const { data: debug } = useDebug(debugOpen);

  if (isLoading && !data) {
    return (
      <div style={{ flex: 1, padding: 28 }}>
        <div className="skeleton" style={{ height: 200, marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 300 }} />
      </div>
    );
  }
  if (!data) return <div className="empty">Validation unavailable.</div>;

  const dq = data.data_quality;
  const cv = data.conjunction_validation;
  const um = data.uncertainty_model as Record<string, never>;

  return (
    <div className="scroll" style={{ flex: 1, background: "var(--bg-app)" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "22px 28px 60px" }}>
        <header style={{ marginBottom: 24 }}>
          <h1
            style={{
              fontSize: "var(--fs-huge)",
              fontWeight: 300,
              color: "var(--text-bright)",
              margin: "0 0 6px",
            }}
          >
            Validation
          </h1>
          <p
            style={{
              fontSize: "var(--fs-med)",
              color: "var(--text-dim)",
              margin: 0,
              maxWidth: 760,
              lineHeight: 1.65,
            }}
          >
            Data quality, numerical checks and stated limitations. Results that
            fail validation are kept and shown here, but are excluded from the
            ranked list rather than being quietly dropped.
          </p>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* --- data quality --- */}
          <Panel
            title="Orbital Data Quality"
            right={
              <span className={`chip chip-${dq.degraded ? "WARNING" : "OK"}`}>
                {dq.degraded ? "DEGRADED" : "NOMINAL"}
              </span>
            }
          >
            <KV k="Provider" v={dq.provider} />
            <KV k="Retrieved" v={fmtAge(dq.data_age_seconds)} />
            <KV k="Served from cache" v={dq.served_from_cache ? "yes" : "no"} />
            <KV k="Objects indexed" v={fmtInt(dq.total_objects)} />
            <KV
              k="Median element age"
              v={`${fmt(dq.median_element_age_days, 3)} days`}
              accent={
                (dq.median_element_age_days ?? 0) > dq.warn_threshold_days
                  ? "var(--warn)"
                  : undefined
              }
            />
            <KV
              k="Stale objects"
              v={`${fmtInt(dq.stale_objects)} (> ${fmt(dq.stale_threshold_days, 0)} d)`}
              accent={dq.stale_objects > 0 ? "var(--warn)" : "var(--ok)"}
            />
            <KV
              k="Records rejected at parse"
              v={fmtInt(dq.rejected_records)}
              accent={dq.rejected_records > 0 ? "var(--warn)" : "var(--ok)"}
            />
            <KV
              k="Attribution missing"
              v={fmtInt(dq.attribution_missing)}
              accent={dq.attribution_missing > 0 ? "var(--warn)" : "var(--ok)"}
            />
            {Object.keys(dq.rejection_reasons).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="label" style={{ marginBottom: 4 }}>
                  Rejection reasons
                </div>
                {Object.entries(dq.rejection_reasons).map(([reason, n]) => (
                  <KV key={reason} k={reason.replace(/_/g, " ")} v={String(n)} />
                ))}
              </div>
            )}
            {dq.notes.map((n, i) => (
              <div className="caveat" key={i} style={{ marginTop: 9 }}>
                {n}
              </div>
            ))}
          </Panel>

          {/* --- catalogue checks --- */}
          <Panel
            title="Catalogue Checks"
            right={
              <span className={`chip chip-${data.catalog_validation.status}`}>
                {data.catalog_validation.status}
              </span>
            }
          >
            {data.catalog_validation.checks.map((c, i) => (
              <div
                key={`${c.name}-${i}`}
                style={{
                  display: "flex",
                  gap: 9,
                  padding: "7px 0",
                  borderBottom: "1px solid var(--line-faint)",
                }}
              >
                <span style={{ fontSize: 11, flexShrink: 0, marginTop: 1 }}>
                  {c.passed ? "✓" : c.status === "WARNING" ? "!" : "✕"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "var(--fs-small)",
                      color: c.passed ? "var(--text)" : "var(--warn)",
                    }}
                  >
                    {c.name.replace(/_/g, " ")}
                  </div>
                  <div className="note">{c.detail}</div>
                </div>
              </div>
            ))}
          </Panel>
        </div>

        {/* --- per-conjunction check totals --- */}
        <Panel title="Numerical Checks Across All Conjunctions">
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {Object.entries(cv.status_counts).map(([status, n]) => (
              <span key={status} className={`chip chip-${status}`}>
                {status}: {n}
              </span>
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>Check</th>
                <th style={{ width: 90 }}>Passed</th>
                <th style={{ width: 90 }}>Raised</th>
                <th style={{ width: 180 }}>Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(cv.check_totals)
                .sort((a, b) => b[1].failed - a[1].failed)
                .map(([name, t]) => {
                  const total = t.passed + t.failed;
                  const rate = total ? t.passed / total : 1;
                  return (
                    <tr key={name}>
                      <td>{name.replace(/_/g, " ")}</td>
                      <td className="mono" style={{ color: "var(--ok)" }}>
                        {t.passed}
                      </td>
                      <td
                        className="mono"
                        style={{ color: t.failed ? "var(--warn)" : "var(--text-faint)" }}
                      >
                        {t.failed}
                      </td>
                      <td>
                        <div
                          style={{
                            height: 4,
                            background: "var(--bg-input)",
                            borderRadius: 2,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${rate * 100}%`,
                              height: "100%",
                              background: rate === 1 ? "var(--ok)" : "var(--warn)",
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <div className="note" style={{ marginTop: 10, lineHeight: 1.6 }}>
            <strong style={{ color: "var(--text-dim)" }}>
              Why "covariance published" always raises:
            </strong>{" "}
            public GP/TLE data does not include covariance. That check is expected
            to fail on every conjunction, and it is surfaced rather than
            suppressed precisely so the assumption is never invisible.
          </div>
        </Panel>

        {/* --- rejected --- */}
        {cv.rejected_events.length > 0 && (
          <Panel
            title="Results Excluded From the Ranked List"
            right={<span className="chip chip-INVALID">{cv.rejected_events.length}</span>}
          >
            <table>
              <thead>
                <tr>
                  <th>Objects</th>
                  <th style={{ width: 90 }}>Miss (km)</th>
                  <th>Failed checks</th>
                </tr>
              </thead>
              <tbody>
                {cv.rejected_events.map((e) => (
                  <tr key={e.event_id}>
                    <td>
                      {e.object_a.name} ↔ {e.object_b.name}
                    </td>
                    <td className="mono">{fmt(e.miss_distance_km, 3)}</td>
                    <td className="note">{e.failed_checks.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* --- uncertainty model --- */}
          <Panel
            title="Assumed Uncertainty Model"
            right={<span className="chip chip-ASSUMED_MODEL">ASSUMED</span>}
          >
            <KV k="Name" v={um.name as unknown as string} />
            <KV k="Frame" v={um.frame as unknown as string} />
            <KV k="Form" v={um.form as unknown as string} />
            <KV k="Correlations" v={um.correlations as unknown as string} />
            <div className="label" style={{ margin: "12px 0 4px" }}>
              1-sigma at epoch (km)
            </div>
            {Object.entries(um.sigma_0_km ?? {}).map(([k, v]) => (
              <KV key={k} k={k.replace(/_/g, " ")} v={fmt(v as number, 3)} />
            ))}
            <div className="label" style={{ margin: "12px 0 4px" }}>
              Growth (km per day from epoch)
            </div>
            {Object.entries(um.growth_km_per_day ?? {}).map(([k, v]) => (
              <KV key={k} k={k.replace(/_/g, " ")} v={fmt(v as number, 3)} />
            ))}
            <div style={{ marginTop: 12 }}>
              <KV k="Combination" v={um.combination_rule as unknown as string} />
              <KV k="Hard-body radius" v={um.hard_body_radius as unknown as string} />
            </div>
            <div className="caveat" style={{ marginTop: 12 }}>
              <strong>These sigmas are an engineering assumption, not a measurement.</strong>{" "}
              Any probability derived from them is conditional on this model and
              must not be used for operational collision avoidance.
            </div>
          </Panel>

          {/* --- risk model --- */}
          <Panel title="Risk Scoring Configuration">
            <KV
              k="Formula"
              v={(data.risk_model as Record<string, string>).formula}
            />
            <div className="label" style={{ margin: "12px 0 4px" }}>
              Weights
            </div>
            {Object.entries(
              (data.risk_model as Record<string, Record<string, number>>).weights ?? {},
            ).map(([k, v]) => (
              <KV key={k} k={k.replace(/_/g, " ")} v={fmt(v, 2)} />
            ))}
            <KV
              k="Weights sum"
              v={fmt(
                (data.risk_model as Record<string, number>).weights_sum,
                6,
              )}
              accent="var(--ok)"
            />
            <div className="label" style={{ margin: "12px 0 4px" }}>
              Normalisation
            </div>
            {Object.entries(
              (data.risk_model as Record<string, Record<string, string>>).normalisation ?? {},
            ).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {k.replace(/_/g, " ")}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--teal)" }}>
                  {v}
                </div>
              </div>
            ))}
            <div className="caveat" style={{ marginTop: 10 }}>
              {(data.risk_model as Record<string, string>).disclaimer}
            </div>
          </Panel>
        </div>

        {/* --- pipeline diagnostics --- */}
        <Panel title="Pipeline Diagnostics">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 14,
            }}
          >
            {Object.entries(data.pipeline_diagnostics).map(([k, v]) => (
              <div key={k}>
                <div className="label" style={{ marginBottom: 2 }}>
                  {k.replace(/_/g, " ")}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 15,
                    color:
                      typeof v === "boolean"
                        ? v
                          ? "var(--ok)"
                          : "var(--bad)"
                        : "var(--text-bright)",
                  }}
                >
                  {typeof v === "boolean"
                    ? v
                      ? "YES"
                      : "NO"
                    : typeof v === "number"
                      ? v > 9999
                        ? fmtInt(v)
                        : fmt(v, 1)
                      : "—"}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* --- limitations --- */}
        <Panel title="Stated Limitations">
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 9 }}>
            {data.stated_limitations.map((limit, i) => (
              <li
                key={i}
                style={{
                  fontSize: "var(--fs-small)",
                  color: "var(--text-dim)",
                  lineHeight: 1.65,
                }}
              >
                {limit}
              </li>
            ))}
          </ol>
        </Panel>

        {/* --- debug --- */}
        <Panel
          title="Observability / Debug"
          right={
            <button
              className={debugOpen ? "btn btn-accent" : "btn"}
              style={{ padding: "3px 9px", fontSize: 9 }}
              onClick={() => setDebugOpen((o) => !o)}
            >
              {debugOpen ? "Streaming" : "Enable"}
            </button>
          }
        >
          {!debugOpen ? (
            <div className="note">
              Live pipeline counters, screening-cache state and the structured
              event log. Polls every four seconds while enabled.
            </div>
          ) : !debug ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 18,
                  marginBottom: 14,
                }}
              >
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>
                    Clock
                  </div>
                  {Object.entries(debug.clock).map(([k, v]) => (
                    <KV key={k} k={k.replace(/_/g, " ")} v={String(v)} />
                  ))}
                </div>
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>
                    Catalogue
                  </div>
                  {Object.entries(debug.catalog).map(([k, v]) => (
                    <KV key={k} k={k.replace(/_/g, " ")} v={String(v)} />
                  ))}
                </div>
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>
                    Configuration
                  </div>
                  {Object.entries(debug.config).map(([k, v]) => (
                    <KV key={k} k={k.replace(/_/g, " ")} v={String(v)} />
                  ))}
                </div>
              </div>

              <div className="label" style={{ marginBottom: 6 }}>
                Screening cache
              </div>
              <table style={{ marginBottom: 14 }}>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th style={{ width: 70 }}>Events</th>
                    <th style={{ width: 80 }}>Age (s)</th>
                    <th style={{ width: 70 }}>Fresh</th>
                    <th style={{ width: 90 }}>Compute (ms)</th>
                  </tr>
                </thead>
                <tbody>
                  {debug.screening_cache.map((entry, i) => (
                    <tr key={i}>
                      <td>{String(entry.label)}</td>
                      <td className="mono">{String(entry.events)}</td>
                      <td className="mono">{String(entry.age_seconds)}</td>
                      <td>
                        <span className={`chip chip-${entry.fresh ? "OK" : "WARNING"}`}>
                          {entry.fresh ? "YES" : "STALE"}
                        </span>
                      </td>
                      <td className="mono">{String(entry.elapsed_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="label" style={{ marginBottom: 6 }}>
                Recent pipeline events
              </div>
              <div
                className="mono scroll"
                style={{
                  maxHeight: 260,
                  fontSize: 10,
                  background: "var(--bg-void)",
                  border: "1px solid var(--line)",
                  borderRadius: 3,
                  padding: 9,
                }}
              >
                {debug.recent_events.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "2px 0",
                      color:
                        e.level === "ERROR"
                          ? "var(--bad)"
                          : e.level === "WARNING"
                            ? "var(--warn)"
                            : "var(--text-muted)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    <span style={{ color: "var(--text-faint)" }}>
                      {String(e.ts).slice(11, 23)}
                    </span>{" "}
                    <span style={{ color: "var(--teal)" }}>[{String(e.stage)}]</span>{" "}
                    {String(e.event)}{" "}
                    {Object.entries(e)
                      .filter(
                        ([k]) => !["ts", "level", "stage", "event"].includes(k),
                      )
                      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                      .join(" ")}
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

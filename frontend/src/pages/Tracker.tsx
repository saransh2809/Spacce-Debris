/**
 * KAKSHA -- TRACKER page.
 *
 * Tabular view of the catalogue with live propagated state for the selected
 * object, its orbit path and its ground track. Where the dashboard is for
 * situational awareness, this page is for looking one object up and reading
 * its numbers exactly.
 */
import { useMemo, useState } from "react";
import {
  fmt,
  fmtDateUTC,
  fmtInt,
  fmtTimeUTC,
  flagOf,
} from "../api/client";
import {
  useCatalogSummary,
  useObject,
  useSearch,
} from "../hooks/useKaksha";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useStore } from "../store/useStore";
import { GlobeScene } from "../components/globe/GlobeScene";
import { HoverCard } from "../components/panels/HoverCard";
import { TimelineBar } from "../components/layout/StatStrip";

function GroundTrack({ noradId }: { noradId: number }) {
  const { data } = useQuery({
    queryKey: ["groundtrack", noradId],
    queryFn: () => api.groundTrack(noradId, { revolutions: 2 }),
    staleTime: 60_000,
  });

  if (!data) return <div className="skeleton" style={{ height: 150 }} />;

  const w = 720;
  const h = 360;
  const project = (lat: number, lon: number) => [
    ((lon + 180) / 360) * w,
    ((90 - lat) / 180) * h,
  ];

  // Split the polyline wherever it wraps the antimeridian, so the track does
  // not draw a false horizontal line across the whole map.
  const segments: string[] = [];
  let current = "";
  let prevLon: number | null = null;
  for (let i = 0; i < data.longitude_deg.length; i++) {
    const lat = data.latitude_deg[i];
    const lon = data.longitude_deg[i];
    if (lat === null || lon === null) continue;
    if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
      segments.push(current);
      current = "";
    }
    const [x, y] = project(lat, lon);
    current += `${current ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)} `;
    prevLon = lon;
  }
  if (current) segments.push(current);

  const last = (() => {
    for (let i = data.latitude_deg.length - 1; i >= 0; i--) {
      const lat = data.latitude_deg[i];
      const lon = data.longitude_deg[i];
      if (lat !== null && lon !== null) return project(lat, lon);
    }
    return null;
  })();

  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>
        Ground Track — 2 revolutions
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        style={{
          background: "var(--bg-void)",
          border: "1px solid var(--line)",
          borderRadius: 3,
          display: "block",
        }}
      >
        {/* graticule */}
        {[-60, -30, 0, 30, 60].map((lat) => (
          <line
            key={lat}
            x1="0"
            y1={((90 - lat) / 180) * h}
            x2={w}
            y2={((90 - lat) / 180) * h}
            stroke={lat === 0 ? "#2a3a4e" : "#141d29"}
            strokeWidth={lat === 0 ? 1 : 0.5}
          />
        ))}
        {[-120, -60, 0, 60, 120].map((lon) => (
          <line
            key={lon}
            x1={((lon + 180) / 360) * w}
            y1="0"
            x2={((lon + 180) / 360) * w}
            y2={h}
            stroke={lon === 0 ? "#2a3a4e" : "#141d29"}
            strokeWidth={lon === 0 ? 1 : 0.5}
          />
        ))}
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#2dd4bf" strokeWidth="1.5" opacity="0.85" />
        ))}
        {last && <circle cx={last[0]} cy={last[1]} r="4" fill="#f0a030" />}
      </svg>
      <div className="note" style={{ marginTop: 5 }}>
        {data.approximations.join(" ")}
      </div>
    </div>
  );
}

export function Tracker() {
  const [query, setQuery] = useState("");
  const selectedNorad = useStore((s) => s.selectedNorad);
  const setSelectedNorad = useStore((s) => s.setSelectedNorad);
  const setFollowSelected = useStore((s) => s.setFollowSelected);
  const setSelectedEvent = useStore((s) => s.setSelectedEvent);

  const { data: summary } = useCatalogSummary();
  const { data: searchData } = useSearch(query);
  const { data: detail } = useObject(selectedNorad);

  const { data: listing } = useQuery({
    queryKey: ["tracker-listing"],
    queryFn: () => api.objects({ limit: 300 }),
    staleTime: 300_000,
  });

  const rows = useMemo(
    () => (query.trim().length >= 2 ? (searchData?.results ?? []) : (listing?.objects ?? [])),
    [query, searchData, listing],
  );

  const o = detail?.object;
  const s = detail?.state;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* --- catalogue table --- */}
        <div
          style={{
            width: 420,
            flexShrink: 0,
            borderRight: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-panel)",
          }}
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span className="section-title">Object Catalogue</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {fmtInt(summary?.total_objects)}
              </span>
            </div>
            <input
              type="search"
              placeholder="Search name, NORAD ID, operator…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="scroll" style={{ flex: 1 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 62 }}>NORAD</th>
                  <th>Name</th>
                  <th style={{ width: 58 }}>Regime</th>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.norad_id}
                    onClick={() => {
                      setSelectedEvent(null);
                      setSelectedNorad(row.norad_id);
                      setFollowSelected(true);
                    }}
                    style={{
                      cursor: "pointer",
                      background:
                        row.norad_id === selectedNorad ? "var(--bg-active)" : undefined,
                    }}
                  >
                    <td className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                      {row.norad_id}
                    </td>
                    <td
                      style={{
                        maxWidth: 190,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row.name}
                    </td>
                    <td className="mono" style={{ fontSize: 10, color: "var(--text-dim)" }}>
                      {row.regime}
                    </td>
                    <td style={{ fontSize: 12 }}>{flagOf(row.country_iso)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* --- globe --- */}
        <div style={{ flex: 1, position: "relative", minWidth: 0, background: "var(--bg-void)" }}>
          <GlobeScene />
        </div>

        {/* --- numeric detail --- */}
        <div
          style={{
            width: 400,
            flexShrink: 0,
            borderLeft: "1px solid var(--line)",
            background: "var(--bg-panel)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div className="scroll" style={{ flex: 1, padding: 14 }}>
            {!o ? (
              <div className="empty" style={{ paddingTop: 60 }}>
                <strong>Select an object</strong>
                <span style={{ fontSize: 10.5 }}>
                  Choose a row to see its propagated state, orbit and ground track.
                </span>
              </div>
            ) : (
              <>
                <h2
                  style={{
                    fontSize: "var(--fs-xl)",
                    fontWeight: 600,
                    color: "var(--text-bright)",
                    margin: "0 0 3px",
                    wordBreak: "break-word",
                  }}
                >
                  {o.name}
                </h2>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14 }}
                >
                  NORAD {o.norad_id} · {o.intl_designator || "—"} ·{" "}
                  {flagOf(o.country_iso)} {o.country}
                </div>

                <GroundTrack noradId={o.norad_id} />

                <div className="label" style={{ margin: "16px 0 6px" }}>
                  Propagated State — {s?.frame ?? "TEME"} at {fmtTimeUTC(detail?.time)} UTC
                </div>
                {s && (
                  <>
                    <div className="kv">
                      <span className="kv-key">Position</span>
                      <span className="kv-val">
                        {s.position_km.map((v) => fmt(v, 3)).join(", ")} km
                      </span>
                    </div>
                    <div className="kv">
                      <span className="kv-key">Velocity</span>
                      <span className="kv-val">
                        {s.velocity_km_s.map((v) => fmt(v, 5)).join(", ")} km/s
                      </span>
                    </div>
                    <div className="kv">
                      <span className="kv-key">Geocentric radius</span>
                      <span className="kv-val">{fmt(s.radius_km, 3)} km</span>
                    </div>
                    <div className="kv">
                      <span className="kv-key">Speed</span>
                      <span className="kv-val">{fmt(s.speed_km_s, 5)} km/s</span>
                    </div>
                    {s.earth_fixed && (
                      <>
                        <div className="kv">
                          <span className="kv-key">Sub-satellite point</span>
                          <span className="kv-val">
                            {fmt(s.earth_fixed.latitude_deg, 4)}°,{" "}
                            {fmt(s.earth_fixed.longitude_deg, 4)}°
                          </span>
                        </div>
                        <div className="kv">
                          <span className="kv-key">Altitude (WGS-84)</span>
                          <span className="kv-val">
                            {fmt(s.earth_fixed.altitude_km, 3)} km
                          </span>
                        </div>
                      </>
                    )}
                  </>
                )}

                <div className="label" style={{ margin: "16px 0 6px" }}>
                  Osculating Elements — from the propagated state
                </div>
                {s &&
                  [
                    ["Semi-major axis", "semi_major_axis_km", 3, "km"],
                    ["Eccentricity", "eccentricity", 6, ""],
                    ["Inclination", "inclination_deg", 4, "°"],
                    ["RAAN", "raan_deg", 4, "°"],
                    ["Arg. of perigee", "arg_perigee_deg", 4, "°"],
                    ["True anomaly", "true_anomaly_deg", 4, "°"],
                    ["Period", "period_min", 4, "min"],
                  ].map(([label, key, digits, unit]) => (
                    <div className="kv" key={key as string}>
                      <span className="kv-key">{label as string}</span>
                      <span className="kv-val">
                        {fmt(s.osculating_elements[key as string] as number, digits as number)}{" "}
                        {unit as string}
                      </span>
                    </div>
                  ))}
                <div className="note" style={{ marginTop: 5 }}>
                  {s?.osculating_elements.note as string}
                </div>

                <div className="label" style={{ margin: "16px 0 6px" }}>
                  Element Set — SGP4 mean elements
                </div>
                <div className="kv">
                  <span className="kv-key">Epoch</span>
                  <span className="kv-val">
                    {fmtDateUTC(o.element_set.epoch)} {fmtTimeUTC(o.element_set.epoch)}
                  </span>
                </div>
                <div className="kv">
                  <span className="kv-key">Age</span>
                  <span
                    className="kv-val"
                    style={{ color: o.element_set.is_stale ? "var(--warn)" : undefined }}
                  >
                    {fmt(o.element_set.age_days, 4)} days
                  </span>
                </div>
                <div className="kv">
                  <span className="kv-key">Mean motion</span>
                  <span className="kv-val">
                    {fmt(o.element_set.mean_motion_rev_day, 8)} rev/day
                  </span>
                </div>
                <div className="kv">
                  <span className="kv-key">B*</span>
                  <span className="kv-val">{o.element_set.bstar?.toExponential(5) ?? "—"}</span>
                </div>
                <div className="kv">
                  <span className="kv-key">Element set #</span>
                  <span className="kv-val">{o.element_set.element_set_number}</span>
                </div>
                <div className="kv">
                  <span className="kv-key">Rev at epoch</span>
                  <span className="kv-val">{o.element_set.rev_at_epoch}</span>
                </div>
                <div className="kv">
                  <span className="kv-key">Source</span>
                  <span className="kv-val">{o.element_set.source}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <TimelineBar />
      <HoverCard />
    </div>
  );
}

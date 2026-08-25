/**
 * KAKSHA -- left rail: object catalogue and ranked conjunction list.
 *
 * The reference design puts the catalogue here; the problem statement puts the
 * ranked conjunction list here. Both belong, so the rail carries a segmented
 * switch and keeps the catalogue's search box permanently visible, because
 * search is how an operator actually starts most tasks.
 *
 * Ranking is NOT recomputed here. The order arrives from the risk engine and
 * is rendered as received; the `rank` badge is the server's number.
 */
import { useMemo, useState } from "react";
import {
  fmt,
  fmtDuration,
  fmtInt,
  fmtTimeUTC,
  flagOf,
} from "../../api/client";
import {
  useCatalogSummary,
  useConjunctions,
  useSearch,
} from "../../hooks/useKaksha";
import { useStore, type LayerToggles } from "../../store/useStore";
import type { ConjunctionBrief, ObjectBrief } from "../../api/types";

function Check({ checked }: { checked: boolean }) {
  return (
    <span className="check-box" data-checked={checked}>
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
        <path
          d="M1.5 5.2L3.8 7.5L8.5 2.5"
          stroke="#04070e"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function CollapsibleSection({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number | string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid var(--line)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          background: "transparent",
        }}
      >
        <span className="section-title">{title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {count !== undefined && (
            <span
              className="mono"
              style={{ fontSize: 10, color: "var(--text-muted)" }}
            >
              {count}
            </span>
          )}
          <span
            style={{
              color: "var(--text-faint)",
              fontSize: 9,
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform 0.15s",
            }}
          >
            ▶
          </span>
        </span>
      </button>
      {open && <div style={{ padding: "0 12px 12px" }}>{children}</div>}
    </div>
  );
}

const TYPE_ROWS: { key: keyof LayerToggles; label: string; statKey: string; color: string }[] = [
  { key: "satellites", label: "Active Satellites", statKey: "ACTIVE_SATELLITE", color: "#2dd4bf" },
  { key: "inactive", label: "Inactive Satellites", statKey: "INACTIVE_SATELLITE", color: "#5b7d94" },
  { key: "debris", label: "Debris", statKey: "DEBRIS", color: "#7d8899" },
  { key: "rocketBodies", label: "Rocket Bodies", statKey: "ROCKET_BODY", color: "#e8913c" },
  { key: "stations", label: "Space Stations", statKey: "SPACE_STATION", color: "#8be9fd" },
];

const REGIMES = [
  { key: "LEO", label: "LEO — Low Earth Orbit" },
  { key: "MEO", label: "MEO — Medium Earth Orbit" },
  { key: "GEO", label: "GEO — Geostationary" },
  { key: "HEO", label: "HEO — Highly Elliptical" },
];

function SearchResults({ results }: { results: ObjectBrief[] }) {
  const setSelectedNorad = useStore((s) => s.setSelectedNorad);
  const setFollowSelected = useStore((s) => s.setFollowSelected);
  const setSelectedEvent = useStore((s) => s.setSelectedEvent);

  if (!results.length) {
    return <div className="empty">No matching objects.</div>;
  }

  return (
    <div>
      {results.map((o) => (
        <button
          key={o.norad_id}
          onClick={() => {
            setSelectedEvent(null);
            setSelectedNorad(o.norad_id);
            setFollowSelected(true);
          }}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "7px 12px",
            borderBottom: "1px solid var(--line-faint)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          className="search-result"
        >
          <span style={{ fontSize: 13 }}>{flagOf(o.country_iso)}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: "var(--fs-small)",
                color: "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {o.name}
            </span>
            <span
              className="mono"
              style={{ fontSize: 9.5, color: "var(--text-muted)" }}
            >
              {o.norad_id} · {o.regime} · {o.operator}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ConjunctionRow({
  event,
  selected,
  onSelect,
}: {
  event: ConjunctionBrief;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "9px 12px",
        borderBottom: "1px solid var(--line-faint)",
        borderLeft: selected
          ? "2px solid var(--teal)"
          : "2px solid transparent",
        background: selected ? "var(--bg-active)" : "transparent",
        display: "block",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--text-muted)",
            minWidth: 22,
          }}
        >
          #{event.rank}
        </span>
        <span className={`chip chip-${event.risk_category}`}>
          {event.risk_category}
        </span>
        <span
          className="mono"
          style={{ fontSize: 9.5, color: "var(--text-faint)", marginLeft: "auto" }}
          title="Screening priority score, 0–100"
        >
          {fmt(event.risk_score, 1)}
        </span>
      </div>

      <div
        style={{
          fontSize: "var(--fs-small)",
          color: "var(--text)",
          lineHeight: 1.35,
          marginBottom: 5,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 11 }}>{flagOf(event.object_a.country_iso)}</span>
          <span
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {event.object_a.name}
          </span>
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: "var(--text-dim)",
          }}
        >
          <span style={{ fontSize: 11 }}>{flagOf(event.object_b.country_iso)}</span>
          <span
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {event.object_b.name}
          </span>
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 6,
        }}
      >
        <div>
          <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "var(--text-faint)", fontWeight: 700 }}>
            MISS
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-bright)" }}>
            {fmt(event.miss_distance_km, 2)} km
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "var(--text-faint)", fontWeight: 700 }}>
            V-REL
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {fmt(event.relative_speed_km_s, 2)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "var(--text-faint)", fontWeight: 700 }}>
            TCA
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {fmtDuration(event.hours_to_tca)}
          </div>
        </div>
      </div>
    </button>
  );
}

export function LeftRail() {
  const [tab, setTab] = useState<"RISK" | "CATALOG">("RISK");
  const [query, setQuery] = useState("");

  const { data: summary } = useCatalogSummary();
  const { data: screening, isLoading: screeningLoading, error: screeningError } =
    useConjunctions(200);
  const { data: searchData } = useSearch(query);

  const layers = useStore((s) => s.layers);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const countries = useStore((s) => s.countries);
  const toggleCountry = useStore((s) => s.toggleCountry);
  const regime = useStore((s) => s.regime);
  const setRegime = useStore((s) => s.setRegime);
  const resetFilters = useStore((s) => s.resetFilters);
  const selectedEventId = useStore((s) => s.selectedEventId);
  const setSelectedEvent = useStore((s) => s.setSelectedEvent);
  const setSelectedNorad = useStore((s) => s.setSelectedNorad);

  const countryTree = summary?.country_tree ?? [];
  const topCountries = useMemo(() => countryTree.slice(0, 12), [countryTree]);

  const events = screening?.events ?? [];
  const searching = query.trim().length >= 2;

  return (
    <aside
      style={{
        width: "var(--rail-left)",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-panel)",
        borderRight: "1px solid var(--line)",
        minHeight: 0,
      }}
    >
      {/* --- search (always visible) --- */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
        <input
          type="search"
          placeholder="Search name, NORAD ID, operator…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ fontSize: "var(--fs-small)" }}
        />
      </div>

      {searching ? (
        <div className="scroll" style={{ flex: 1 }}>
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span className="section-title">Search Results</span>
            <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {searchData?.count ?? 0}
            </span>
          </div>
          <SearchResults results={searchData?.results ?? []} />
        </div>
      ) : (
        <>
          {/* --- tab switch --- */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid var(--line)",
              flexShrink: 0,
            }}
          >
            {(["RISK", "CATALOG"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  padding: "9px 8px",
                  fontSize: "var(--fs-micro)",
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: tab === t ? "var(--teal)" : "var(--text-muted)",
                  background: tab === t ? "var(--teal-glow)" : "transparent",
                  borderBottom:
                    tab === t ? "2px solid var(--teal)" : "2px solid transparent",
                }}
              >
                {t === "RISK" ? "CONJUNCTION RISK" : "OBJECT CATALOG"}
              </button>
            ))}
          </div>

          {tab === "RISK" ? (
            <div className="scroll" style={{ flex: 1 }}>
              <div
                style={{
                  padding: "9px 12px",
                  borderBottom: "1px solid var(--line)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <span className="label">Ranked by risk engine</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {screening?.total_conjunctions ?? 0} events
                </span>
              </div>

              {screeningError ? (
                <div className="empty">
                  <strong style={{ color: "var(--warn)" }}>Screening unavailable</strong>
                  <span style={{ fontSize: 10 }}>
                    {(screeningError as Error).message}
                  </span>
                </div>
              ) : screeningLoading && !events.length ? (
                <div style={{ padding: 12, display: "grid", gap: 8 }}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="skeleton" style={{ height: 74 }} />
                  ))}
                  <div className="note" style={{ textAlign: "center" }}>
                    Running SGP4 screen across the catalogue…
                  </div>
                </div>
              ) : !events.length ? (
                <div className="empty">
                  <strong>No conjunctions</strong>
                  <span style={{ fontSize: 10, lineHeight: 1.5 }}>
                    No close approaches within{" "}
                    {fmt(screening?.screening_threshold_km, 0)} km over the next{" "}
                    {fmt(screening?.window.hours, 0)} hours for the selected
                    objects. This is a real result, not a loading state.
                  </span>
                </div>
              ) : (
                events.map((event) => (
                  <ConjunctionRow
                    key={event.event_id}
                    event={event}
                    selected={event.event_id === selectedEventId}
                    onSelect={() => {
                      setSelectedEvent(event.event_id);
                      setSelectedNorad(event.object_a.norad_id);
                    }}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="scroll" style={{ flex: 1 }}>
              <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
                <div className="section-title" style={{ marginBottom: 3 }}>
                  Object Catalog
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--teal)" }}>
                  {fmtInt(summary?.total_objects)} tracked objects
                </div>
              </div>

              <CollapsibleSection
                title="Operators / Countries"
                count={countryTree.length}
              >
                {topCountries.map((node) => {
                  const active = countries.includes(node.country);
                  return (
                    <div key={node.country}>
                      <div
                        className="check-row"
                        onClick={() => toggleCountry(node.country)}
                      >
                        <Check checked={active} />
                        <span style={{ fontSize: 12 }}>{flagOf(node.iso)}</span>
                        <span
                          style={{
                            flex: 1,
                            fontSize: "var(--fs-small)",
                            color: active ? "var(--teal)" : "var(--text)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {node.country}
                        </span>
                        <span
                          className="mono"
                          style={{ fontSize: 10, color: "var(--text-muted)" }}
                        >
                          {fmtInt(node.count)}
                        </span>
                      </div>
                      {active &&
                        node.operators.map((op) => (
                          <div
                            key={op.operator}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              padding: "3px 4px 3px 34px",
                              fontSize: 10.5,
                              color: "var(--text-muted)",
                            }}
                          >
                            <span>{op.operator}</span>
                            <span className="mono">{fmtInt(op.count)}</span>
                          </div>
                        ))}
                    </div>
                  );
                })}
              </CollapsibleSection>

              <CollapsibleSection title="Object Type">
                {TYPE_ROWS.map((row) => (
                  <div
                    key={row.key}
                    className="check-row"
                    onClick={() => toggleLayer(row.key)}
                  >
                    <Check checked={layers[row.key]} />
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: row.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, fontSize: "var(--fs-small)" }}>
                      {row.label}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: "var(--text-muted)" }}
                    >
                      {fmtInt(summary?.by_type?.[row.statKey] ?? 0)}
                    </span>
                  </div>
                ))}
              </CollapsibleSection>

              <CollapsibleSection title="Orbital Regime">
                <div
                  className="check-row"
                  onClick={() => setRegime(null)}
                >
                  <span className="radio-dot" data-checked={regime === null} />
                  <span style={{ flex: 1, fontSize: "var(--fs-small)" }}>
                    All regimes
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {fmtInt(summary?.total_objects)}
                  </span>
                </div>
                {REGIMES.map((r) => (
                  <div
                    key={r.key}
                    className="check-row"
                    onClick={() => setRegime(regime === r.key ? null : r.key)}
                  >
                    <span className="radio-dot" data-checked={regime === r.key} />
                    <span style={{ flex: 1, fontSize: "var(--fs-small)" }}>
                      {r.label}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: "var(--text-muted)" }}
                    >
                      {fmtInt(summary?.by_regime?.[r.key] ?? 0)}
                    </span>
                  </div>
                ))}
              </CollapsibleSection>

              <CollapsibleSection title="Overlays" defaultOpen={false}>
                <div className="check-row" onClick={() => toggleLayer("orbits")}>
                  <Check checked={layers.orbits} />
                  <span style={{ flex: 1, fontSize: "var(--fs-small)" }}>
                    Orbit paths
                  </span>
                </div>
                <div className="check-row" onClick={() => toggleLayer("conjunctions")}>
                  <Check checked={layers.conjunctions} />
                  <span style={{ flex: 1, fontSize: "var(--fs-small)" }}>
                    Conjunction markers
                  </span>
                </div>
              </CollapsibleSection>

              <div style={{ padding: 12 }}>
                <button
                  className="btn"
                  onClick={resetFilters}
                  style={{ width: "100%" }}
                >
                  ↺ Reset Filters
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

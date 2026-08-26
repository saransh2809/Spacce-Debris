/**
 * KAKSHA -- main operational dashboard.
 *
 * LAYOUT
 * ------
 * Ranked conjunctions left, 3D globe centre, scientific analysis right, live
 * counters along the bottom. Both side rails collapse independently and the
 * centre reclaims the space, so the viewport can run edge to edge.
 *
 * THE GLOBE IS MOUNTED ON DEMAND
 * ------------------------------
 * A WebGL context, five Earth textures and a catalogue-sized point cloud is a
 * lot to build for someone who opened the dashboard to read the risk list. The
 * globe therefore starts unmounted and a summary view stands in its place.
 * Every piece of state the globe reads -- simulation time, selection, filters,
 * screening parameters -- lives in the store, not in the scene, so showing it
 * again restores the same view rather than resetting the session.
 */
import { useIsFetching } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { GlobeScene } from "../components/globe/GlobeScene";
import { Glyph, type GlyphKind } from "../components/globe/glyphs";
import { LeftRail } from "../components/panels/LeftRail";
import { RightRail } from "../components/panels/RightRail";
import { HoverCard } from "../components/panels/HoverCard";
import { StatStrip, TimelineBar } from "../components/layout/StatStrip";
import { useStore, type LayerToggles } from "../store/useStore";
import { useCatalogSummary, useConjunctions, useConjunctionSummary } from "../hooks/useKaksha";
import { fmt, fmtInt } from "../api/client";

/** Panel slide duration. Long enough to read as motion, short enough to feel instant. */
const SLIDE_MS = 260;

/**
 * Rail widths, resolved from the CSS custom properties to concrete pixels.
 *
 * WHY NOT JUST USE var(--rail-left) IN THE STYLE
 * ----------------------------------------------
 * Because a transition whose start value is a var() reference does not
 * animate: measured here, setting `flex-basis: 0px` while transitioning from
 * `var(--rail-left)` left the element stuck at its full 268px indefinitely,
 * and `transition: none` collapsed it instantly. Resolving the variable once
 * gives the transition two real lengths to interpolate between.
 *
 * index.css remains the single source of truth for the numbers; this only
 * reads them.
 */
function useRailWidths() {
  const [w, setW] = useState({ left: 268, right: 344 });

  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const left = parseFloat(cs.getPropertyValue("--rail-left"));
      const right = parseFloat(cs.getPropertyValue("--rail-right"));
      if (Number.isFinite(left) && Number.isFinite(right)) setW({ left, right });
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  return w;
}

/* ------------------------------------------------------------------ filters */

/**
 * Display filters.
 *
 * This replaced a passive legend. It keeps the legend's job -- showing which
 * silhouette and colour mean what -- but each row is now the control for that
 * class. The toggles drive `layers` in the store, which feeds `activeObjectTypes()`,
 * which is the `object_types` parameter of the scene query: unchecking a class
 * removes it from the request, so it leaves the Three.js scene entirely rather
 * than being drawn and hidden.
 */
const FILTER_ROWS: {
  key: keyof LayerToggles;
  label: string;
  kind: GlyphKind;
  color: string;
}[] = [
  { key: "orbits", label: "Orbits", kind: "orbit", color: "#2dd4bf" },
  { key: "satellites", label: "Active satellites", kind: "satellite", color: "#2dd4bf" },
  { key: "inactive", label: "Inactive satellites", kind: "satellite", color: "#6b8fa8" },
  { key: "debris", label: "Debris", kind: "debris", color: "#8792a3" },
  { key: "rocketBodies", label: "Rocket bodies", kind: "rocket", color: "#e8913c" },
  { key: "stations", label: "Space stations", kind: "station", color: "#8be9fd" },
  { key: "conjunctions", label: "Conjunctions", kind: "conjunction", color: "#f04747" },
];

function DisplayFilters() {
  const [open, setOpen] = useState(true);
  const layers = useStore((s) => s.layers);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const countries = useStore((s) => s.countries);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 14,
        left: 14,
        zIndex: 20,
        background: "rgba(8, 13, 21, 0.92)",
        border: "1px solid var(--line)",
        borderRadius: 3,
        padding: open ? "9px 11px" : "6px 10px",
        backdropFilter: "blur(6px)",
        minWidth: open ? 172 : undefined,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: open ? 7 : 0 }}
        title={open ? "Collapse display filters" : "Expand display filters"}
      >
        <span className="label">Display Filters</span>
        <span style={{ fontSize: 8, color: "var(--text-faint)" }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div style={{ display: "grid", gap: 1 }}>
          {FILTER_ROWS.map((row) => {
            const on = layers[row.key];
            return (
              <label
                key={row.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "2.5px 3px",
                  borderRadius: 2,
                  cursor: "pointer",
                  opacity: on ? 1 : 0.42,
                  transition: "opacity 140ms ease, background 140ms ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleLayer(row.key)}
                  style={{ accentColor: "var(--teal)", width: 11, height: 11, cursor: "pointer" }}
                />
                <Glyph kind={row.kind} color={row.color} size={14} />
                <span style={{ fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                  {row.label}
                </span>
              </label>
            );
          })}

          {countries.length > 0 && (
            <div
              className="note"
              style={{ marginTop: 6, paddingTop: 5, borderTop: "1px solid var(--line-faint)" }}
            >
              Also filtered to {countries.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- pipeline */

/** Pipeline counters, so the sieve is visible rather than implied. */
function PipelineBadge() {
  const { data: screening } = useConjunctions(1);
  const { data: summary } = useCatalogSummary();
  if (!screening) return null;
  const p = screening.pipeline;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 14,
        right: 14,
        zIndex: 20,
        background: "rgba(8, 13, 21, 0.92)",
        border: "1px solid var(--line)",
        borderRadius: 3,
        padding: "9px 12px",
        backdropFilter: "blur(6px)",
        maxWidth: 250,
      }}
    >
      <div className="label" style={{ marginBottom: 6 }}>
        Screening Pipeline
      </div>
      {[
        ["Catalogue", fmtInt(summary?.total_objects)],
        ["After shell filter", fmtInt(p.objects_considered)],
        ["Geometric pairs", fmtInt(p.pairs_geometrically_possible)],
        ["Coarse candidates", fmtInt(p.pairs_after_coarse_sweep)],
        ["Refined (Brent)", fmtInt(p.candidates_refined)],
        ["Conjunctions", fmtInt(screening.total_conjunctions)],
      ].map(([k, v], i, arr) => (
        <div
          key={k}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            padding: "2px 0",
            color: i === arr.length - 1 ? "var(--teal)" : "var(--text-dim)",
          }}
        >
          <span style={{ fontSize: 9.5 }}>{k}</span>
          <span className="mono" style={{ fontSize: 10 }}>
            {v}
          </span>
        </div>
      ))}
      <div
        className="note"
        style={{ marginTop: 6, paddingTop: 5, borderTop: "1px solid var(--line-faint)" }}
      >
        Gate {fmt(p.coarse_gate_km, 0)} km ≥ required {fmt(p.required_gate_km, 0)} km ·{" "}
        {fmt((p.total_ms ?? 0) / 1000, 1)} s
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */

/**
 * Non-blocking work indicator.
 *
 * Reports that something is in flight without disabling anything. A screening
 * run is genuinely slow on a cold cache, and the honest response is to say so
 * while leaving the interface usable -- not to grey the page out.
 */
function ActivityChip() {
  const fetching = useIsFetching();
  if (!fetching) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 11px",
        borderRadius: 3,
        background: "rgba(8, 13, 21, 0.92)",
        border: "1px solid var(--line)",
        backdropFilter: "blur(6px)",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--teal)",
          animation: "pulse 1.1s ease-in-out infinite",
        }}
      />
      <span style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.04em" }}>
        Updating simulation
        {fetching > 1 ? ` · ${fetching} requests` : ""}
      </span>
    </div>
  );
}

/** Edge handle that opens or closes a side rail. Stays reachable when closed. */
function PanelHandle({
  side,
  open,
  onClick,
}: {
  side: "left" | "right";
  open: boolean;
  onClick: () => void;
}) {
  const pointingAway = side === "left" ? !open : open;
  return (
    <button
      onClick={onClick}
      title={`${open ? "Collapse" : "Expand"} ${side} panel`}
      aria-label={`${open ? "Collapse" : "Expand"} ${side} panel`}
      style={{
        position: "absolute",
        top: "50%",
        [side]: 0,
        transform: "translateY(-50%)",
        zIndex: 25,
        width: 15,
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(11, 18, 28, 0.94)",
        border: "1px solid var(--line)",
        [side === "left" ? "borderLeft" : "borderRight"]: "none",
        [side === "left" ? "borderTopRightRadius" : "borderTopLeftRadius"]: 3,
        [side === "left" ? "borderBottomRightRadius" : "borderBottomLeftRadius"]: 3,
        color: "var(--text-faint)",
        fontSize: 10,
        cursor: "pointer",
        transition: "color 140ms ease, background 140ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--teal)";
        e.currentTarget.style.background = "rgba(18, 30, 44, 0.96)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-faint)";
        e.currentTarget.style.background = "rgba(11, 18, 28, 0.94)";
      }}
    >
      {pointingAway ? (side === "left" ? "›" : "‹") : side === "left" ? "‹" : "›"}
    </button>
  );
}

/* ------------------------------------------------------------ summary view */

/**
 * What the centre shows before the globe is opened.
 *
 * Deliberately not a placeholder: it is the at-a-glance operational picture,
 * and it is driven by the same screening run the globe and the rails use.
 */
function SummaryView({ onOpenGlobe }: { onOpenGlobe: () => void }) {
  const { data: summary } = useCatalogSummary();
  const { data: risk } = useConjunctionSummary();
  const counts = risk?.counts;

  const tiles: { label: string; value: string; tone?: string }[] = [
    { label: "Tracked objects", value: fmtInt(summary?.total_objects) },
    { label: "Debris", value: fmtInt(summary?.by_type?.DEBRIS) },
    { label: "Conjunctions in window", value: fmtInt(risk?.total_conjunctions) },
    { label: "Critical", value: fmtInt(counts?.CRITICAL), tone: "var(--critical)" },
    { label: "High", value: fmtInt(counts?.HIGH), tone: "var(--high)" },
    { label: "Moderate", value: fmtInt(counts?.MODERATE), tone: "var(--amber)" },
  ];

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 26,
        padding: 28,
        overflow: "auto",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 520 }}>
        <div className="label" style={{ marginBottom: 8 }}>
          Space Situational Awareness
        </div>
        <div style={{ fontSize: 15, color: "var(--text-dim)", lineHeight: 1.6 }}>
          Screening is live and the numbers below are current. Open the 3D view when
          you want to inspect geometry.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))",
          gap: 10,
          width: "100%",
          maxWidth: 620,
        }}
      >
        {tiles.map((t) => (
          <div
            key={t.label}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 3,
              padding: "13px 14px",
              background: "rgba(255,255,255,0.015)",
            }}
          >
            <div
              className="mono"
              style={{ fontSize: 22, color: t.tone ?? "var(--text)", lineHeight: 1.1 }}
            >
              {t.value}
            </div>
            <div className="label" style={{ marginTop: 5 }}>
              {t.label}
            </div>
          </div>
        ))}
      </div>

      <button className="btn btn-accent" onClick={onOpenGlobe} style={{ padding: "10px 20px" }}>
        <GlobeIcon size={15} /> &nbsp;Open 3D view
      </button>
    </div>
  );
}

function GlobeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      style={{ verticalAlign: "-2px" }}
    >
      <circle cx="12" cy="12" r="9.2" />
      <ellipse cx="12" cy="12" rx="4" ry="9.2" />
      <path d="M2.8 12h18.4M4.6 6.6h14.8M4.6 17.4h14.8" />
    </svg>
  );
}

/* --------------------------------------------------------------- dashboard */

export function Dashboard() {
  const leftOpen = useStore((s) => s.leftPanelOpen);
  const rightOpen = useStore((s) => s.rightPanelOpen);
  const toggleLeft = useStore((s) => s.toggleLeftPanel);
  const toggleRight = useStore((s) => s.toggleRightPanel);
  const globeVisible = useStore((s) => s.globeVisible);
  const setGlobeVisible = useStore((s) => s.setGlobeVisible);
  const toggleGlobe = useStore((s) => s.toggleGlobe);
  const rail = useRailWidths();

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        {/* Rails collapse by animating width to zero. The centre is flex:1, so
            it takes the freed space automatically -- no gap is left behind. */}
        <div
          style={{
            // Collapse is driven by FLEX-BASIS, not width.
            //
            // With `flex-basis: auto` the flex base size comes from the
            // content, and the rail's own 268px aside won the layout even with
            // an inline `width: 0` -- measured: the wrapper still computed to
            // 268px. Setting the basis explicitly is what actually collapses
            // it, and it is the property the transition should animate anyway.
            // Longhands, not the `flex` shorthand: a var() used as the basis inside
            // the shorthand did not resolve here and collapsed the rail to 1px.
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: leftOpen ? `${rail.left}px` : "0px",
            minWidth: 0,
            overflow: "hidden",
            transition: `flex-basis ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
            borderRight: leftOpen ? "1px solid var(--line)" : "none",
          }}
        >
          <LeftRail />
        </div>

        <main
          style={{
            flex: 1,
            position: "relative",
            minWidth: 0,
            background: "var(--bg-void)",
          }}
        >
          {globeVisible ? (
            <>
              <GlobeScene />
              <DisplayFilters />
              <PipelineBadge />
              <button
                className="btn"
                onClick={toggleGlobe}
                title="Close the 3D view and return to the summary"
                style={{ position: "absolute", top: 12, right: 14, zIndex: 22 }}
              >
                Close 3D
              </button>
            </>
          ) : (
            <SummaryView onOpenGlobe={() => setGlobeVisible(true)} />
          )}

          <ActivityChip />
          <PanelHandle side="left" open={leftOpen} onClick={toggleLeft} />
          <PanelHandle side="right" open={rightOpen} onClick={toggleRight} />
        </main>

        <div
          style={{
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: rightOpen ? `${rail.right}px` : "0px",
            minWidth: 0,
            overflow: "hidden",
            transition: `flex-basis ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
            borderLeft: rightOpen ? "1px solid var(--line)" : "none",
          }}
        >
          <RightRail />
        </div>
      </div>

      <TimelineBar />
      <StatStrip />
      <HoverCard />
    </div>
  );
}

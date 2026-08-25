/**
 * KAKSHA -- main operational dashboard.
 *
 * Layout follows the problem statement: ranked conjunctions left, interactive
 * globe centre, scientific analysis right, live counters along the bottom.
 */
import { useState } from "react";
import { GlobeScene } from "../components/globe/GlobeScene";
import { Glyph, type GlyphKind } from "../components/globe/glyphs";
import { LeftRail } from "../components/panels/LeftRail";
import { RightRail } from "../components/panels/RightRail";
import { HoverCard } from "../components/panels/HoverCard";
import { StatStrip, TimelineBar } from "../components/layout/StatStrip";
import { useStore, type ViewMode } from "../store/useStore";
import { useCatalogSummary, useConjunctions } from "../hooks/useKaksha";
import { fmt, fmtInt } from "../api/client";

const VIEW_MODES: { key: ViewMode; label: string; hint: string }[] = [
  { key: "OBJECTS", label: "Objects", hint: "Every catalogued object as a point" },
  { key: "ORBITS", label: "Orbits", hint: "Emphasise orbital paths and regime shells" },
  { key: "RISK", label: "Risk", hint: "Emphasise conjunction geometry" },
  { key: "DENSITY", label: "Density", hint: "Full catalogue, small points" },
];

/**
 * The legend uses the same silhouettes as the globe, so shape reads as class
 * and colour reads as operator or risk -- two channels, not one overloaded one.
 */
const LEGEND: { color: string; label: string; kind: GlyphKind }[] = [
  { color: "#2dd4bf", label: "Active satellite", kind: "satellite" },
  { color: "#f5a623", label: "Indian asset", kind: "satellite" },
  { color: "#6b8fa8", label: "Inactive satellite", kind: "satellite" },
  { color: "#8792a3", label: "Debris", kind: "debris" },
  { color: "#e8913c", label: "Rocket body", kind: "rocket" },
  { color: "#8be9fd", label: "Space station", kind: "station" },
  { color: "#f04747", label: "Conjunction pair", kind: "dot" },
];

/**
 * Display-density presets. These cap only what the GLOBE DRAWS -- screening,
 * risk ranking and every number in the panels always run against the full
 * catalogue. Labelled explicitly so nobody mistakes it for a physics setting.
 */
const DENSITY_STEPS = [
  { value: 1500, label: "1.5k" },
  { value: 4000, label: "4k" },
  { value: 8000, label: "8k" },
  { value: 18000, label: "All" },
];

function ViewControls() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const focusIndia = useStore((s) => s.focusIndia);
  const toggleFocusIndia = useStore((s) => s.toggleFocusIndia);
  const autoRotate = useStore((s) => s.autoRotate);
  const toggleAutoRotate = useStore((s) => s.toggleAutoRotate);
  const maxObjects = useStore((s) => s.maxObjects);
  const setMaxObjects = useStore((s) => s.setMaxObjects);
  const { data: summary } = useCatalogSummary();

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 14,
        right: 14,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
        pointerEvents: "none",
        zIndex: 20,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, pointerEvents: "auto" }}>
        <span className="label">View</span>
        <div className="segmented">
          {VIEW_MODES.map((m) => (
            <button
              key={m.key}
              data-active={viewMode === m.key}
              onClick={() => setViewMode(m.key)}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          pointerEvents: "auto",
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <span className="label">Shown</span>
          <div className="segmented">
            {DENSITY_STEPS.map((d) => (
              <button
                key={d.value}
                data-active={maxObjects === d.value}
                onClick={() => setMaxObjects(d.value)}
                title={`Draw at most ${d.value.toLocaleString()} objects. Display only — screening always uses the full catalogue.`}
              >
                {d.label}
              </button>
            ))}
          </div>
          {/* The globe draws a stratified sample; the physics never does. Saying
              so prevents the display cap being mistaken for the catalogue size. */}
          <span
            style={{
              fontSize: 9,
              color: "var(--text-faint)",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
            }}
          >
            display cap · screening uses all {fmtInt(summary?.total_objects)}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="label">&nbsp;</span>
          <button
            className={autoRotate ? "btn btn-accent" : "btn"}
            onClick={toggleAutoRotate}
            title="Idle camera drift. Suspends automatically while focused on an object or an encounter."
          >
            {autoRotate ? "◐ Rotating" : "◐ Rotate"}
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="label">&nbsp;</span>
          <button
            className={focusIndia ? "btn btn-accent" : "btn"}
            onClick={toggleFocusIndia}
            title="Filter the catalogue and the screening run to Indian assets"
          >
            🇮🇳 Focus India
          </button>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const [open, setOpen] = useState(true);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 14,
        left: 14,
        zIndex: 20,
        background: "rgba(8, 13, 21, 0.9)",
        border: "1px solid var(--line)",
        borderRadius: 3,
        padding: open ? "9px 12px" : "6px 10px",
        backdropFilter: "blur(6px)",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: open ? 7 : 0,
        }}
      >
        <span className="label">Legend</span>
        <span style={{ fontSize: 8, color: "var(--text-faint)" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ display: "grid", gap: 4 }}>
          {LEGEND.map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Glyph kind={item.kind} color={item.color} size={14} />
              <span style={{ fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
        background: "rgba(8, 13, 21, 0.9)",
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

export function Dashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <LeftRail />

        <main
          style={{
            flex: 1,
            position: "relative",
            minWidth: 0,
            background: "var(--bg-void)",
          }}
        >
          <GlobeScene />
          <ViewControls />
          <Legend />
          <PipelineBadge />
        </main>

        <RightRail />
      </div>

      <TimelineBar />
      <StatStrip />
      <HoverCard />
    </div>
  );
}

/**
 * KAKSHA -- bottom statistics strip and time transport.
 *
 * Every counter here is derived from a live screening run. None of it is
 * hardcoded, seeded or padded: if the pipeline finds zero critical
 * conjunctions, the tile reads zero. A dashboard that always shows an
 * impressive number is showing a decoration, not a measurement.
 */
import { useRef, useState } from "react";
import {
  fmt,
  fmtAge,
  fmtDuration,
  fmtInt,
  fmtTimeUTC,
} from "../../api/client";
import {
  useCatalogSummary,
  useClockControls,
  useConjunctionSummary,
  useHealth,
  useTickingTime,
} from "../../hooks/useKaksha";
import { useStore } from "../../store/useStore";
import type { RiskCategory } from "../../api/types";

function Tile({
  label,
  value,
  sub,
  accent,
  title,
  onClick,
  active,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  title?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div
      title={title}
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 2,
        padding: "0 16px",
        borderRight: "1px solid var(--line)",
        cursor: onClick ? "pointer" : "default",
        background: active ? "var(--bg-hover)" : "transparent",
        transition: "background 0.12s",
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 21,
          fontWeight: 600,
          lineHeight: 1.05,
          color: accent ?? "var(--text-bright)",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: "0.13em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      {sub && (
        <div
          className="mono"
          style={{
            fontSize: 9,
            color: "var(--text-faint)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

const RISK_ACCENT: Record<RiskCategory, string> = {
  CRITICAL: "#ff3d54",
  HIGH: "#f04747",
  MODERATE: "#f0a030",
  LOW: "#4a9eda",
};

export function StatStrip() {
  const { data: summary } = useCatalogSummary();
  const { data: conj } = useConjunctionSummary();
  const { data: health } = useHealth();
  const riskFilters = useStore((s) => s.riskFilters);
  const toggleRisk = useStore((s) => s.toggleRisk);

  const counts = conj?.counts;
  const total = summary?.total_objects ?? null;
  const leo = summary?.by_regime?.LEO ?? null;
  const debris = summary?.by_type?.DEBRIS ?? null;

  return (
    <div
      style={{
        height: "var(--statstrip-h)",
        display: "flex",
        background: "var(--bg-panel)",
        borderTop: "1px solid var(--line)",
        flexShrink: 0,
      }}
    >
      <Tile
        label="Tracked Objects"
        value={fmtInt(total)}
        sub={summary ? `${fmtInt(summary.stale_objects)} stale elements` : undefined}
        title="Catalogued objects with valid, non-decayed element sets."
      />
      <Tile
        label="LEO Objects"
        value={fmtInt(leo)}
        sub={
          summary
            ? `GEO ${fmtInt(summary.by_regime?.GEO ?? 0)} · MEO ${fmtInt(summary.by_regime?.MEO ?? 0)}`
            : undefined
        }
        title="Objects whose mean altitude is below 2,000 km."
      />
      <Tile
        label="Debris"
        value={fmtInt(debris)}
        sub={
          summary
            ? `${fmtInt(summary.by_type?.ROCKET_BODY ?? 0)} rocket bodies`
            : undefined
        }
        title="Objects classified DEB in the SATCAT."
      />

      {(["CRITICAL", "HIGH", "MODERATE", "LOW"] as RiskCategory[]).map((cat) => (
        <Tile
          key={cat}
          label={`${cat} risk`}
          value={counts ? String(counts[cat] ?? 0) : "—"}
          accent={
            counts && (counts[cat] ?? 0) > 0 ? RISK_ACCENT[cat] : "var(--text-faint)"
          }
          sub={riskFilters[cat] ? "shown" : "hidden"}
          active={riskFilters[cat]}
          onClick={() => toggleRisk(cat)}
          title={`Conjunctions scored ${cat} by the risk engine. Click to filter.`}
        />
      ))}

      <Tile
        label="Screening Window"
        value={conj ? `${fmt(conj.window_hours, 0)}h` : "—"}
        sub={
          conj
            ? `${fmt(conj.screening_threshold_km, 0)} km volume · ${conj.from_cache ? "cached" : "computed"}`
            : undefined
        }
        title="Look-ahead window and screening volume used for this run."
      />
      <Tile
        label="Elements Fetched"
        value={fmtAge(health?.data_age_seconds).replace(" ago", "")}
        sub={summary ? `median epoch ${fmt(summary.data.median_element_age_days, 2)} d` : undefined}
        title="Time since the orbital element feed was retrieved, and the median age of the element sets themselves."
      />
    </div>
  );
}

/** Relative time-jump presets offered by the transport. */
const JUMPS = [
  { label: "-24h", seconds: -86400 },
  { label: "-1h", seconds: -3600 },
  { label: "-10m", seconds: -600 },
  { label: "+10m", seconds: 600 },
  { label: "+1h", seconds: 3600 },
  { label: "+6h", seconds: 21600 },
  { label: "+24h", seconds: 86400 },
];

const RATES = [1, 10, 100, 1000];

export function TimelineBar() {
  const controls = useClockControls();
  const now = useTickingTime(4);
  const clockMode = useStore((s) => s.clockMode);
  const rate = useStore((s) => s.rate);
  const paused = useStore((s) => s.paused);
  const [busy, setBusy] = useState(false);
  const [anchor] = useState(() => Date.now());
  const barRef = useRef<HTMLDivElement>(null);

  // Scrubber spans NOW-6h .. NOW+48h relative to the page-load anchor, so the
  // handle position means something stable while the clock runs.
  const spanStart = anchor - 6 * 3600_000;
  const spanEnd = anchor + 48 * 3600_000;
  const fraction = Math.min(
    1,
    Math.max(0, (now.getTime() - spanStart) / (spanEnd - spanStart)),
  );

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const handleScrub = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const f = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const target = new Date(spanStart + f * (spanEnd - spanStart));
    void run(() => controls.jumpTo(target));
  };

  const isSim = clockMode === "SIMULATION";

  return (
    <div
      style={{
        height: "var(--timeline-h)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 14px",
        background: "var(--bg-panel)",
        borderTop: "1px solid var(--line)",
        flexShrink: 0,
      }}
    >
      {/* transport */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <button
          className="btn"
          disabled={busy}
          onClick={() => void run(() => controls.offset(-600))}
          title="Step back 10 minutes"
          style={{ padding: "7px 10px" }}
        >
          ◀◀
        </button>
        <button
          className={paused || !isSim ? "btn btn-accent" : "btn"}
          disabled={busy}
          onClick={() => void run(() => (paused ? controls.play() : controls.pause()))}
          title={paused ? "Play" : "Pause"}
          style={{ padding: "7px 13px" }}
        >
          {paused ? "▶" : "❚❚"}
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => void run(() => controls.offset(600))}
          title="Step forward 10 minutes"
          style={{ padding: "7px 10px" }}
        >
          ▶▶
        </button>
      </div>

      {/* rate */}
      <div className="segmented" style={{ flexShrink: 0 }}>
        {RATES.map((r) => (
          <button
            key={r}
            data-active={isSim && Math.abs(rate) === r && !paused}
            disabled={busy}
            onClick={() => void run(() => controls.setRate(r))}
          >
            {r}×
          </button>
        ))}
      </div>

      {/* jump presets */}
      <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
        {JUMPS.map((j) => (
          <button
            key={j.label}
            className="btn"
            disabled={busy}
            onClick={() => void run(() => controls.offset(j.seconds))}
            style={{ padding: "6px 8px", fontSize: 9.5 }}
            title={`Propagate all objects to T${j.label}`}
          >
            {j.label}
          </button>
        ))}
      </div>

      {/* scrubber */}
      <div style={{ flex: 1, minWidth: 120, display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          ref={barRef}
          onClick={handleScrub}
          style={{
            position: "relative",
            height: 5,
            background: "var(--bg-input)",
            border: "1px solid var(--line-strong)",
            borderRadius: 3,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: `${fraction * 100}%`,
              background: isSim ? "var(--amber)" : "var(--teal-dim)",
              borderRadius: 3,
              opacity: 0.55,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: `${fraction * 100}%`,
              width: 11,
              height: 11,
              marginLeft: -5.5,
              marginTop: -5.5,
              borderRadius: "50%",
              background: isSim ? "var(--amber)" : "var(--teal)",
              border: "1px solid var(--bg-void)",
            }}
          />
          {/* NOW tick */}
          <div
            style={{
              position: "absolute",
              top: -3,
              left: `${((anchor - spanStart) / (spanEnd - spanStart)) * 100}%`,
              width: 1,
              height: 11,
              background: "var(--text-muted)",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 8.5,
            letterSpacing: "0.1em",
            color: "var(--text-faint)",
            fontWeight: 600,
          }}
        >
          <span>−6h</span>
          <span>NOW</span>
          <span>+12h</span>
          <span>+24h</span>
          <span>+48h</span>
        </div>
      </div>

      {/* readout */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
          paddingLeft: 6,
          borderLeft: "1px solid var(--line)",
        }}
      >
        <div style={{ textAlign: "right" }}>
          <div
            className="mono"
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: isSim ? "var(--amber)" : "var(--text-bright)",
              lineHeight: 1.1,
            }}
          >
            {fmtTimeUTC(now.toISOString())}
          </div>
          <div
            style={{
              fontSize: 8.5,
              letterSpacing: "0.11em",
              color: "var(--text-muted)",
              fontWeight: 700,
            }}
          >
            {isSim ? `SIM · Δ${fmtDuration((now.getTime() - Date.now()) / 3600_000)}` : "REAL TIME"}
          </div>
        </div>
        <button
          className={isSim ? "btn btn-accent" : "btn"}
          disabled={busy || !isSim}
          onClick={() => void run(() => controls.realtime())}
          title="Return the simulation clock to wall-clock UTC"
        >
          Live
        </button>
      </div>
    </div>
  );
}

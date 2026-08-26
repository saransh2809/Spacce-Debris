/**
 * KAKSHA -- charts.
 *
 * Hand-rolled SVG rather than a charting library: these plots need exact
 * control over axis labelling and units, and a scientific chart that silently
 * rescales or smooths its data is worse than no chart.
 *
 * Every chart states its units on the axis. None of them interpolate between
 * data points beyond drawing straight segments between actual samples.
 */
import { useMemo, useState } from "react";
import { fmt } from "../../api/client";
import type { Histogram as HistogramData } from "../../api/types";

export function Histogram({
  data,
  label,
  unit,
  color = "#2dd4bf",
  height = 150,
  logScale = false,
}: {
  data: HistogramData | undefined;
  label: string;
  unit: string;
  color?: string;
  height?: number;
  logScale?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (!data || !data.counts.length) {
    return (
      <div>
        <div className="label" style={{ marginBottom: 6 }}>
          {label}
        </div>
        <div className="empty" style={{ height }}>
          No data in range
        </div>
      </div>
    );
  }

  const max = Math.max(...data.counts, 1);
  const scaleY = (v: number) =>
    logScale ? Math.log10(v + 1) / Math.log10(max + 1) : v / max;

  const w = 100 / data.counts.length;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <span className="label">{label}</span>
        <span className="mono" style={{ fontSize: 9.5, color: "var(--text-faint)" }}>
          n={data.total}
          {data.excluded > 0 && ` · ${data.excluded} excluded`}
        </span>
      </div>

      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        style={{
          background: "var(--bg-void)",
          border: "1px solid var(--line)",
          borderRadius: 3,
          display: "block",
        }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            y1={height * f}
            x2="100"
            y2={height * f}
            stroke="#141d29"
            strokeWidth="0.4"
          />
        ))}
        {data.counts.map((count, i) => {
          const h = scaleY(count) * (height - 14);
          return (
            <rect
              key={i}
              x={i * w + w * 0.12}
              y={height - h - 2}
              width={w * 0.76}
              height={Math.max(count > 0 ? 1.2 : 0, h)}
              fill={hover === i ? "#ffffff" : color}
              opacity={hover === null || hover === i ? 0.88 : 0.4}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 3,
          fontSize: 9,
          color: "var(--text-faint)",
        }}
        className="mono"
      >
        <span>{fmt(data.bin_edges[0], 1)}</span>
        <span style={{ color: "var(--text-muted)" }}>
          {hover !== null
            ? `${fmt(data.bin_edges[hover], 2)}–${fmt(data.bin_edges[hover + 1], 2)} ${unit}: ${data.counts[hover]}`
            : unit}
        </span>
        <span>{fmt(data.bin_edges[data.bin_edges.length - 1], 1)}</span>
      </div>
    </div>
  );
}

export function BarList({
  data,
  label,
  color = "#2dd4bf",
  max: maxOverride,
  formatValue = (v: number) => v.toLocaleString("en-US"),
}: {
  data: Record<string, number>;
  label: string;
  color?: string;
  max?: number;
  formatValue?: (v: number) => string;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = maxOverride ?? Math.max(...entries.map((e) => e[1]), 1);

  return (
    <div>
      <div className="label" style={{ marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: "grid", gap: 5 }}>
        {entries.map(([key, value]) => (
          <div key={key}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10.5,
                marginBottom: 2,
              }}
            >
              <span
                style={{
                  color: "var(--text-dim)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "70%",
                }}
              >
                {key.replace(/_/g, " ")}
              </span>
              <span className="mono" style={{ color: "var(--text)" }}>
                {formatValue(value)}
              </span>
            </div>
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
                  width: `${(value / max) * 100}%`,
                  height: "100%",
                  background: color,
                  opacity: 0.8,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Separation / range-rate profile through an encounter.
 *
 * The range-rate trace crossing zero exactly where the separation curve
 * bottoms out is the visual proof that the TCA solver found a real stationary
 * point rather than the smallest sample on a grid.
 */
export function ProfileChart({
  tOffsetS,
  separationKm,
  rangeRateKmS,
  missDistanceKm,
  height = 220,
}: {
  tOffsetS: (number | null)[];
  separationKm: (number | null)[];
  rangeRateKmS: (number | null)[];
  missDistanceKm: number | null;
  height?: number;
}) {
  const [cursor, setCursor] = useState<number | null>(null);

  // sepMax and rateAbs are scale factors used only inside the memo to build
  // the paths; they are returned for clarity but nothing out here reads them.
  const { sepPath, ratePath, tMin, tMax } = useMemo(() => {
    const ts = tOffsetS.filter((t): t is number => t !== null);
    const seps = separationKm.filter((s): s is number => s !== null);
    const rates = rangeRateKmS.filter((r): r is number => r !== null);
    if (!ts.length || !seps.length) {
      return { sepPath: "", ratePath: "", tMin: 0, tMax: 1, sepMax: 1, rateAbs: 1 };
    }

    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const sepMax = Math.max(...seps) * 1.08;
    const rateAbs = Math.max(...rates.map(Math.abs), 0.001) * 1.15;

    const x = (t: number) => ((t - tMin) / (tMax - tMin)) * 100;
    const ySep = (s: number) => height - 18 - (s / sepMax) * (height - 30);
    const yRate = (r: number) => (height - 18) / 2 - (r / rateAbs) * ((height - 30) / 2);

    const sepPath = tOffsetS
      .map((t, i) => {
        const s = separationKm[i];
        if (t === null || s === null) return "";
        return `${i === 0 ? "M" : "L"} ${x(t)} ${ySep(s)}`;
      })
      .filter(Boolean)
      .join(" ");

    const ratePath = tOffsetS
      .map((t, i) => {
        const r = rangeRateKmS[i];
        if (t === null || r === null) return "";
        return `${i === 0 ? "M" : "L"} ${x(t)} ${yRate(r)}`;
      })
      .filter(Boolean)
      .join(" ");

    return { sepPath, ratePath, tMin, tMax, sepMax, rateAbs };
  }, [tOffsetS, separationKm, rangeRateKmS, height]);

  const cursorIndex =
    cursor === null
      ? null
      : Math.round((cursor / 100) * (tOffsetS.length - 1));

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <span className="label">Separation & Range Rate Through Encounter</span>
        <span style={{ display: "flex", gap: 10, fontSize: 9.5 }}>
          <span style={{ color: "#2dd4bf" }}>— separation (km)</span>
          <span style={{ color: "#f0a030" }}>— range rate (km/s)</span>
        </span>
      </div>

      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        style={{
          background: "var(--bg-void)",
          border: "1px solid var(--line)",
          borderRadius: 3,
          display: "block",
          cursor: "crosshair",
        }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setCursor(((e.clientX - rect.left) / rect.width) * 100);
        }}
        onMouseLeave={() => setCursor(null)}
      >
        {/* zero line for range rate */}
        <line
          x1="0"
          y1={(height - 18) / 2}
          x2="100"
          y2={(height - 18) / 2}
          stroke="#2a3a4e"
          strokeWidth="0.4"
          strokeDasharray="2 2"
        />
        {/* TCA marker */}
        <line
          x1={((0 - tMin) / (tMax - tMin)) * 100}
          y1="0"
          x2={((0 - tMin) / (tMax - tMin)) * 100}
          y2={height - 18}
          stroke="#f04747"
          strokeWidth="0.6"
          strokeDasharray="3 2"
          opacity="0.8"
        />

        <path d={ratePath} fill="none" stroke="#f0a030" strokeWidth="0.9" opacity="0.9"
          vectorEffect="non-scaling-stroke" />
        <path d={sepPath} fill="none" stroke="#2dd4bf" strokeWidth="1.2"
          vectorEffect="non-scaling-stroke" />

        {cursor !== null && (
          <line x1={cursor} y1="0" x2={cursor} y2={height - 18} stroke="#ffffff"
            strokeWidth="0.4" opacity="0.35" />
        )}
      </svg>

      <div
        className="mono"
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 4,
          fontSize: 9.5,
          color: "var(--text-faint)",
        }}
      >
        <span>{fmt(tMin, 0)} s</span>
        <span style={{ color: "var(--text-muted)" }}>
          {cursorIndex !== null &&
          cursorIndex >= 0 &&
          cursorIndex < tOffsetS.length &&
          separationKm[cursorIndex] !== null
            ? `t${(tOffsetS[cursorIndex] ?? 0) >= 0 ? "+" : ""}${fmt(tOffsetS[cursorIndex], 0)} s · sep ${fmt(separationKm[cursorIndex], 3)} km · ṙ ${fmt(rangeRateKmS[cursorIndex], 4)} km/s`
            : `TCA at t=0 · min separation ${fmt(missDistanceKm, 3)} km`}
        </span>
        <span>+{fmt(tMax, 0)} s</span>
      </div>
    </div>
  );
}

/** Simple sparkline for the temporal conjunction profile. */
export function TimelineChart({
  counts,
  hoursPerBucket,
  height = 110,
}: {
  counts: number[];
  hoursPerBucket: number | null;
  height?: number;
}) {
  const max = Math.max(...counts, 1);
  const w = 100 / Math.max(counts.length, 1);

  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>
        Conjunctions Over the Screening Window
      </div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        style={{
          background: "var(--bg-void)",
          border: "1px solid var(--line)",
          borderRadius: 3,
          display: "block",
        }}
      >
        {counts.map((c, i) => (
          <rect
            key={i}
            x={i * w + w * 0.1}
            y={height - (c / max) * (height - 10) - 2}
            width={w * 0.8}
            height={Math.max(c > 0 ? 1.2 : 0, (c / max) * (height - 10))}
            fill="#4a9eda"
            opacity="0.82"
          >
            <title>{`${fmt(i * (hoursPerBucket ?? 1), 1)}–${fmt((i + 1) * (hoursPerBucket ?? 1), 1)} h: ${c}`}</title>
          </rect>
        ))}
      </svg>
      <div
        className="mono"
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 3,
          fontSize: 9,
          color: "var(--text-faint)",
        }}
      >
        <span>now</span>
        <span style={{ color: "var(--text-muted)" }}>
          {fmt(hoursPerBucket, 1)} h per bar
        </span>
        <span>+{fmt(counts.length * (hoursPerBucket ?? 1), 0)} h</span>
      </div>
    </div>
  );
}

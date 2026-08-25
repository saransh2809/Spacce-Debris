/**
 * KAKSHA -- SIMULATION page.
 *
 * Time control with the globe alongside, so the effect of moving the clock is
 * visible immediately. "Jump to TCA" is the useful one during a demonstration:
 * it sets the clock to the exact instant of closest approach and focuses the
 * camera on the encounter, which is how you show that the 3D view and the
 * numerical result are the same computation.
 */
import { useState } from "react";
import {
  fmt,
  fmtDateUTC,
  fmtDuration,
  fmtTimeUTC,
  flagOf,
} from "../api/client";
import {
  useClockControls,
  useConjunctions,
  useTickingTime,
} from "../hooks/useKaksha";
import { useStore } from "../store/useStore";
import { GlobeScene } from "../components/globe/GlobeScene";
import { HoverCard } from "../components/panels/HoverCard";

const OFFSETS = [
  { label: "−24 h", s: -86400 },
  { label: "−6 h", s: -21600 },
  { label: "−1 h", s: -3600 },
  { label: "−30 m", s: -1800 },
  { label: "−10 m", s: -600 },
  { label: "−1 m", s: -60 },
  { label: "+1 m", s: 60 },
  { label: "+10 m", s: 600 },
  { label: "+30 m", s: 1800 },
  { label: "+1 h", s: 3600 },
  { label: "+6 h", s: 21600 },
  { label: "+24 h", s: 86400 },
];

const RATES = [-1000, -100, -10, -1, 0, 1, 10, 100, 1000];

export function Simulation() {
  const controls = useClockControls();
  const now = useTickingTime(10);
  const clockMode = useStore((s) => s.clockMode);
  const rate = useStore((s) => s.rate);
  const paused = useStore((s) => s.paused);
  const setSelectedEvent = useStore((s) => s.setSelectedEvent);
  const setSelectionMode = useStore((s) => s.setSelectionMode);
  const { data: screening } = useConjunctions(40);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const isSim = clockMode === "SIMULATION";

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <div
        style={{
          width: 430,
          flexShrink: 0,
          borderRight: "1px solid var(--line)",
          background: "var(--bg-panel)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="scroll" style={{ flex: 1, padding: 18 }}>
          <h1
            style={{
              fontSize: "var(--fs-xl)",
              fontWeight: 400,
              color: "var(--text-bright)",
              margin: "0 0 4px",
            }}
          >
            Simulation Clock
          </h1>
          <p className="note" style={{ marginBottom: 18, lineHeight: 1.65 }}>
            One clock drives Earth rotation, solar direction, SGP4 propagation and
            every panel. Moving it re-propagates the whole scene; nothing is
            interpolated or replayed from a recording.
          </p>

          {/* current time */}
          <div
            className="panel"
            style={{
              padding: 14,
              marginBottom: 18,
              textAlign: "center",
              background: "var(--bg-void)",
            }}
          >
            <div className="label" style={{ marginBottom: 4 }}>
              {isSim ? "Simulation Time" : "Real Time (UTC)"}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 30,
                fontWeight: 300,
                color: isSim ? "var(--amber)" : "var(--teal)",
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
              }}
            >
              {fmtTimeUTC(now.toISOString())}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
              {fmtDateUTC(now.toISOString())}
            </div>
            {isSim && (
              <div
                className="mono"
                style={{ fontSize: 10.5, color: "var(--amber-dim)", marginTop: 6 }}
              >
                offset {fmtDuration((now.getTime() - Date.now()) / 3600_000)} from wall
                clock · rate {rate}× {paused ? "· PAUSED" : ""}
              </div>
            )}
          </div>

          {/* transport */}
          <div className="label" style={{ marginBottom: 6 }}>
            Transport
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            <button
              className="btn"
              disabled={busy}
              style={{ flex: 1 }}
              onClick={() => void run(() => controls.pause())}
            >
              ❚❚ Pause
            </button>
            <button
              className="btn"
              disabled={busy}
              style={{ flex: 1 }}
              onClick={() => void run(() => controls.play())}
            >
              ▶ Play
            </button>
            <button
              className={isSim ? "btn btn-accent" : "btn"}
              disabled={busy || !isSim}
              style={{ flex: 1 }}
              onClick={() => void run(() => controls.realtime())}
            >
              ⏱ Live
            </button>
          </div>

          {/* rate */}
          <div className="label" style={{ marginBottom: 6 }}>
            Time Acceleration
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 4,
              marginBottom: 16,
            }}
          >
            {RATES.map((r) => (
              <button
                key={r}
                className={isSim && rate === r ? "btn btn-accent" : "btn"}
                disabled={busy}
                style={{ padding: "6px 2px", fontSize: 9.5 }}
                onClick={() => void run(() => controls.setRate(r))}
              >
                {r === 0 ? "⏸" : `${r}×`}
              </button>
            ))}
          </div>

          {/* step */}
          <div className="label" style={{ marginBottom: 6 }}>
            Step
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: 4,
              marginBottom: 16,
            }}
          >
            {OFFSETS.map((o) => (
              <button
                key={o.label}
                className="btn"
                disabled={busy}
                style={{ padding: "6px 2px", fontSize: 9 }}
                onClick={() => void run(() => controls.offset(o.s))}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* absolute jump */}
          <div className="label" style={{ marginBottom: 6 }}>
            Jump to Instant (UTC)
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
            <input
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button
              className="btn btn-accent"
              disabled={busy || !custom}
              onClick={() => {
                if (!custom) return;
                void run(() => controls.jumpTo(new Date(`${custom}:00Z`)));
              }}
            >
              Go
            </button>
          </div>

          {/* jump to TCA */}
          <div className="label" style={{ marginBottom: 6 }}>
            Jump to a Close Approach
          </div>
          <div className="note" style={{ marginBottom: 8 }}>
            Sets the clock to the exact TCA and focuses the camera on the
            encounter.
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            {(screening?.events ?? []).slice(0, 14).map((e) => (
              <button
                key={e.event_id}
                className="btn"
                disabled={busy}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "7px 9px",
                  textTransform: "none",
                  letterSpacing: 0,
                  fontSize: 10.5,
                }}
                onClick={() => {
                  setSelectedEvent(e.event_id);
                  setSelectionMode("CONJUNCTION");
                  void run(() => controls.jumpTo(new Date(e.tca)));
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <span className={`chip chip-${e.risk_category}`} style={{ fontSize: 7.5 }}>
                    {e.risk_category[0]}
                  </span>
                  <span
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      color: "var(--text)",
                    }}
                  >
                    {flagOf(e.object_a.country_iso)} {e.object_a.name} ↔{" "}
                    {e.object_b.name}
                  </span>
                </span>
                <span className="mono" style={{ color: "var(--high)", flexShrink: 0 }}>
                  {fmt(e.miss_distance_km, 2)} km
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, position: "relative", minWidth: 0, background: "var(--bg-void)" }}>
        <GlobeScene />
        <div
          style={{
            position: "absolute",
            top: 14,
            left: 16,
            background: "rgba(8,13,21,0.9)",
            border: "1px solid var(--line)",
            borderRadius: 3,
            padding: "8px 12px",
            backdropFilter: "blur(6px)",
          }}
        >
          <div className="label">Scene time</div>
          <div
            className="mono"
            style={{ fontSize: 15, color: isSim ? "var(--amber)" : "var(--teal)" }}
          >
            {fmtTimeUTC(now.toISOString())} UTC
          </div>
          <div className="note">
            Earth rotation, terminator and all object positions are propagated to
            this instant.
          </div>
        </div>
      </div>
      <HoverCard />
    </div>
  );
}

/**
 * KAKSHA -- hover information card.
 *
 * Appears on hover over an object in the 3D scene and closes on mouse-out.
 * Hovering opens THIS card only; clicking opens the full analysis panel. That
 * separation matters: a panel that swaps content on every mouse movement is
 * unusable in a dense point field.
 *
 * The card fetches the object's propagated state at the current simulation
 * time, so the altitude shown is a real propagated value rather than the
 * catalogue mean.
 */
import { useEffect, useState } from "react";
import { fmt, fmtTimeUTC, flagOf } from "../../api/client";
import { useObject } from "../../hooks/useKaksha";
import { useStore } from "../../store/useStore";

export function HoverCard() {
  const hoveredNorad = useStore((s) => s.hoveredNorad);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const { data } = useObject(hoveredNorad, 2000);

  useEffect(() => {
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  if (hoveredNorad === null) return null;

  const o = data?.object;
  const s = data?.state;
  const matches = o?.norad_id === hoveredNorad;

  // Flip the card to the other side of the cursor near the viewport edges.
  const width = 232;
  const flipX = pos.x + width + 24 > window.innerWidth;
  const flipY = pos.y + 190 > window.innerHeight;

  return (
    <div
      style={{
        position: "fixed",
        left: flipX ? pos.x - width - 14 : pos.x + 14,
        top: flipY ? pos.y - 180 : pos.y + 14,
        width,
        zIndex: 60,
        pointerEvents: "none",
        background: "rgba(8, 13, 21, 0.97)",
        border: "1px solid var(--line-strong)",
        borderRadius: 3,
        padding: "9px 11px",
        backdropFilter: "blur(6px)",
      }}
    >
      {!matches ? (
        <>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
            NORAD {hoveredNorad}
          </div>
          <div className="skeleton" style={{ height: 9, marginTop: 6 }} />
          <div className="skeleton" style={{ height: 9, marginTop: 4, width: "70%" }} />
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 5,
            }}
          >
            <span style={{ fontSize: 12 }}>{flagOf(o.country_iso)}</span>
            <span
              style={{
                fontSize: "var(--fs-small)",
                fontWeight: 600,
                color: "var(--text-bright)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {o.name}
            </span>
          </div>

          <div
            className="mono"
            style={{ fontSize: 9.5, color: "var(--text-muted)", marginBottom: 7 }}
          >
            NORAD {o.norad_id} · {o.intl_designator || "—"}
          </div>

          {[
            ["Type", o.object_type.replace(/_/g, " ")],
            [
              "Operator",
              o.attribution_available ? o.operator : "unavailable",
            ],
            ["Regime", o.regime],
            [
              "Altitude",
              s?.earth_fixed ? `${fmt(s.earth_fixed.altitude_km, 1)} km` : "—",
            ],
            ["Speed", s ? `${fmt(s.speed_km_s, 3)} km/s` : "—"],
          ].map(([k, v]) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "2px 0",
              }}
            >
              <span
                style={{
                  fontSize: 8.5,
                  letterSpacing: "0.09em",
                  textTransform: "uppercase",
                  color: "var(--text-faint)",
                  fontWeight: 700,
                }}
              >
                {k}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: v === "unavailable" ? "var(--warn)" : "var(--text)",
                }}
              >
                {v}
              </span>
            </div>
          ))}

          <div
            style={{
              marginTop: 6,
              paddingTop: 5,
              borderTop: "1px solid var(--line-faint)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span className="mono" style={{ fontSize: 9, color: "var(--text-faint)" }}>
              {fmtTimeUTC(data?.time)} UTC
            </span>
            {o.element_set.is_stale && (
              <span className="chip chip-WARNING" style={{ fontSize: 8 }}>
                STALE
              </span>
            )}
          </div>

          <div
            style={{
              marginTop: 5,
              fontSize: 8.5,
              color: "var(--text-faint)",
              letterSpacing: "0.05em",
            }}
          >
            Click for full analysis
          </div>
        </>
      )}
    </div>
  );
}

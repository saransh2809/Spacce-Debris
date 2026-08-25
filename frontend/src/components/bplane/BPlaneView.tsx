/**
 * KAKSHA -- B-plane (encounter plane) visualisation.
 *
 * WHAT IS ACTUALLY DRAWN
 * ----------------------
 * This is not an illustration of an encounter. Every element is a real number
 * from the pipeline:
 *
 *   - the origin is the primary object at TCA;
 *   - the miss vector is (r_rel · xi, r_rel · zeta), the true relative position
 *     resolved onto the encounter-plane axes;
 *   - the uncertainty ellipse is the combined relative-position covariance
 *     projected into the same plane, drawn at 1σ and 3σ;
 *   - the hard-body circle is the combined object radius, to scale;
 *   - the grey curve is the SGP4-propagated relative trajectory across ±60 s,
 *     projected into the plane. If the linear-encounter assumption holds it is
 *     a straight line through the miss point; where it bends, the assumption is
 *     visibly failing.
 *
 * Because the relative position at TCA is exactly perpendicular to the relative
 * velocity, the 3D encounter reduces to this 2D picture with NO approximation.
 * The out-of-plane residual is displayed as the proof of that.
 *
 * Zoom is logarithmic on the mouse wheel; drag pans. Both are cosmetic — the
 * numbers never change with the view.
 */
import { useMemo, useRef, useState } from "react";
import { fmt, fmtSci } from "../../api/client";
import { useBPlane } from "../../hooks/useKaksha";

interface Props {
  eventId: string;
  compact?: boolean;
}

export function BPlaneView({ eventId, compact = false }: Props) {
  const { data, isLoading, error } = useBPlane(eventId);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showSigma, setShowSigma] = useState(true);
  const [showTrajectory, setShowTrajectory] = useState(true);
  const [cursor, setCursor] = useState<{ xi: number; zeta: number } | null>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const size = compact ? 300 : 520;
  const half = size / 2;

  // Scale so the most demanding feature (3σ ellipse or the miss vector) fits.
  const scale = useMemo(() => {
    if (!data) return 1;
    const sigMajor = data.bplane.uncertainty_ellipse?.sigma_major_km ?? 1;
    const miss = data.bplane.miss_distance_km ?? 1;
    const extent = Math.max(miss * 1.6, (sigMajor ?? 1) * 3.4, 0.5);
    return (half * 0.82) / extent;
  }, [data, half]);

  if (isLoading && !data) {
    return <div className="skeleton" style={{ height: size, borderRadius: 3 }} />;
  }
  if (error || !data) {
    return (
      <div className="empty">
        <strong style={{ color: "var(--warn)" }}>B-plane unavailable</strong>
        <span style={{ fontSize: 10 }}>{(error as Error)?.message}</span>
      </div>
    );
  }

  const bp = data.bplane;
  const ell = bp.uncertainty_ellipse;
  const bXi = bp.miss_vector_km.xi ?? 0;
  const bZeta = bp.miss_vector_km.zeta ?? 0;

  // km -> SVG px. Zeta is negated because SVG y grows downward.
  const px = (km: number) => km * scale * zoom;
  const cx = half + pan.x;
  const cy = half + pan.y;

  const hbrKm = (bp.hard_body_radius_m ?? 0) / 1000;

  const trajectory = data.relative_trajectory;
  const trajPath =
    showTrajectory && trajectory.xi_km.length > 1
      ? trajectory.xi_km
          .map(
            (xi, i) =>
              `${i === 0 ? "M" : "L"} ${cx + px(xi)} ${cy - px(trajectory.zeta_km[i])}`,
          )
          .join(" ")
      : "";

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(60, Math.max(0.2, z * (e.deltaY > 0 ? 0.86 : 1.16))));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragging.current) {
      setPan({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setCursor({
      xi: (sx - cx) / (scale * zoom),
      zeta: -(sy - cy) / (scale * zoom),
    });
  };

  const gridStepKm = (() => {
    const target = 60 / (scale * zoom);
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    for (const m of [1, 2, 5, 10]) if (pow * m >= target) return pow * m;
    return pow * 10;
  })();

  const gridLines: number[] = [];
  const maxKm = half / (scale * zoom);
  for (let k = -Math.ceil(maxKm / gridStepKm); k <= Math.ceil(maxKm / gridStepKm); k++) {
    gridLines.push(k * gridStepKm);
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          marginBottom: 8,
        }}
      >
        <span className="label">Encounter Plane · TCA</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className={showSigma ? "btn btn-accent" : "btn"}
            style={{ padding: "3px 7px", fontSize: 9 }}
            onClick={() => setShowSigma((v) => !v)}
          >
            σ
          </button>
          <button
            className={showTrajectory ? "btn btn-accent" : "btn"}
            style={{ padding: "3px 7px", fontSize: 9 }}
            onClick={() => setShowTrajectory((v) => !v)}
          >
            Path
          </button>
          <button
            className="btn"
            style={{ padding: "3px 7px", fontSize: 9 }}
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${size} ${size}`}
        style={{
          background: "var(--bg-void)",
          border: "1px solid var(--line)",
          borderRadius: 3,
          cursor: dragging.current ? "grabbing" : "crosshair",
          display: "block",
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => (dragging.current = null)}
        onMouseLeave={() => {
          dragging.current = null;
          setCursor(null);
        }}
      >
        <defs>
          <radialGradient id="sigmaFill">
            <stop offset="0%" stopColor="#f0a030" stopOpacity="0.13" />
            <stop offset="100%" stopColor="#f0a030" stopOpacity="0.03" />
          </radialGradient>
          <marker
            id="arrow"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 z" fill="#f04747" />
          </marker>
        </defs>

        {/* grid */}
        <g opacity="0.5">
          {gridLines.map((km) => (
            <g key={km}>
              <line
                x1={cx + px(km)}
                y1={0}
                x2={cx + px(km)}
                y2={size}
                stroke={km === 0 ? "#2a3a4e" : "#141d29"}
                strokeWidth={km === 0 ? 1 : 0.5}
              />
              <line
                x1={0}
                y1={cy - px(km)}
                x2={size}
                y2={cy - px(km)}
                stroke={km === 0 ? "#2a3a4e" : "#141d29"}
                strokeWidth={km === 0 ? 1 : 0.5}
              />
            </g>
          ))}
        </g>

        {/* axis labels */}
        <text x={size - 8} y={cy - 6} fill="#58687c" fontSize="10" textAnchor="end">
          ξ (xi) →
        </text>
        <text x={cx + 6} y={12} fill="#58687c" fontSize="10">
          ↑ ζ (zeta)
        </text>

        {/* uncertainty ellipses: 3σ then 1σ */}
        {showSigma && ell && (
          <g
            transform={`translate(${cx} ${cy}) rotate(${-(ell.orientation_deg ?? 0)})`}
          >
            <ellipse
              rx={px((ell.sigma_major_km ?? 0) * 3)}
              ry={px((ell.sigma_minor_km ?? 0) * 3)}
              fill="url(#sigmaFill)"
              stroke="#f0a030"
              strokeWidth="0.8"
              strokeDasharray="4 3"
              opacity="0.5"
            />
            <ellipse
              rx={px(ell.sigma_major_km ?? 0)}
              ry={px(ell.sigma_minor_km ?? 0)}
              fill="url(#sigmaFill)"
              stroke="#f0a030"
              strokeWidth="1.2"
              opacity="0.85"
            />
          </g>
        )}

        {/* hard-body circle, to scale */}
        {hbrKm > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={Math.max(1, px(hbrKm))}
            fill="#f04747"
            fillOpacity="0.28"
            stroke="#f04747"
            strokeWidth="1"
          />
        )}

        {/* real relative trajectory */}
        {trajPath && (
          <path
            d={trajPath}
            fill="none"
            stroke="#8493a6"
            strokeWidth="1.2"
            strokeDasharray="3 2"
            opacity="0.8"
          />
        )}

        {/* miss vector */}
        <line
          x1={cx}
          y1={cy}
          x2={cx + px(bXi)}
          y2={cy - px(bZeta)}
          stroke="#f04747"
          strokeWidth="1.6"
          markerEnd="url(#arrow)"
        />

        {/* primary at origin */}
        <circle cx={cx} cy={cy} r="4" fill="#2dd4bf" />
        <text x={cx + 8} y={cy + 13} fill="#2dd4bf" fontSize="9.5">
          {data.object_a.name.slice(0, 20)}
        </text>

        {/* secondary at the miss point */}
        <circle cx={cx + px(bXi)} cy={cy - px(bZeta)} r="4" fill="#f04747" />
        <text
          x={cx + px(bXi) + 8}
          y={cy - px(bZeta) - 6}
          fill="#f04747"
          fontSize="9.5"
        >
          {data.object_b.name.slice(0, 20)}
        </text>

        {/* scale bar */}
        <g transform={`translate(14 ${size - 20})`}>
          <line x1="0" y1="0" x2={px(gridStepKm)} y2="0" stroke="#58687c" strokeWidth="1.4" />
          <line x1="0" y1="-4" x2="0" y2="4" stroke="#58687c" strokeWidth="1.4" />
          <line
            x1={px(gridStepKm)}
            y1="-4"
            x2={px(gridStepKm)}
            y2="4"
            stroke="#58687c"
            strokeWidth="1.4"
          />
          <text x={px(gridStepKm) / 2} y="-7" fill="#8493a6" fontSize="9.5" textAnchor="middle">
            {gridStepKm < 1 ? `${(gridStepKm * 1000).toFixed(0)} m` : `${gridStepKm} km`}
          </text>
        </g>

        {cursor && (
          <text x="14" y="18" fill="#58687c" fontSize="9.5" className="mono">
            ξ {cursor.xi.toFixed(3)} · ζ {cursor.zeta.toFixed(3)} km
          </text>
        )}
      </svg>

      {/* --- numeric readout --- */}
      <div style={{ marginTop: 9 }}>
        <div className="kv">
          <span className="kv-key">Miss vector b</span>
          <span className="kv-val">
            ξ {fmt(bXi, 4)} · ζ {fmt(bZeta, 4)} km
          </span>
        </div>
        <div className="kv">
          <span className="kv-key">|b|</span>
          <span className="kv-val" style={{ color: "var(--high)" }}>
            {fmt(bp.miss_distance_km, 5)} km
          </span>
        </div>
        <div
          className="kv"
          title="At a correct TCA the relative position is perpendicular to the relative velocity, so this must be zero. It is the arithmetic proof that the solver landed on the true closest approach."
        >
          <span className="kv-key">η residual</span>
          <span className="kv-val" style={{ color: "var(--ok)" }}>
            {fmtSci(bp.out_of_plane_residual_km, 2)} km
          </span>
        </div>
        <div className="kv">
          <span className="kv-key">Encounter angle</span>
          <span className="kv-val">{fmt(bp.encounter_angle_deg, 3)}°</span>
        </div>
        <div className="kv">
          <span className="kv-key">Rel. speed</span>
          <span className="kv-val">{fmt(bp.relative_speed_km_s, 4)} km/s</span>
        </div>
        {ell && (
          <>
            <div className="kv">
              <span className="kv-key">σ major / minor</span>
              <span className="kv-val">
                {fmt(ell.sigma_major_km, 4)} / {fmt(ell.sigma_minor_km, 4)} km
              </span>
            </div>
            <div className="kv">
              <span className="kv-key">Ellipse source</span>
              <span className="kv-val">
                <span className={`chip chip-${ell.source}`}>
                  {ell.source.replace("_", " ")}
                </span>
              </span>
            </div>
          </>
        )}
        <div className="kv">
          <span className="kv-key">Hard-body radius</span>
          <span className="kv-val">{fmt(bp.hard_body_radius_m, 2)} m</span>
        </div>
      </div>

      {!bp.linear_assumption_valid && (
        <div className="caveat" style={{ marginTop: 8 }}>
          <strong>Slow encounter.</strong> Relative speed is{" "}
          {fmt(bp.relative_speed_km_s, 3)} km/s. The 2D encounter formulation
          assumes rectilinear relative motion through the plane; below about
          0.5 km/s that assumption degrades and the curved trajectory above shows
          it.
        </div>
      )}

      {!compact && (
        <div className="note" style={{ marginTop: 8, lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text-dim)" }}>Definition.</strong>{" "}
          {bp.definition} {bp.out_of_plane_residual_note} {data.trajectory_note}
        </div>
      )}
    </div>
  );
}

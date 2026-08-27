import { useCallback, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { bPlane } from '../data/landingContent'
import { useLanding } from '../data/LandingDataContext'
import { EASE, Eyebrow, ProvenanceTag, Reveal, Section } from './primitives'

/* ============================================================================
   B-PLANE (spec 17)
   A stylised, interactive view of the encounter plane — the plane normal to the
   relative velocity vector, in which miss distance and uncertainty are read.

   This performs NO orbital science. It projects values that demoData already
   holds. The projection maths below is honest 3D-to-2D drawing, nothing more;
   a production component would take the same props from the KAKSHA engine.
   ========================================================================== */

const VIEW_W = 640
const VIEW_H = 470
const ORIGIN_X = 322
const ORIGIN_Y = 250
const PX_PER_KM = 132
const PERSP = 6.2

const DEFAULT_VIEW = { yaw: 0.62, pitch: 0.66 }

/** Rotate a point in the encounter frame, then project it with mild perspective. */
function project(t: number, r: number, z: number, yaw: number, pitch: number) {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const x1 = t * cy + z * sy
  const z1 = -t * sy + z * cy

  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const y2 = r * cp - z1 * sp
  const z2 = r * sp + z1 * cp

  const f = PERSP / (PERSP + z2)
  return {
    x: ORIGIN_X + x1 * PX_PER_KM * f,
    y: ORIGIN_Y - y2 * PX_PER_KM * f,
    depth: z2,
    f,
  }
}

const toPath = (pts: { x: number; y: number }[]) => pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ')

export function BPlaneSection() {
  const reduce = useReducedMotion()
  const [view, setView] = useState(DEFAULT_VIEW)
  const [sigmaLevel, setSigmaLevel] = useState(3)
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)

  const { yaw, pitch } = view
  const { conjunction, conjunctionLive } = useLanding()
  const { uncertainty, axisLabels } = bPlane
  const screeningThresholdKm = conjunction.screeningThresholdKm

  /**
   * The miss VECTOR is illustrative -- the summary endpoint carries a magnitude
   * but not a direction -- so a fixed unit vector is scaled by the engine's own
   * miss distance. The magnitude drawn is therefore real; the bearing is not,
   * and the figure's footer says so.
   */
  const missVector = useMemo(
    () => ({
      bR: bPlane.missVectorUnit.bR * conjunction.missDistanceKm,
      bT: bPlane.missVectorUnit.bT * conjunction.missDistanceKm,
    }),
    [conjunction.missDistanceKm],
  )

  /* ------------------------------------------------------------- geometry */

  const geo = useMemo(() => {
    const EXTENT = 1.5
    const STEP = 0.25

    // Grid on the encounter plane (z = 0).
    const grid = []
    for (let v = -EXTENT; v <= EXTENT + 1e-6; v += STEP) {
      const major = Math.abs(v % 0.5) < 1e-6
      grid.push({
        major,
        d: toPath([project(v, -EXTENT, 0, yaw, pitch), project(v, EXTENT, 0, yaw, pitch)]),
      })
      grid.push({
        major,
        d: toPath([project(-EXTENT, v, 0, yaw, pitch), project(EXTENT, v, 0, yaw, pitch)]),
      })
    }

    // Screening-threshold ring — the miss falling inside it is the whole story.
    const ring = []
    const thresholdPts = []
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2
      thresholdPts.push(
        project(Math.cos(a) * screeningThresholdKm, Math.sin(a) * screeningThresholdKm, 0, yaw, pitch)
      )
    }
    ring.push(toPath(thresholdPts) + ' Z')

    // Uncertainty ellipse around the secondary, tilted in-plane.
    const tilt = (uncertainty.tiltDeg * Math.PI) / 180
    const ct = Math.cos(tilt)
    const st = Math.sin(tilt)
    const ellipseFor = (k: number) => {
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * Math.PI * 2
        const et = Math.cos(a) * uncertainty.sigmaT * k
        const er = Math.sin(a) * uncertainty.sigmaR * k
        pts.push(
          project(missVector.bT + et * ct - er * st, missVector.bR + et * st + er * ct, 0, yaw, pitch)
        )
      }
      return toPath(pts) + ' Z'
    }

    // Axes.
    const axisT = toPath([project(-EXTENT, 0, 0, yaw, pitch), project(EXTENT, 0, 0, yaw, pitch)])
    const axisR = toPath([project(0, -EXTENT, 0, yaw, pitch), project(0, EXTENT, 0, yaw, pitch)])
    // Relative-velocity axis: the plane normal, which the trajectory runs along.
    const axisV = toPath([project(0, 0, -1.7, yaw, pitch), project(0, 0, 1.7, yaw, pitch)])

    // The secondary's relative trajectory, piercing the plane at the miss vector.
    const trajectory = toPath([
      project(missVector.bT, missVector.bR, -1.7, yaw, pitch),
      project(missVector.bT, missVector.bR, 1.7, yaw, pitch),
    ])

    const nominal = project(0, 0, 0, yaw, pitch)
    const pierce = project(missVector.bT, missVector.bR, 0, yaw, pitch)
    const missLine = toPath([nominal, pierce])

    // Unit normal to the drawn miss line, used to push its label clear.
    const mdx = pierce.x - nominal.x
    const mdy = pierce.y - nominal.y
    const mlen = Math.hypot(mdx, mdy) || 1
    const missLabelOffset = { x: (-mdy / mlen) * 16, y: (mdx / mlen) * 16 }

    return {
      grid,
      ring,
      ellipse1: ellipseFor(1),
      ellipse3: ellipseFor(3),
      axisT,
      axisR,
      axisV,
      trajectory,
      nominal,
      pierce,
      missLine,
      missLabelOffset,
      labelT: project(EXTENT + 0.14, 0, 0, yaw, pitch),
      labelR: project(0, EXTENT + 0.12, 0, yaw, pitch),
      labelV: project(0, 0, 1.85, yaw, pitch),
      labelRing: project(0, -screeningThresholdKm, 0, yaw, pitch),
    }
  }, [yaw, pitch, missVector, uncertainty, screeningThresholdKm])

  /* --------------------------------------------------------------- drag  */

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      drag.current = { x: e.clientX, y: e.clientY, yaw, pitch }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [yaw, pitch]
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    setView({
      yaw: d.yaw + (e.clientX - d.x) * 0.006,
      pitch: Math.max(0.12, Math.min(1.32, d.pitch + (e.clientY - d.y) * 0.005)),
    })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = 0.08
    if (e.key === 'ArrowLeft') setView((v) => ({ ...v, yaw: v.yaw - step }))
    else if (e.key === 'ArrowRight') setView((v) => ({ ...v, yaw: v.yaw + step }))
    else if (e.key === 'ArrowUp') setView((v) => ({ ...v, pitch: Math.max(0.12, v.pitch - step) }))
    else if (e.key === 'ArrowDown') setView((v) => ({ ...v, pitch: Math.min(1.32, v.pitch + step) }))
    else return
    e.preventDefault()
  }, [])

  /* ------------------------------------------------------------- reveal  */

  const reveal = (delay: number, extra: { hidden?: object; shown?: object } = {}) => ({
    variants: {
      hidden: { opacity: 0, ...extra.hidden },
      shown: { opacity: 1, ...extra.shown },
    },
    transition: { duration: reduce ? 0.2 : 0.75, delay: reduce ? 0 : delay, ease: EASE },
  })

  return (
    <Section id="bplane" className="bplane">
      <div className="shell bplane__grid">
        <div className="bplane__copy">
          <Reveal>
            <Eyebrow>B-PLANE VISUALISATION</Eyebrow>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="h-section">
              Understanding the <span className="accent">encounter geometry</span>
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="lede">
              The B-plane is the plane normal to the relative velocity vector at closest
              approach. Projecting the encounter into it turns a moving three-dimensional
              problem into a flat one: where the secondary pierces the plane, and how
              confident we are about that point.
            </p>
          </Reveal>

          <Reveal delay={0.18}>
            <dl className="bplane__facts">
              <div>
                <dt className="kx-label">MISS VECTOR</dt>
                <dd className="readout">
                  B<sub>R</sub> {missVector.bR.toFixed(3)} &nbsp; B<sub>T</sub>{' '}
                  {missVector.bT.toFixed(3)} <em>km</em>
                </dd>
              </div>
              <div>
                <dt className="kx-label">MAGNITUDE</dt>
                <dd className="readout accent">{conjunction.missDistanceKm.toFixed(3)} <em>km</em></dd>
              </div>
              <div>
                <dt className="kx-label">
                  1<span className="no-caps">&sigma;</span> UNCERTAINTY
                </dt>
                <dd className="readout">
                  {uncertainty.sigmaR.toFixed(2)} &times; {uncertainty.sigmaT.toFixed(2)} <em>km</em>
                </dd>
              </div>
              <div>
                <dt className="kx-label">ELLIPSE TILT</dt>
                <dd className="readout">{uncertainty.tiltDeg}&deg;</dd>
              </div>
            </dl>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="bplane__controls">
              <div className="seg" role="group" aria-label="Uncertainty level">
                {bPlane.uncertainty.sigmaLevels.map((k: number) => (
                  <button
                    key={k}
                    className={'seg__btn' + (sigmaLevel === k ? ' is-on' : '')}
                    onClick={() => setSigmaLevel(k)}
                    aria-pressed={sigmaLevel === k}
                  >
                    {k}&sigma;
                  </button>
                ))}
              </div>
              <button className="kx-btn kx-btn--ghost bplane__reset" onClick={() => setView(DEFAULT_VIEW)}>
                RESET VIEW
              </button>
              <span className="bplane__hint kx-label">DRAG THE PLANE TO ROTATE</span>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.1} className="bplane__figure-wrap">
          <div className="bplane__figure kx-panel kx-panel--ticked">
            <div className="bplane__figure-head">
              <span className="kx-label">ENCOUNTER PLANE &mdash; NORMAL TO RELATIVE VELOCITY</span>
              <ProvenanceTag live={conjunctionLive} liveLabel="LIVE EVENT" />
            </div>

            <motion.svg
              className="bplane__svg"
              viewBox={'0 0 ' + VIEW_W + ' ' + VIEW_H}
              role="img"
              aria-label="Projected B-plane showing the nominal encounter point, the miss vector, the secondary object's piercing point, its uncertainty ellipse, and the screening threshold ring."
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
              initial="hidden"
              whileInView="shown"
              viewport={{ once: true, margin: '-15% 0px -15% 0px' }}
            >
              <defs>
                <radialGradient id="bp-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#F97316" stopOpacity="0.42" />
                  <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="bp-traj" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F97316" stopOpacity="0.05" />
                  <stop offset="45%" stopColor="#F97316" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#F97316" stopOpacity="0.05" />
                </linearGradient>
              </defs>

              {/* grid */}
              <motion.g {...reveal(0.05)}>
                {geo.grid.map((g, i) => (
                  <path
                    key={i}
                    d={g.d}
                    stroke={g.major ? 'rgba(34,211,238,0.20)' : 'rgba(148,163,184,0.10)'}
                    strokeWidth={g.major ? 1 : 0.7}
                    fill="none"
                  />
                ))}
              </motion.g>

              {/* screening threshold ring */}
              <motion.g {...reveal(0.3)}>
                {geo.ring.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    stroke="rgba(34,211,238,0.45)"
                    strokeWidth="1.1"
                    strokeDasharray="5 5"
                    fill="rgba(34,211,238,0.035)"
                  />
                ))}
                <text
                  className="bplane__svg-label"
                  x={geo.labelRing.x}
                  y={geo.labelRing.y + 16}
                  textAnchor="middle"
                  fill="rgba(34,211,238,0.65)"
                >
                  SCREENING THRESHOLD {screeningThresholdKm.toFixed(3)} km
                </text>
              </motion.g>

              {/* axes */}
              <motion.g {...reveal(0.18)}>
                <path d={geo.axisT} stroke="rgba(226,232,240,0.55)" strokeWidth="1.2" fill="none" />
                <path d={geo.axisR} stroke="rgba(226,232,240,0.55)" strokeWidth="1.2" fill="none" />
                <path
                  d={geo.axisV}
                  stroke="rgba(148,163,184,0.32)"
                  strokeWidth="1"
                  strokeDasharray="3 4"
                  fill="none"
                />
                <text className="bplane__svg-label" x={geo.labelT.x} y={geo.labelT.y} fill="rgba(226,232,240,0.72)">
                  {axisLabels.t}
                </text>
                <text
                  className="bplane__svg-label"
                  x={geo.labelR.x}
                  y={geo.labelR.y - 8}
                  textAnchor="middle"
                  fill="rgba(226,232,240,0.72)"
                >
                  {axisLabels.r}
                </text>
                <text
                  className="bplane__svg-label"
                  x={geo.labelV.x}
                  y={geo.labelV.y}
                  textAnchor="middle"
                  fill="rgba(148,163,184,0.6)"
                >
                  V<tspan dy="3" fontSize="7">REL</tspan>
                </text>
              </motion.g>

              {/* relative trajectory through the plane */}
              <motion.g {...reveal(0.42)}>
                <path d={geo.trajectory} stroke="url(#bp-traj)" strokeWidth="1.6" fill="none" />
              </motion.g>

              {/* uncertainty */}
              <motion.g
                {...reveal(0.55, { hidden: { scale: 0.72 }, shown: { scale: 1 } })}
                style={{ originX: geo.pierce.x + 'px', originY: geo.pierce.y + 'px' }}
              >
                <circle cx={geo.pierce.x} cy={geo.pierce.y} r="58" fill="url(#bp-glow)" />
                {sigmaLevel >= 3 && (
                  <path
                    d={geo.ellipse3}
                    stroke="rgba(249,115,22,0.5)"
                    strokeWidth="1.1"
                    strokeDasharray="4 4"
                    fill="rgba(249,115,22,0.06)"
                  />
                )}
                <path
                  d={geo.ellipse1}
                  stroke="rgba(249,115,22,0.9)"
                  strokeWidth="1.4"
                  fill="rgba(249,115,22,0.12)"
                />
              </motion.g>

              {/* miss vector */}
              <motion.g {...reveal(0.68)}>
                <path
                  d={geo.missLine}
                  stroke="#F8FAFC"
                  strokeWidth="1.4"
                  strokeDasharray="3 3"
                  fill="none"
                />
                {/* Offset perpendicular to the miss vector so the value never
                    sits on top of the object labels at either end. */}
                <text
                  className="bplane__svg-value"
                  x={(geo.nominal.x + geo.pierce.x) / 2 + geo.missLabelOffset.x}
                  y={(geo.nominal.y + geo.pierce.y) / 2 + geo.missLabelOffset.y}
                  textAnchor="middle"
                  fill="#F8FAFC"
                >
                  {conjunction.missDistanceKm.toFixed(3)} km
                </text>
              </motion.g>

              {/* the two objects */}
              <motion.g {...reveal(0.78)}>
                <circle cx={geo.nominal.x} cy={geo.nominal.y} r="9" fill="rgba(34,211,238,0.16)" />
                <circle cx={geo.nominal.x} cy={geo.nominal.y} r="4.2" fill="#22D3EE" />
                <text
                  className="bplane__svg-label"
                  x={geo.nominal.x - 14}
                  y={geo.nominal.y + 16}
                  textAnchor="end"
                  fill="#22D3EE"
                >
                  OBJECT A (NOMINAL)
                </text>

                <circle cx={geo.pierce.x} cy={geo.pierce.y} r="4.2" fill="#F97316" />
                <text
                  className="bplane__svg-label"
                  x={geo.pierce.x + 12}
                  y={geo.pierce.y - 6}
                  fill="#F97316"
                >
                  OBJECT B
                </text>
              </motion.g>
            </motion.svg>

            <div className="bplane__figure-foot">
              <span className="kx-label">
                SCALE 1 GRID = 0.250 km &nbsp;&middot;&nbsp; VIEW YAW {(yaw * 57.2958).toFixed(0)}
                &deg; PITCH {(pitch * 57.2958).toFixed(0)}&deg;
              </span>
              <span className="kx-label">STYLISED PROJECTION &mdash; NOT A COVARIANCE SOLUTION</span>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  )
}

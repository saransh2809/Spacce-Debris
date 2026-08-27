import { useCallback, useEffect, useRef, useState } from 'react'
import { encounter, formatTca, riskPalette, separationAt } from '../data/landingContent'
import { useLanding } from '../data/LandingDataContext'
import { missExaggeration } from '../lib/encounterGeometry'
import { registerLabel } from '../lib/labelBridge'
import { scene } from '../lib/sceneStore'
import { Eyebrow, ProvenanceTag, Reveal, Section } from './primitives'

/* ============================================================================
   CONJUNCTION (spec 14) + INTERACTIVE ENCOUNTER (spec 15)
   The two objects and their tracks are on the WebGL stage. This section owns
   the numbers, the in-scene labels, and the playback transport.

   Every readout below is computed from demoData, never measured off the
   drawing — the drawing exaggerates scale, the numbers do not.
   ========================================================================== */


function phaseFor(t: number) {
  if (t < -30) return 'APPROACH'
  if (t < -2) return 'CLOSING'
  if (t <= 2) return 'MINIMUM SEPARATION'
  if (t < 30) return 'RECEDING'
  return 'SEPARATED'
}

function signedTime(t: number) {
  const sign = t < -0.05 ? '−' : t > 0.05 ? '+' : '±'
  return 'T ' + sign + ' ' + Math.abs(t).toFixed(1) + 's'
}

/** A label that rides along with its object in the 3D scene. */
function SceneLabel({ id, tone, title, sub }: { id: string; tone: string; title: string; sub?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    registerLabel(id, ref.current)
    return () => registerLabel(id, null)
  }, [id])

  // The outer node is positioned by the render loop; the inner one centres
  // itself on that point, so the transform written per frame stays a pure
  // translate.
  return (
    <div ref={ref} className={'scene-label scene-label--' + tone} style={{ visibility: 'hidden' }}>
      <span className="scene-label__inner">
        <span className="scene-label__title">{title}</span>
        {sub ? <span className="scene-label__sub kx-label">{sub}</span> : null}
      </span>
    </div>
  )
}

export function ConjunctionSection() {
  const { conjunction, conjunctionLive } = useLanding()
  const risk = riskPalette[conjunction.riskLevel] ?? riskPalette.MODERATE
  const exaggeration = missExaggeration(conjunction.missDistanceKm)

  const [playing, setPlaying] = useState(false)

  const timeRef = useRef<HTMLSpanElement>(null)
  const sepRef = useRef<HTMLSpanElement>(null)
  const phaseRef = useRef<HTMLSpanElement>(null)
  const headRef = useRef<HTMLSpanElement>(null)
  const rangeRef = useRef<HTMLInputElement>(null)
  const dragging = useRef(false)

  const span = encounter.endSeconds - encounter.startSeconds

  /* ---- one rAF loop keeps the transport in sync with the 3D playback ---- */
  useEffect(() => {
    let frame = 0
    let lastPlaying: boolean | null = null

    const tick = () => {
      const t = scene.encounter.t
      const pct = ((t - encounter.startSeconds) / span) * 100

      if (headRef.current) headRef.current.style.left = pct.toFixed(3) + '%'
      if (timeRef.current) timeRef.current.textContent = signedTime(t)
      if (sepRef.current) sepRef.current.textContent = separationAt(t, conjunction.missDistanceKm, conjunction.relativeVelocityKmS).toFixed(3)
      if (phaseRef.current) phaseRef.current.textContent = phaseFor(t)
      if (rangeRef.current && !dragging.current) rangeRef.current.value = String(Math.round(t * 10))

      // Playback ends inside the render loop, so mirror that back into React
      // only when it actually changes.
      if (lastPlaying !== scene.encounter.playing) {
        lastPlaying = scene.encounter.playing
        setPlaying(scene.encounter.playing)
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [span, conjunction.missDistanceKm, conjunction.relativeVelocityKmS])

  const play = useCallback(() => {
    const enc = scene.encounter
    if (enc.playing) {
      enc.playing = false
      return
    }
    if (enc.t >= encounter.endSeconds - 0.01) enc.t = encounter.startSeconds
    enc.playStartedAt = null // re-anchor from the current playhead
    enc.playing = true
    enc.everPlayed = true
  }, [])

  const replay = useCallback(() => {
    const enc = scene.encounter
    enc.t = encounter.startSeconds
    enc.playStartedAt = null
    enc.playing = true
    enc.everPlayed = true
  }, [])

  const onScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const enc = scene.encounter
    enc.playing = false
    enc.playStartedAt = null
    enc.everPlayed = true
    enc.t = Number(e.target.value) / 10
  }, [])

  return (
    <Section id="conjunction" className="conj">
      {/* Labels tracking the objects in the 3D scene. */}
      <SceneLabel id="objectA" tone="a" title={conjunction.primary.name} sub={conjunction.primary.type} />
      <SceneLabel id="objectB" tone="b" title={conjunction.secondary.name} sub={conjunction.secondary.type} />
      <SceneLabel id="tca" tone="tca" title="TCA" />

      <div className="shell conj__grid">
        <div className="conj__copy">
          <Reveal>
            <Eyebrow>CONJUNCTION ANALYSIS</Eyebrow>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="h-section conj__title">
              Predict. Analyse. <span className="accent">Prevent.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="lede">
              Out of the whole screened population, two objects matter right now. KAKSHA
              resolves when they are closest, how close that is, and how fast they pass —
              then ranks the encounter against every other one in the window.
            </p>
          </Reveal>

          <Reveal delay={0.18}>
            <div className="conj__pair">
              <div className="conj__object conj__object--a">
                <span className="conj__object-dot" />
                <span className="conj__object-name">{conjunction.primary.name}</span>
                <span className="kx-label">{conjunction.primary.type}</span>
              </div>
              <div className="conj__object conj__object--b">
                <span className="conj__object-dot" />
                <span className="conj__object-name">{conjunction.secondary.name}</span>
                <span className="kx-label">{conjunction.secondary.type}</span>
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.1} className="conj__readout-wrap">
          <div className="conj__readout kx-panel kx-panel--ticked">
            <div className="conj__readout-head">
              <span className="kx-label">EVENT {conjunction.id}</span>
              <ProvenanceTag live={conjunctionLive} liveLabel="LIVE EVENT" />
            </div>

            <div className="stat-grid">
              <div className="stat">
                <span className="stat__label">MISS DISTANCE</span>
                <span className="stat__value readout" style={{ color: risk.color }}>
                  {conjunction.missDistanceKm.toFixed(3)} <em>km</em>
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">RELATIVE VELOCITY</span>
                <span className="stat__value readout">
                  {conjunction.relativeVelocityKmS.toFixed(3)} <em>km/s</em>
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">TIME TO TCA</span>
                <span className="stat__value readout">{formatTca(conjunction.timeToTcaSeconds)}</span>
              </div>
              <div className="stat">
                <span className="stat__label">RELATIVE ANGLE</span>
                <span className="stat__value readout">
                  {conjunction.relativeAngleDeg.toFixed(2)}
                  <em>&deg;</em>
                </span>
              </div>
            </div>

            <div
              className="risk-bar"
              style={{ '--risk': risk.color } as React.CSSProperties}
              role="status"
            >
              <span className="risk-bar__label kx-label">RISK LEVEL</span>
              <span className="risk-bar__value">{risk.label}</span>
              <span className="risk-bar__note kx-label">
                MISS &lt; {conjunction.screeningThresholdKm.toFixed(3)} km THRESHOLD
              </span>
            </div>

            {/* ------------------------- transport ------------------------- */}
            <div className="encounter">
              <div className="encounter__head">
                <div className="encounter__buttons">
                  <button className="kx-btn kx-btn--primary encounter__play" onClick={play}>
                    {playing ? (
                      <>
                        <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
                          <rect x="0" y="0" width="3.2" height="12" fill="currentColor" />
                          <rect x="6.8" y="0" width="3.2" height="12" fill="currentColor" />
                        </svg>
                        PAUSE
                      </>
                    ) : (
                      <>
                        <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
                          <path d="M0 0l10 6-10 6z" fill="currentColor" />
                        </svg>
                        PLAY ENCOUNTER
                      </>
                    )}
                  </button>
                  <button className="kx-btn kx-btn--ghost encounter__replay" onClick={replay} aria-label="Replay from T minus 60 seconds">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                      <path
                        d="M11.5 6.5a5 5 0 1 1-1.6-3.7M11.8 1v3.1H8.7"
                        stroke="currentColor"
                        strokeWidth="1.3"
                      />
                    </svg>
                  </button>
                </div>

                <div className="encounter__live">
                  <span ref={timeRef} className="encounter__time readout">
                    T &minus; 60.0s
                  </span>
                  <span ref={phaseRef} className="encounter__phase kx-label">
                    APPROACH
                  </span>
                </div>
              </div>

              <div className="encounter__track">
                <span className="encounter__track-line" aria-hidden="true" />
                <span className="encounter__tca-mark" aria-hidden="true" />
                <span ref={headRef} className="encounter__head-dot" aria-hidden="true" />
                <input
                  ref={rangeRef}
                  className="encounter__range"
                  type="range"
                  min={encounter.startSeconds * 10}
                  max={encounter.endSeconds * 10}
                  step="1"
                  defaultValue={encounter.startSeconds * 10}
                  onChange={onScrub}
                  onPointerDown={() => {
                    dragging.current = true
                  }}
                  onPointerUp={() => {
                    dragging.current = false
                  }}
                  onBlur={() => {
                    dragging.current = false
                  }}
                  aria-label="Encounter timeline, seconds relative to time of closest approach"
                />
              </div>

              <div className="encounter__ticks" aria-hidden="true">
                {encounter.keyframes.map((k) => (
                  <span
                    key={k.t}
                    className={'encounter__tick' + (k.t === 0 ? ' is-tca' : '')}
                    style={{ left: ((k.t - encounter.startSeconds) / span) * 100 + '%' }}
                  >
                    {k.label}
                  </span>
                ))}
              </div>

              <div className="encounter__sep">
                <span className="kx-label">LIVE SEPARATION</span>
                <span className="encounter__sep-value readout">
                  <span ref={sepRef}>573.689</span> <em>km</em>
                </span>
              </div>
            </div>

            <p className="conj__scale-note kx-label">
              GEOMETRY NOT TO SCALE &mdash; CROSS-TRACK SEPARATION MAGNIFIED
              &times;{exaggeration.toLocaleString('en-US')} SO THE ENCOUNTER IS VISIBLE.
              READOUTS ARE COMPUTED, NOT MEASURED FROM THE DRAWING.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  )
}

import { motion, useReducedMotion } from 'motion/react'
import { useLanding } from '../data/LandingDataContext'
import { ArrowRight, Eyebrow, ProvenanceTag, Section } from './primitives'

/**
 * KAKSHA -- landing hero.
 *
 * The Earth itself lives on the WebGL stage behind this markup; the hero owns
 * only the copy, the metric modules and the catalogue readout. Those figures
 * come from the engine when it is reachable and from representative values
 * when it is not -- the provenance tag says which.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const LINES = ["SEE WHAT'S", 'HAPPENING', 'ABOVE US.']

function HeadlineLine({ text, index, accent }: { text: string; index: number; accent: boolean }) {
  const reduce = useReducedMotion()

  return (
    <span className="hero__line">
      <motion.span
        className={'hero__line-inner' + (accent ? ' accent' : '')}
        initial={reduce ? { opacity: 0 } : { y: '104%' }}
        animate={reduce ? { opacity: 1 } : { y: '0%' }}
        transition={{
          duration: reduce ? 0.3 : 1.05,
          delay: reduce ? 0 : 0.18 + index * 0.09,
          ease: EASE,
        }}
      >
        {text}
      </motion.span>
    </span>
  )
}

const fmt = (n: number) => n.toLocaleString('en-US')

export function Hero({
  onViewTracker,
  onExplore,
}: {
  onViewTracker: () => void
  onExplore: () => void
}) {
  const reduce = useReducedMotion()
  const { metrics, breakdown, catalogLive, sourceLabel } = useLanding()

  const fade = (delay: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 16 },
    animate: reduce ? { opacity: 1 } : { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0.3 : 0.9, delay: reduce ? 0 : delay, ease: EASE },
  })

  return (
    <Section id="hero" className="hero">
      <div className="shell hero__shell">
        <div className="hero__copy">
          <motion.div {...fade(0.05)}>
            <Eyebrow>SPACE SITUATIONAL AWARENESS</Eyebrow>
          </motion.div>

          <h1 className="h-display hero__headline">
            {LINES.map((line, i) => (
              <HeadlineLine key={line} text={line} index={i} accent={i === 2} />
            ))}
          </h1>

          <motion.p className="lede hero__lede" {...fade(0.55)}>
            KAKSHA is a space situational awareness platform that propagates the tracked
            catalogue, screens it for close approaches, and resolves the geometry of every
            encounter it finds — so operators see what is happening above them before it
            matters.
          </motion.p>

          <motion.div className="hero__actions" {...fade(0.68)}>
            <button className="kx-btn kx-btn--primary" onClick={onExplore}>
              EXPLORE KAKSHA
              <ArrowRight />
            </button>
            <button className="kx-btn kx-btn--ghost" onClick={onViewTracker}>
              VIEW LIVE TRACKER
            </button>
          </motion.div>

          <motion.div className="hero__metrics" {...fade(0.82)}>
            <div className="hero__metrics-head">
              <Eyebrow className="hero__metrics-eyebrow">LIVE SPACE ENVIRONMENT</Eyebrow>
              <ProvenanceTag live={catalogLive} liveLabel="LIVE FEED" />
            </div>

            <div className="metric-row">
              {metrics.map((m, i) => (
                <motion.div
                  key={m.id}
                  className="metric kx-panel kx-panel--ticked"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: reduce ? 0.3 : 0.7,
                    delay: reduce ? 0 : 0.9 + i * 0.08,
                    ease: EASE,
                  }}
                >
                  <span className="metric__value readout">{m.value}</span>
                  <span className="metric__label">{m.label}</span>
                  <span className="metric__sub kx-label">{m.sub}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Catalogue breakdown, sitting alongside the globe. */}
        <motion.aside className="hero__catalog" {...fade(1.0)}>
          <div className="hero__catalog-head">
            <span className="kx-label">CATALOGUE BREAKDOWN</span>
            <ProvenanceTag live={catalogLive} liveLabel="LIVE" />
          </div>
          <ul className="catalog-list">
            {breakdown.map((row) => (
              <li key={row.id} className="catalog-row">
                <span className="catalog-row__label kx-label">{row.label}</span>
                <span className="catalog-row__value readout" style={{ color: row.color }}>
                  {fmt(row.count)}
                </span>
                <span className="catalog-row__bar" aria-hidden="true">
                  <span
                    className="catalog-row__bar-fill"
                    style={{
                      width: (row.count / breakdown[0].count) * 100 + '%',
                      background: row.color,
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
          <p className="hero__catalog-foot kx-label">{sourceLabel}</p>
        </motion.aside>
      </div>

      <motion.div className="hero__foot" {...fade(1.15)}>
        <p className="hero__tagline kx-label">SCANNING THE ORBITS. PROTECTING THE FUTURE.</p>
        <button
          className="hero__scroll"
          onClick={onExplore}
          aria-label="Scroll to the orbital environment"
        >
          <span className="hero__scroll-ring">
            <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
              <path d="M6 0v12M1.5 7.5 6 12l4.5-4.5" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </span>
        </button>
      </motion.div>
    </Section>
  )
}

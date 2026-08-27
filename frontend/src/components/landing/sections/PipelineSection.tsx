import { Fragment, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react'
import { pipelineStages } from '../data/landingContent'
import { Eyebrow, Reveal, Section } from './primitives'

/* ============================================================================
   ANALYTICAL PIPELINE (spec 16)
   Nodes appear in order as the section enters, the connectors illuminate behind
   them, and the active stage walks the chain so the sequence reads as a flow
   rather than a row of cards.
   ========================================================================== */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

function Glyph({ name }: { name: string }) {
  const common = { width: 22, height: 22, viewBox: '0 0 22 22', fill: 'none', 'aria-hidden': true } as const
  const s = { stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

  switch (name) {
    case 'ingest':
      return (
        <svg {...common}>
          <path d="M4.5 2.5h9l4 4v13h-13z" {...s} />
          <path d="M13 2.5v4.5h4.5M7.5 11h7M7.5 14.5h7M7.5 17.5h4" {...s} />
        </svg>
      )
    case 'propagate':
      return (
        <svg {...common}>
          <ellipse cx="11" cy="11" rx="8.5" ry="4" {...s} transform="rotate(-24 11 11)" />
          <circle cx="11" cy="11" r="3" {...s} />
          <circle cx="18" cy="7.4" r="1.6" fill="currentColor" />
        </svg>
      )
    case 'state':
      return (
        <svg {...common}>
          <path d="M3 19 19 3M19 3h-5.5M19 3v5.5" {...s} />
          <circle cx="3" cy="19" r="2" {...s} />
          <path d="M3 11h5M11 19v-5" {...s} opacity="0.5" />
        </svg>
      )
    case 'screen':
      return (
        <svg {...common}>
          <path d="M2.5 3.5h17l-6.5 7.5v7l-4 2v-9z" {...s} />
          <path d="M6.5 7.5h9" {...s} opacity="0.45" />
        </svg>
      )
    case 'tca':
      return (
        <svg {...common}>
          <path d="M2 5c5 0 8 8 18 11" {...s} />
          <path d="M2 17c5 0 8-8 18-11" {...s} opacity="0.6" />
          <circle cx="11" cy="11" r="2.6" fill="currentColor" />
        </svg>
      )
    case 'bplane':
      return (
        <svg {...common}>
          <path d="M2 14.5 9 9.5l11 2-7 5z" {...s} />
          <path d="M11 11 11 2.5M11 11l7.5 4.5" {...s} opacity="0.55" />
          <circle cx="11" cy="11" r="1.7" fill="currentColor" />
        </svg>
      )
    case 'uncertainty':
      return (
        <svg {...common}>
          <ellipse cx="11" cy="11" rx="9" ry="5.5" {...s} transform="rotate(-27 11 11)" />
          <ellipse cx="11" cy="11" rx="4.6" ry="2.8" {...s} opacity="0.5" transform="rotate(-27 11 11)" />
          <circle cx="11" cy="11" r="1.5" fill="currentColor" />
        </svg>
      )
    case 'risk':
    default:
      return (
        <svg {...common}>
          <path d="M3 18.5h4v-6H3zM9 18.5h4v-10H9zM15 18.5h4V4h-4z" {...s} />
        </svg>
      )
  }
}

export function PipelineSection() {
  const rowRef = useRef(null)
  const inView = useInView(rowRef, { once: false, margin: '-25% 0px -25% 0px' })
  const reduce = useReducedMotion()

  const [active, setActive] = useState(0)
  const [pinned, setPinned] = useState(false)

  /* The active stage walks the chain while the section is on screen. */
  useEffect(() => {
    if (!inView || pinned || reduce) return
    const id = setInterval(() => setActive((i) => (i + 1) % pipelineStages.length), 2000)
    return () => clearInterval(id)
  }, [inView, pinned, reduce])

  const stage = pipelineStages[active]

  return (
    <Section id="pipeline" className="pipeline">
      <div className="shell">
        <div className="pipeline__head">
          <div>
            <Reveal>
              <Eyebrow>OUR SCIENCE. YOUR SAFETY.</Eyebrow>
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="h-section">End-to-end analytical pipeline</h2>
            </Reveal>
          </div>
          <Reveal delay={0.12}>
            <p className="lede pipeline__lede">
              Every conclusion KAKSHA reaches is traceable back through the same eight
              stages. Nothing is inferred, and nothing skips a step.
            </p>
          </Reveal>
        </div>

        <motion.div
          ref={rowRef}
          className="pipeline__row"
          initial="hidden"
          whileInView="shown"
          viewport={{ once: true, margin: '-15% 0px -15% 0px' }}
          variants={{
            hidden: {},
            shown: { transition: { staggerChildren: reduce ? 0 : 0.11, delayChildren: 0.1 } },
          }}
        >
          {pipelineStages.map((s, i) => (
            <Fragment key={s.id}>
              {i > 0 && (
                <motion.span
                  className="pipeline__link"
                  aria-hidden="true"
                  variants={{
                    hidden: reduce ? { opacity: 0 } : { scaleX: 0, opacity: 0.2 },
                    shown: reduce ? { opacity: 1 } : { scaleX: 1, opacity: 1 },
                  }}
                  transition={{ duration: reduce ? 0.2 : 0.5, ease: EASE }}
                >
                  <span className="pipeline__link-arrow" />
                </motion.span>
              )}

              <motion.button
                type="button"
                className={'pipeline__node' + (active === i ? ' is-active' : '')}
                onClick={() => {
                  setActive(i)
                  setPinned(true)
                }}
                onMouseEnter={() => {
                  setActive(i)
                  setPinned(true)
                }}
                aria-pressed={active === i}
                variants={{
                  hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 18 },
                  shown: reduce ? { opacity: 1 } : { opacity: 1, y: 0 },
                }}
                transition={{ duration: reduce ? 0.25 : 0.6, ease: EASE }}
              >
                <span className="pipeline__node-index kx-label">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="pipeline__node-icon">
                  <Glyph name={s.glyph} />
                </span>
                <span className="pipeline__node-title">{s.title}</span>
                <span className="pipeline__node-sub kx-label">{s.subtitle}</span>
              </motion.button>
            </Fragment>
          ))}
        </motion.div>

        <div className="pipeline__detail">
          <span className="pipeline__detail-rule" aria-hidden="true" />
          <AnimatePresence mode="wait">
            <motion.p
              key={stage.id}
              className="pipeline__detail-text"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: reduce ? 0.15 : 0.36, ease: EASE }}
            >
              <span className="pipeline__detail-stage">{stage.title}</span>
              {stage.detail}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </Section>
  )
}

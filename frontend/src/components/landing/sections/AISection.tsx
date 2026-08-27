import { Fragment, useMemo } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { aiChain, aiDisclaimers, buildExplanation, formatTca } from '../data/landingContent'
import { useLanding } from '../data/LandingDataContext'
import { Eyebrow, ProvenanceTag, Reveal, Section } from './primitives'

/* ============================================================================
   AI EXPLANATION (spec 18)
   The section is built around one claim: the numerical engine is the authority
   and the model is downstream of it. The chain runs left to right, the engine
   node is the emphasised one, and the panel shows exactly which validated
   values the model was handed before it wrote a word.

   Note what the explanation never contains: a collision probability. KAKSHA
   derives that in the engine; a language layer must not assert one.
   ========================================================================== */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

/** Values quoted from the engine get marked, so the reader can see what is cited. */
const CITED = /(HIGH|\d+\.\d+ km\/s|\d+\.\d+ km|\d+\.\d+ degrees|\d+h \d+m)/g

function tokenize(text: string) {
  const out = []
  let last = 0
  for (const m of text.matchAll(CITED)) {
    const pre = text.slice(last, m.index)
    for (const w of pre.split(/(\s+)/)) if (w) out.push({ t: w, cited: false })
    out.push({ t: m[0], cited: true })
    last = m.index + m[0].length
  }
  for (const w of text.slice(last).split(/(\s+)/)) if (w) out.push({ t: w, cited: false })
  return out
}

function ChainNode({
  node,
  index,
  emphasis,
}: {
  node: { label: string; note: string }
  index: number
  emphasis: string | null
}) {
  return (
    <div className={'chain__node' + (emphasis ? ' chain__node--' + emphasis : '')}>
      <span className="chain__index kx-label">{String(index + 1).padStart(2, '0')}</span>
      <span className="chain__label">{node.label}</span>
      <span className="chain__note kx-label">{node.note}</span>
    </div>
  )
}

export function AISection() {
  const reduce = useReducedMotion()
  const { conjunction, conjunctionLive } = useLanding()

  // Composed from the engine's own figures. A fixed paragraph beside live
  // numbers would contradict the very claim this section makes.
  const body = useMemo(() => buildExplanation(conjunction), [conjunction])
  const tokens = useMemo(() => tokenize(body), [body])

  const inputs = useMemo(
    () => [
      { label: 'MISS DISTANCE', value: conjunction.missDistanceKm.toFixed(3) + ' km' },
      { label: 'SCREENING THRESHOLD', value: conjunction.screeningThresholdKm.toFixed(3) + ' km' },
      { label: 'RELATIVE VELOCITY', value: conjunction.relativeVelocityKmS.toFixed(3) + ' km/s' },
      { label: 'TIME TO TCA', value: formatTca(conjunction.timeToTcaSeconds) },
    ],
    [conjunction],
  )

  const emphasisFor = (id: string): string | null => {
    if (id === 'engine' || id === 'validated') return 'authority'
    if (id === 'ai') return 'model'
    return null
  }

  return (
    <Section id="ai" className="ai">
      <div className="shell">
        <div className="ai__head">
          <Reveal>
            <Eyebrow>AI INTERPRETATION</Eyebrow>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="h-display ai__title">
              Physics calculates.
              <br />
              <span className="accent">AI explains.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="lede ai__lede">
              The language model never touches the numbers. It receives a result the engine
              has already produced and validated, and turns it into something an operator
              can read at a glance.
            </p>
          </Reveal>
        </div>

        {/* --------------------------- the chain --------------------------- */}
        <motion.div
          className="chain"
          initial="hidden"
          whileInView="shown"
          viewport={{ once: true, margin: '-12% 0px -12% 0px' }}
          variants={{
            hidden: {},
            shown: { transition: { staggerChildren: reduce ? 0 : 0.12, delayChildren: 0.08 } },
          }}
        >
          {aiChain.map((node, i) => (
            <Fragment key={node.id}>
              {i > 0 && (
                <motion.span
                  className="chain__arrow"
                  aria-hidden="true"
                  variants={{
                    hidden: reduce ? { opacity: 0 } : { opacity: 0, scaleX: 0 },
                    shown: reduce ? { opacity: 1 } : { opacity: 1, scaleX: 1 },
                  }}
                  transition={{ duration: reduce ? 0.2 : 0.45, ease: EASE }}
                />
              )}
              <motion.div
                variants={{
                  hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 14 },
                  shown: reduce ? { opacity: 1 } : { opacity: 1, y: 0 },
                }}
                transition={{ duration: reduce ? 0.25 : 0.55, ease: EASE }}
              >
                <ChainNode node={node} index={i} emphasis={emphasisFor(node.id)} />
              </motion.div>
            </Fragment>
          ))}
        </motion.div>

        <Reveal delay={0.05}>
          <p className="chain__caption kx-label">
            AUTHORITY FLOWS ONE WAY. THE ENGINE DECIDES; THE MODEL DESCRIBES.
          </p>
        </Reveal>

        {/* --------------------------- the panel --------------------------- */}
        <Reveal delay={0.1}>
          <div className="ai__panel kx-panel kx-panel--ticked">
            <div className="ai__panel-head">
              <span className="ai__panel-title">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                  <path
                    d="M7.5 0.8l1.6 4.1 4.1 1.6-4.1 1.6-1.6 4.1-1.6-4.1L1.8 6.5l4.1-1.6z"
                    fill="#22D3EE"
                    fillOpacity="0.85"
                  />
                  <path d="M12.6 10.2l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="#22D3EE" fillOpacity="0.5" />
                </svg>
                AI INTERPRETATION
              </span>
              <div className="ai__panel-badges">
                <span className="ai__badge">READS VALIDATED OUTPUT ONLY</span>
                <ProvenanceTag live={conjunctionLive} liveLabel="LIVE EVENT" />
              </div>
            </div>

            <div className="ai__inputs">
              <span className="ai__inputs-label kx-label">VALUES RECEIVED FROM THE ENGINE</span>
              <div className="ai__chips">
                {inputs.map((input) => (
                  <span key={input.label} className="ai__chip">
                    <span className="kx-label">{input.label}</span>
                    <span className="readout">{input.value}</span>
                  </span>
                ))}
              </div>
            </div>

            <motion.p
              className="ai__body"
              initial="hidden"
              whileInView="shown"
              viewport={{ once: true, margin: '-10% 0px -10% 0px' }}
              variants={{
                hidden: {},
                shown: { transition: { staggerChildren: reduce ? 0 : 0.011, delayChildren: 0.2 } },
              }}
            >
              {tokens.map((tok, i) =>
                /^\s+$/.test(tok.t) ? (
                  <Fragment key={i}> </Fragment>
                ) : (
                  <motion.span
                    key={i}
                    className={tok.cited ? 'ai__cited' : undefined}
                    variants={{
                      hidden: { opacity: 0 },
                      shown: { opacity: 1 },
                    }}
                    transition={{ duration: reduce ? 0.12 : 0.3, ease: 'linear' }}
                  >
                    {tok.t}
                  </motion.span>
                )
              )}
            </motion.p>

            <ul className="ai__disclaimers">
              {aiDisclaimers.map((d) => (
                <li key={d}>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                    <path d="M6.5 1 11.5 3v3.6c0 3-2.1 5.2-5 5.9-2.9-.7-5-2.9-5-5.9V3z" stroke="currentColor" strokeWidth="1.1" />
                    <path d="M4.4 6.6 5.9 8.1 8.8 5" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                  <span>{d}</span>
                </li>
              ))}
              <li className="ai__disclaimers--strong">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                  <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.1" />
                  <path d="M6.5 3.4v3.8M6.5 9.2v.7" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                <span>
                  No collision probability is stated here. KAKSHA derives{' '}
                  <span className="nowrap">
                    P<sub>c</sub>
                  </span>{' '}
                  in the numerical engine, and the model is not permitted to assert one.
                </span>
              </li>
            </ul>

            <div className="ai__foot">
              <span className="kx-label">
                EVENT {conjunction.id} &nbsp;&middot;&nbsp; NARRATION COMPOSED FROM THE FIGURES ABOVE
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  )
}

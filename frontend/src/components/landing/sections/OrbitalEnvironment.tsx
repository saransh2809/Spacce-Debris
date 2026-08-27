import { orbitalPopulation, orbitalRegimes } from '../data/landingContent'
import { Eyebrow, Reveal, Section, Stagger, StaggerItem } from './primitives'

/* ============================================================================
   THE ORBITAL ENVIRONMENT (spec 13)
   The wide orbital view itself is on the WebGL stage; this section supplies the
   framing copy and the semantic legend that makes the colours readable.
   ========================================================================== */

export function OrbitalEnvironment() {
  return (
    <Section id="mission" className="orbital">
      <div className="shell orbital__top">
        <div className="orbital__copy">
          <Reveal>
            <Eyebrow>THE ORBITAL ENVIRONMENT</Eyebrow>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="h-section orbital__title">
              A complex.
              <br />
              Crowded.
              <br />
              <span className="accent">Dynamic space.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="lede orbital__lede">
              Tens of thousands of tracked objects cross the same volume at eight kilometres
              per second. Their orbits precess, decay and drift. KAKSHA keeps that whole
              environment propagated and continuously re-screened, so the picture stays
              current rather than becoming a snapshot.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.16} className="orbital__legend-wrap">
          <div className="orbital__legend">
            <div className="orbital__legend-head">
              <span className="kx-label">OBJECT CLASSES</span>
            </div>
            <ul className="legend">
              {orbitalPopulation.map((item) => (
                <li key={item.id} className="legend__item">
                  <span className="legend__dot" style={{ background: item.color }} />
                  <span className="legend__label">{item.label}</span>
                  <span className="legend__regime kx-label">{item.regime}</span>
                </li>
              ))}
            </ul>
            <p className="orbital__legend-note kx-label">
              POINT DENSITY IS STYLISED FOR PRESENTATION
            </p>
          </div>
        </Reveal>
      </div>

      <div className="shell orbital__bottom">
        <Stagger className="regime-row">
          {orbitalRegimes.map((r) => (
            <StaggerItem key={r.id} className="regime">
              <span className="regime__name">{r.name}</span>
              <span className="regime__range readout">{r.altitude}</span>
              <span className="regime__bar" aria-hidden="true">
                <span className="regime__bar-fill" style={{ width: r.densityShare * 100 + '%' }} />
              </span>
              <span className="regime__note kx-label">{r.note}</span>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </Section>
  )
}

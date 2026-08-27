/**
 * KAKSHA -- closing call to action.
 *
 * The Earth limb behind this section is the same globe the page opened on; the
 * camera has simply travelled down to the horizon.
 */
import { ArrowRight, Reveal, Section } from "./primitives";

export function FinalCTA({ onEnterMissionControl }: { onEnterMissionControl: () => void }) {
  return (
    <Section id="cta" className="cta">
      <div className="shell cta__inner">
        <Reveal>
          <h2 className="h-display cta__title">
            Ready to take control
            <br />
            <span className="accent">of the orbits?</span>
          </h2>
        </Reveal>

        <Reveal delay={0.08}>
          <p className="lede cta__lede">
            Enter KAKSHA Mission Control and work the live operational picture &mdash;
            catalogue, screening window, encounter geometry and risk ranking in one place.
          </p>
        </Reveal>

        <Reveal delay={0.16}>
          <div className="cta__action">
            <button className="kx-btn kx-btn--primary cta__btn" onClick={onEnterMissionControl}>
              ENTER MISSION CONTROL
              <ArrowRight />
            </button>
          </div>
        </Reveal>

        <Reveal delay={0.24}>
          <p className="cta__foot kx-label">
            REAL-TIME DATA &nbsp;&middot;&nbsp; ADVANCED ANALYTICS &nbsp;&middot;&nbsp; SMARTER
            DECISIONS
          </p>
        </Reveal>
      </div>
    </Section>
  );
}

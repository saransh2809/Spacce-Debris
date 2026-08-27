import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { navSections } from '../data/landingContent'
import { scene, subscribeSection } from '../lib/sceneStore'
import { SECTION_IDS } from '../lib/choreography'
import { ArrowRight, scrollToSection } from './primitives'

/* ============================================================================
   NAVIGATION (spec 20)
   Minimal, monospaced, and anchored only to prototype sections. Nothing here
   routes into the real KAKSHA application.
   ========================================================================== */

function Reticle() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <circle cx="13" cy="13" r="10.2" stroke="#22D3EE" strokeWidth="1" opacity="0.85" />
      <circle cx="13" cy="13" r="4.4" stroke="#22D3EE" strokeWidth="0.9" opacity="0.6" />
      <circle cx="13" cy="13" r="1.7" fill="#22D3EE" />
      <path d="M13 0.6v4.2M13 21.2v4.2M0.6 13h4.2M21.2 13h4.2" stroke="#22D3EE" strokeWidth="1" opacity="0.75" />
      <ellipse
        cx="13"
        cy="13"
        rx="12.4"
        ry="5"
        stroke="#14B8A6"
        strokeWidth="0.8"
        opacity="0.5"
        transform="rotate(-28 13 13)"
      />
    </svg>
  )
}

export function Nav({ onEnterMissionControl }: { onEnterMissionControl: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const progressRef = useRef<HTMLSpanElement>(null)

  useEffect(() => subscribeSection((i) => setActive(i < 0 ? 0 : i)), [])

  useEffect(() => {
    let frame = 0
    const tick = () => {
      // Written straight to the DOM: a progress bar must not cost a render.
      if (progressRef.current) {
        progressRef.current.style.transform = 'scaleX(' + scene.progress.toFixed(4) + ')'
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const go = (id: string) => {
    setMenuOpen(false)
    scrollToSection(id)
  }

  const activeId = SECTION_IDS[active] || 'hero'

  return (
    <>
      <header className={'nav' + (scrolled ? ' nav--scrolled' : '')}>
        <div className="nav__inner">
          <a
            className="brand"
            href="#hero"
            onClick={(e) => {
              e.preventDefault()
              go('hero')
            }}
          >
            <Reticle />
            <span className="brand__text">
              <span className="brand__name">KAKSHA</span>
              <span className="brand__tag">SPACE SITUATIONAL AWARENESS</span>
            </span>
          </a>

          <nav className="nav__links" aria-label="Prototype sections">
            {navSections.map((s) => (
              <button
                key={s.id}
                className={'nav__link' + (activeId === s.id ? ' is-active' : '')}
                onClick={() => go(s.id)}
                aria-current={activeId === s.id ? 'true' : undefined}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="nav__right">
            <button className="kx-btn nav__cta" onClick={onEnterMissionControl}>
              ENTER MISSION CONTROL
              <ArrowRight />
            </button>
            <button
              className="nav__burger"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              <span className={'nav__burger-bar' + (menuOpen ? ' is-x1' : '')} />
              <span className={'nav__burger-bar' + (menuOpen ? ' is-x2' : '')} />
            </button>
          </div>
        </div>

        <div className="nav__progress" aria-hidden="true">
          <span ref={progressRef} className="nav__progress-fill" />
        </div>
      </header>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="nav__sheet"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            {navSections.map((s) => (
              <button
                key={s.id}
                className={'nav__sheet-link' + (activeId === s.id ? ' is-active' : '')}
                onClick={() => go(s.id)}
              >
                <span className="kx-label">{String(navSections.indexOf(s) + 1).padStart(2, '0')}</span>
                {s.label}
              </button>
            ))}
            <button
              className="kx-btn kx-btn--primary nav__sheet-cta"
              onClick={() => {
                setMenuOpen(false)
                onEnterMissionControl()
              }}
            >
              ENTER MISSION CONTROL
              <ArrowRight />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

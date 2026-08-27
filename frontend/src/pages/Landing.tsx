/**
 * KAKSHA -- landing page.
 *
 * The public front door. Everything else in this application is an operations
 * console behind a boot gate that waits on the numerical engine; this page is
 * not, and must not be. It renders completely with the backend switched off,
 * because a visitor arriving at the root URL should never meet a spinner or a
 * "backend unreachable" panel.
 *
 * Where it DOES have live data it uses it: catalogue size and composition, the
 * screening window, and the closest conjunction in that window all come from
 * the same queries the console uses. `useLandingData` handles the fallback, so
 * nothing downstream needs a loading branch.
 *
 * SCROLL MODEL
 * ------------
 * The application shell locks the viewport (`body { overflow: hidden }`, a
 * 100vh flex column) because every console page scrolls internally. A landing
 * page scrolls the document instead, and the 3D choreography is driven by
 * window.scrollY. The `kx-landing-active` class on <html> restores document
 * scrolling for exactly as long as this page is mounted; landing.css holds the
 * rules and the effect below removes it on unmount.
 */
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AISection } from "../components/landing/sections/AISection";
import { BPlaneSection } from "../components/landing/sections/BPlaneSection";
import { ConjunctionSection } from "../components/landing/sections/ConjunctionSection";
import { FinalCTA } from "../components/landing/sections/FinalCTA";
import { Footer } from "../components/landing/sections/Footer";
import { Hero } from "../components/landing/sections/Hero";
import { Nav } from "../components/landing/sections/Nav";
import { OrbitalEnvironment } from "../components/landing/sections/OrbitalEnvironment";
import { PipelineSection } from "../components/landing/sections/PipelineSection";
import { scrollToSection } from "../components/landing/sections/primitives";
import { Stage } from "../components/landing/three/Stage";
import { LandingDataProvider } from "../components/landing/data/LandingDataContext";
import { bindScene, measure } from "../components/landing/lib/sceneStore";
import "../components/landing/landing.css";

interface Notice {
  id: number;
  title: string;
  body: string;
}

export function Landing() {
  const navigate = useNavigate();
  const [notice, setNotice] = useState<Notice | null>(null);

  /* ---- restore document scrolling while this page is mounted ---- */
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("kx-landing-active");
    // The console leaves the viewport wherever the last page had it.
    window.scrollTo(0, 0);
    return () => html.classList.remove("kx-landing-active");
  }, []);

  /* ---- scroll/pointer bindings for the 3D choreography ---- */
  useEffect(() => {
    const unbind = bindScene();
    // Measure after layout has settled, so section anchors are real.
    const id = window.setTimeout(() => measure(), 0);
    return () => {
      window.clearTimeout(id);
      unbind();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const notify = useCallback((title: string, body: string) => {
    setNotice({ id: Date.now(), title, body });
  }, []);

  const enterMissionControl = useCallback(() => navigate("/dashboard"), [navigate]);
  const viewTracker = useCallback(() => navigate("/tracker"), [navigate]);

  return (
    <LandingDataProvider>
      <div className="kx-landing">
        <Stage
          onFail={() =>
            notify(
              "3D VIEW UNAVAILABLE",
              "WebGL could not start on this device. The page has fallen back to a static backdrop; everything on it remains readable.",
            )
          }
        />
        <div className="vignette" aria-hidden="true" />

        <div className="content">
          <Nav onEnterMissionControl={enterMissionControl} />

          <main>
            <Hero onViewTracker={viewTracker} onExplore={() => scrollToSection("mission")} />
            <div className="rule" />
            <OrbitalEnvironment />
            <div className="rule" />
            <ConjunctionSection />
            <div className="rule" />
            <PipelineSection />
            <div className="rule" />
            <BPlaneSection />
            <div className="rule" />
            <AISection />
            <FinalCTA onEnterMissionControl={enterMissionControl} />
          </main>

          <Footer
            onNavigate={(id) => {
              if (id === "dashboard") enterMissionControl();
              else if (id === "tracker") viewTracker();
              else navigate(id);
            }}
          />
        </div>

        <AnimatePresence>
          {notice && (
            <motion.div
              key={notice.id}
              className="toast kx-panel kx-panel--ticked"
              role="status"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="toast__title">{notice.title}</span>
              <p className="toast__body">{notice.body}</p>
              <button
                className="toast__close"
                onClick={() => setNotice(null)}
                aria-label="Dismiss"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LandingDataProvider>
  );
}

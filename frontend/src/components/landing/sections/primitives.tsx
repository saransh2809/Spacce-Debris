/**
 * KAKSHA -- landing page primitives.
 *
 * The small shared pieces every section is built from: the section wrapper that
 * registers itself with the scene director, the scroll-reveal helpers, and the
 * typographic atoms.
 */
import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { registerSection } from "../lib/sceneStore";

/** Shared easing. Typed as a tuple: motion rejects a widened number[]. */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * A narrative section.
 *
 * Registering the element lets the scene director measure where it actually
 * sits in the document, which is what drives the camera keyframes -- so the 3D
 * choreography follows the real layout rather than assumed heights.
 */
export function Section({
  id,
  className = "",
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    registerSection(id, ref.current);
    return () => registerSection(id, null);
  }, [id]);

  return (
    <section id={id} ref={ref} className={`section ${className}`}>
      {children}
    </section>
  );
}

/** Scroll-triggered reveal. Collapses to a plain fade under reduced motion. */
export function Reveal({
  children,
  delay = 0,
  y = 20,
  className = "",
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once, margin: "-10% 0px -10% 0px" }}
      transition={{
        duration: reduce ? 0.28 : 0.8,
        delay: reduce ? 0 : delay,
        ease: EASE,
      }}
    >
      {children}
    </motion.div>
  );
}

/** Reveals children in sequence -- used for metric rows and pipeline nodes. */
export function Stagger({
  children,
  className = "",
  step = 0.075,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  step?: number;
  delay?: number;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: "-8% 0px -8% 0px" }}
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: reduce ? 0 : step, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className = "",
  y = 16,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      variants={{
        hidden: reduce ? { opacity: 0 } : { opacity: 0, y },
        shown: reduce ? { opacity: 1 } : { opacity: 1, y: 0 },
      }}
      transition={{ duration: reduce ? 0.25 : 0.7, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Provenance marker.
 *
 * The landing page shows engine results where it can and representative
 * figures where it cannot. This says which, in place, rather than leaving the
 * reader to guess.
 */
export function ProvenanceTag({
  live,
  liveLabel = "LIVE",
  fallbackLabel = "REPRESENTATIVE",
  className = "",
}: {
  live: boolean;
  liveLabel?: string;
  fallbackLabel?: string;
  className?: string;
}) {
  return (
    <span className={`provenance ${live ? "is-live" : ""} ${className}`}>
      <span className="provenance__dot" />
      {live ? liveLabel : fallbackLabel}
    </span>
  );
}

export function Eyebrow({
  children,
  dim = false,
  bare = false,
  className = "",
}: {
  children: ReactNode;
  dim?: boolean;
  bare?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`eyebrow${dim ? " eyebrow--dim" : ""}${bare ? " eyebrow--bare" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

export function ArrowRight({ className = "kx-btn__arrow" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="10"
      viewBox="0 0 14 10"
      fill="none"
      aria-hidden="true"
    >
      <path d="M0 5h12M8.5 1.5 12 5l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** Smooth in-page navigation that respects the reduced-motion preference. */
export function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

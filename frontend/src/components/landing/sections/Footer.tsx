/**
 * KAKSHA -- landing page footer.
 *
 * The link row goes to real destinations inside the console. A footer full of
 * links that look live but go nowhere is worse than a short one that works, so
 * this lists only routes that exist.
 */
import { useLanding } from "../data/LandingDataContext";

const LINKS: { id: string; label: string }[] = [
  { id: "dashboard", label: "MISSION CONTROL" },
  { id: "tracker", label: "TRACKER" },
  { id: "/conjunctions", label: "CONJUNCTIONS" },
  { id: "/calculations", label: "CALCULATIONS" },
  { id: "/validation", label: "VALIDATION" },
];

export function Footer({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { sourceLabel } = useLanding();
  const year = new Date().getUTCFullYear();

  return (
    <footer className="footer">
      <div className="rule" />
      <div className="shell footer__inner">
        <div className="footer__brand">
          <span className="footer__name">KAKSHA</span>
          <span className="kx-label">SPACE SITUATIONAL AWARENESS PLATFORM</span>
        </div>

        <nav className="footer__links" aria-label="Console sections">
          {LINKS.map((l) => (
            <button key={l.id} className="footer__link" onClick={() => onNavigate(l.id)}>
              {l.label}
            </button>
          ))}
        </nav>

        <div className="footer__meta">
          <span className="kx-label">{sourceLabel}</span>
          <span className="kx-label">
            &copy; {year} KAKSHA &middot; POSITIONS ARE PROPAGATED, NOT OBSERVED
          </span>
        </div>
      </div>
    </footer>
  );
}

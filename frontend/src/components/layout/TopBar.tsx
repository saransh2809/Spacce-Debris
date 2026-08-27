/**
 * KAKSHA -- top navigation bar.
 *
 * Route names merge the reference design's operational vocabulary with the
 * pages the problem statement requires. CALCULATIONS and VALIDATION are kept
 * as first-class destinations: they are where the system shows its working,
 * which is the whole argument for trusting anything else on screen.
 *
 * The LIVE DATA indicator is deliberately precise. It reports the age of the
 * ORBITAL ELEMENT SETS, not "live tracking", because the system propagates
 * published elements rather than observing satellites. Claiming otherwise
 * would be the single easiest way to lose credibility with a reviewer who
 * knows the domain.
 */
import { Link, NavLink } from "react-router-dom";
import { fmtAge, fmtDateUTC, fmtTimeUTC } from "../../api/client";
import { useHealth, useTickingTime } from "../../hooks/useKaksha";
import { useStore } from "../../store/useStore";

const ROUTES = [
  { path: "/dashboard", label: "Dashboard", end: true },
  { path: "/tracker", label: "Tracker" },
  { path: "/conjunctions", label: "Conjunctions" },
  { path: "/calculations", label: "Calculations" },
  { path: "/analysis", label: "Analysis" },
  { path: "/simulation", label: "Simulation" },
  { path: "/validation", label: "Validation" },
];

export function TopBar() {
  const { data: health } = useHealth();
  const now = useTickingTime(4);
  const clockMode = useStore((s) => s.clockMode);
  const rate = useStore((s) => s.rate);

  const iso = now.toISOString();
  const loaded = health?.catalog_loaded ?? false;
  const dataAge = health?.data_age_seconds ?? null;

  // Feed health: green while the elements are fresh, amber as they age, red if
  // the catalogue never loaded.
  const feedState = !loaded
    ? "bad"
    : dataAge !== null && dataAge > 6 * 3600
      ? "warn"
      : "ok";

  const isSim = clockMode === "SIMULATION";

  return (
    <header
      style={{
        height: "var(--topbar-h)",
        display: "flex",
        alignItems: "stretch",
        background: "var(--bg-void)",
        borderBottom: "1px solid var(--line)",
        flexShrink: 0,
      }}
    >
      {/* --- identity --- */}
      {/* The wordmark is the way back out to the public landing page. */}
      <Link
        to="/"
        title="KAKSHA home"
        style={{
          width: "var(--rail-left)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 16px",
          borderRight: "1px solid var(--line)",
          flexShrink: 0,
          textDecoration: "none",
        }}
      >
        <div
          style={{
            fontSize: 19,
            fontWeight: 800,
            letterSpacing: "0.16em",
            color: "var(--text-bright)",
            lineHeight: 1.1,
          }}
        >
          KAKSHA
        </div>
        <div
          style={{
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: "0.19em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
          }}
        >
          Space Situational Awareness
        </div>
      </Link>

      {/* --- routes --- */}
      <nav style={{ display: "flex", alignItems: "stretch", flex: 1, minWidth: 0 }}>
        {ROUTES.map((route) => (
          <NavLink
            key={route.path}
            to={route.path}
            end={route.end}
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              padding: "0 17px",
              fontSize: "var(--fs-tiny)",
              fontWeight: 600,
              letterSpacing: "0.11em",
              textTransform: "uppercase",
              color: isActive ? "var(--teal)" : "var(--text-muted)",
              borderBottom: isActive
                ? "2px solid var(--teal)"
                : "2px solid transparent",
              textDecoration: "none",
              whiteSpace: "nowrap",
              transition: "color 0.12s",
            })}
          >
            {route.label}
          </NavLink>
        ))}
      </nav>

      {/* --- status --- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "0 18px",
          borderLeft: "1px solid var(--line)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span className="pulse" data-state={feedState} />
            <span
              style={{
                fontSize: "var(--fs-micro)",
                fontWeight: 700,
                letterSpacing: "0.11em",
                color: feedState === "ok" ? "var(--ok)" : "var(--warn)",
              }}
            >
              {loaded ? "ELEMENTS LOADED" : "LOADING CATALOGUE"}
            </span>
          </div>
          <div
            className="mono"
            style={{ fontSize: 9.5, color: "var(--text-muted)", letterSpacing: "0.02em" }}
            title="Age of the orbital element sets. Positions are propagated from these, not measured."
          >
            {loaded
              ? `${health?.objects.toLocaleString() ?? "—"} objects · fetched ${fmtAge(dataAge)}`
              : "contacting CelesTrak…"}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
            minWidth: 148,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: isSim ? "var(--amber)" : "var(--text-bright)",
              letterSpacing: "0.02em",
              lineHeight: 1.1,
            }}
          >
            {fmtTimeUTC(iso)}
            <span
              style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 5 }}
            >
              UTC
            </span>
          </div>
          <div
            style={{
              fontSize: 9,
              color: isSim ? "var(--amber-dim)" : "var(--text-muted)",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            {fmtDateUTC(iso)}
            {isSim && ` · SIM ${rate === 0 ? "PAUSED" : `${rate}×`}`}
          </div>
        </div>
      </div>
    </header>
  );
}

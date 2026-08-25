/**
 * KAKSHA -- boot gate.
 *
 * The backend fetches roughly eighteen thousand element sets plus the SATCAT at
 * startup, which takes tens of seconds. Rather than showing empty panels that
 * imply "no objects found", this gate states plainly what is happening.
 *
 * It also distinguishes the two failure modes that look identical from the
 * user's chair: the backend is not running, versus the backend is running but
 * the orbital data feed is unreachable. Those need different fixes and so get
 * different messages.
 */
import type { ReactNode } from "react";
import { useHealth } from "../../hooks/useKaksha";
import { ApiError } from "../../api/client";

function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        background: "var(--bg-app)",
        padding: 40,
      }}
    >
      <div style={{ maxWidth: 460, textAlign: "center" }}>{children}</div>
    </div>
  );
}

export function BootGate({ children }: { children: ReactNode }) {
  const { data, error, isLoading } = useHealth();

  if (error) {
    const api = error as ApiError;
    const unreachable = api.code === "NETWORK_UNREACHABLE";
    return (
      <Centered>
        <div style={{ fontSize: 30, marginBottom: 12, opacity: 0.5 }}>⚠</div>
        <h2
          style={{
            fontSize: "var(--fs-large)",
            fontWeight: 600,
            color: "var(--text-bright)",
            margin: "0 0 8px",
          }}
        >
          {unreachable ? "Backend unreachable" : "Backend error"}
        </h2>
        <p style={{ fontSize: "var(--fs-small)", color: "var(--text-dim)", lineHeight: 1.7 }}>
          {unreachable
            ? "The numerical engine is not responding on port 8000. Nothing can be displayed without it — this interface does not compute orbital positions of its own."
            : api.message}
        </p>
        {unreachable && (
          <pre
            className="mono"
            style={{
              marginTop: 14,
              padding: "10px 12px",
              background: "var(--bg-panel)",
              border: "1px solid var(--line)",
              borderRadius: 3,
              fontSize: 10.5,
              color: "var(--teal)",
              textAlign: "left",
              overflowX: "auto",
            }}
          >
            cd backend{"\n"}
            .venv\Scripts\python -m uvicorn app.main:app --port 8000
          </pre>
        )}
      </Centered>
    );
  }

  if (isLoading || !data) {
    return (
      <Centered>
        <div className="pulse" style={{ margin: "0 auto 14px" }} />
        <div className="label">Connecting to numerical engine</div>
      </Centered>
    );
  }

  if (!data.catalog_loaded) {
    return (
      <Centered>
        <div className="pulse" style={{ margin: "0 auto 16px" }} />
        <h2
          style={{
            fontSize: "var(--fs-large)",
            fontWeight: 600,
            color: "var(--text-bright)",
            margin: "0 0 8px",
          }}
        >
          Loading orbital catalogue
        </h2>
        <p style={{ fontSize: "var(--fs-small)", color: "var(--text-dim)", lineHeight: 1.7 }}>
          Retrieving publicly published orbital element sets from CelesTrak and
          joining them to the SATCAT for country, operator and object-type
          attribution. Each element set is checksum-verified and range-checked
          before it enters the catalogue.
        </p>
        <p className="note" style={{ marginTop: 12 }}>
          This takes roughly 30–60 seconds on a first run. Subsequent starts use
          the local cache.
        </p>
      </Centered>
    );
  }

  return <>{children}</>;
}

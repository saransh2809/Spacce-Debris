/**
 * KAKSHA -- route-level error boundary.
 *
 * WHY
 * ---
 * React unmounts the entire tree when a render throws and nothing catches it.
 * The application had no boundary at any level, so a single exception on any
 * page -- a malformed payload, an undefined field, a bad index -- replaced the
 * whole interface with an empty document. From the outside that is
 * indistinguishable from a crash, and there is no way back except a reload.
 *
 * This keeps the failure on the page that caused it. The top bar, navigation
 * and every other route stay usable, and the error is reported rather than
 * hidden: the message, the component stack and the route are all on screen,
 * because a boundary that swallows what went wrong is worse than no boundary.
 *
 * Resetting on navigation is deliberate. A page that failed once will usually
 * render fine after the user goes somewhere else and comes back, and leaving a
 * stale error in place would make a recovered app look permanently broken.
 */
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface Props {
  children: ReactNode;
  routeKey: string;
  onHome: () => void;
}

interface State {
  error: Error | null;
  stack: string;
}

class Boundary extends Component<Props, State> {
  state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({
      stack: (info.componentStack || error.stack || "")
        .split("\n")
        .slice(0, 10)
        .join("\n"),
    });
    // Keep it in the console too: the on-screen panel is for the user, the
    // console entry is for whoever has devtools open.
    console.error("[KAKSHA] route error", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // New route -> clear the previous failure.
    if (prev.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({ error: null, stack: "" });
    }
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 32,
          textAlign: "center",
          overflow: "auto",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            border: "1px solid var(--high)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--high)",
            fontSize: 19,
          }}
        >
          !
        </div>

        <div style={{ maxWidth: 480 }}>
          <div className="label" style={{ marginBottom: 8, color: "var(--high)" }}>
            This page failed to render
          </div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.62 }}>
            The rest of KAKSHA is unaffected — navigation and the other pages
            still work, and the numerical pipeline is untouched.
          </div>
        </div>

        <pre
          className="mono"
          style={{
            maxWidth: 620,
            maxHeight: 180,
            overflow: "auto",
            textAlign: "left",
            fontSize: 9.5,
            lineHeight: 1.5,
            color: "var(--text-faint)",
            background: "var(--bg-input)",
            border: "1px solid var(--line)",
            borderRadius: 3,
            padding: "9px 11px",
            whiteSpace: "pre-wrap",
            margin: 0,
          }}
        >
          {`route   ${this.props.routeKey}\nerror   ${error.message}\n\n${stack}`}
        </pre>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-accent"
            onClick={() => this.setState({ error: null, stack: "" })}
          >
            Try again
          </button>
          <button className="btn" onClick={this.props.onHome}>
            Return to dashboard
          </button>
        </div>
      </div>
    );
  }
}

export function RouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <Boundary routeKey={location.pathname} onHome={() => navigate("/dashboard")}>
      {children}
    </Boundary>
  );
}

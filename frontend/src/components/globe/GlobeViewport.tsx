/**
 * KAKSHA -- the safe boundary around the 3D globe.
 *
 * WHY THIS EXISTS
 * ---------------
 * The application had no error boundary anywhere, no WebGL capability check
 * and no context-loss handling. That combination has exactly one failure mode,
 * and it is the worst one: any exception raised anywhere inside the Canvas --
 * a texture that fails to decode, a GPU driver reset, a shader that will not
 * compile on a particular card -- propagates to the React root, unmounts the
 * ENTIRE application, and leaves a black screen with no message and no way
 * back. The dashboard survived only because it never touched WebGL.
 *
 * WebGL failure is not exotic. Integrated GPUs reset their driver under load,
 * browsers drop contexts when memory is tight, and a lost context fires an
 * event rather than throwing -- so a canvas can simply go black and stay that
 * way while the app believes everything is fine.
 *
 * This component makes the 3D subtree fail *locally* and *legibly*:
 *
 *   - capability is checked BEFORE a renderer is constructed
 *   - render-time exceptions are caught and reported, not propagated
 *   - context loss is detected, reported, and recoverable
 *   - retry fully remounts the subtree so no renderer is ever duplicated
 *
 * It is emphatically NOT an error-swallower. Nothing here hides a failure or
 * substitutes fake data: every path either shows the real scene or explains
 * precisely what went wrong and offers a way forward. The numerical pipeline
 * is untouched and keeps running regardless.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { GlobeScene } from "./GlobeScene";

/* -------------------------------------------------------------- capability */

export interface WebGLReport {
  ok: boolean;
  reason?: string;
  version?: string;
  renderer?: string;
  vendor?: string;
  maxTextureSize?: number;
  maxAttribs?: number;
  /** Software rasteriser -- works, but will be slow enough to feel broken. */
  softwareRendered?: boolean;
}

/**
 * Probe WebGL on a throwaway canvas.
 *
 * Done on a canvas we discard so the probe cannot consume the context budget
 * the real scene needs -- browsers cap simultaneous contexts, and a leaked
 * probe context is a genuine way to break the thing you were testing for.
 */
export function probeWebGL(): WebGLReport {
  if (typeof document === "undefined") return { ok: false, reason: "No DOM" };

  let canvas: HTMLCanvasElement | null = document.createElement("canvas");
  try {
    const gl = (canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;

    if (!gl) {
      return {
        ok: false,
        reason:
          "The browser could not create a WebGL context. This is usually " +
          "hardware acceleration being disabled, or a graphics driver that " +
          "the browser has blocklisted.",
      };
    }

    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    const vendor = dbg
      ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL))
      : String(gl.getParameter(gl.VENDOR));

    const report: WebGLReport = {
      ok: true,
      version: String(gl.getParameter(gl.VERSION)),
      renderer,
      vendor,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      maxAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number,
      softwareRendered: /swiftshader|llvmpipe|software|microsoft basic/i.test(renderer),
    };

    // The Earth albedo is 2048px. A device that cannot bind it will render a
    // black sphere rather than fail loudly, so refuse up front and say why.
    if ((report.maxTextureSize ?? 0) < 2048) {
      return {
        ...report,
        ok: false,
        reason: `This GPU supports textures only up to ${report.maxTextureSize}px; the Earth imagery needs 2048px.`,
      };
    }

    // Release the probe context immediately.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return report;
  } catch (err) {
    return { ok: false, reason: `WebGL probe threw: ${String(err)}` };
  } finally {
    canvas = null;
  }
}

/* ---------------------------------------------------------- error boundary */

interface BoundaryProps {
  children: ReactNode;
  onError: (message: string, stack: string) => void;
}

/**
 * Catches render-phase exceptions from the 3D subtree.
 *
 * React unmounts the whole tree on an uncaught render error, so without this
 * a single bad frame takes the entire application with it. This is the only
 * thing standing between a shader compile failure and a blank browser tab.
 */
class GlobeErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError(
      error.message || String(error),
      (info.componentStack || error.stack || "").split("\n").slice(0, 8).join("\n"),
    );
  }

  render() {
    // The fallback UI is rendered by the parent, which owns the diagnostics.
    return this.state.failed ? null : this.props.children;
  }
}

/* ------------------------------------------------------------- fallback UI */

type Stage =
  | "IDLE"
  | "PROBING"
  | "READY"
  | "UNSUPPORTED"
  | "CONTEXT_LOST"
  | "CRASHED";

function FailurePanel({
  title,
  detail,
  diagnostic,
  onRetry,
  onDismiss,
}: {
  title: string;
  detail: string;
  diagnostic?: string;
  onRetry: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 30,
        textAlign: "center",
        overflow: "auto",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "1px solid var(--amber)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--amber)",
          fontSize: 19,
        }}
      >
        !
      </div>

      <div style={{ maxWidth: 460 }}>
        <div className="label" style={{ marginBottom: 8, color: "var(--amber)" }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.62 }}>
          {detail}
        </div>
      </div>

      <div
        className="note"
        style={{ maxWidth: 460, borderTop: "1px solid var(--line)", paddingTop: 12 }}
      >
        The numerical pipeline is unaffected. Screening, propagation, risk
        ranking and validation are still running, and every page except this
        viewport works normally.
      </div>

      {diagnostic && (
        <pre
          className="mono"
          style={{
            maxWidth: 560,
            maxHeight: 130,
            overflow: "auto",
            textAlign: "left",
            fontSize: 9.5,
            lineHeight: 1.5,
            color: "var(--text-faint)",
            background: "var(--bg-input)",
            border: "1px solid var(--line)",
            borderRadius: 3,
            padding: "8px 10px",
            whiteSpace: "pre-wrap",
            margin: 0,
          }}
        >
          {diagnostic}
        </pre>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-accent" onClick={onRetry}>
          Retry 3D view
        </button>
        {onDismiss && (
          <button className="btn" onClick={onDismiss}>
            Return to dashboard
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ diagnostics */

/**
 * Dev-only renderer telemetry.
 *
 * Exists because the failure this component guards against happens on other
 * people's hardware. When someone reports "it went black", the useful reply is
 * a screenshot of this panel: it names the GPU, whether the rasteriser is
 * software, how many draw calls and how much geometry the scene actually
 * holds, and whether the frame loop is running at all.
 *
 * Reads `gl.info` once a second rather than per frame -- telemetry that
 * measurably slows the thing it measures is worse than none.
 */
function Diagnostics({ report }: { report: WebGLReport | null }) {
  const [stats, setStats] = useState<Record<string, string | number>>({});

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let frames = 0;
    let raf = 0;
    const count = () => {
      frames++;
      raf = requestAnimationFrame(count);
    };
    raf = requestAnimationFrame(count);

    const id = window.setInterval(() => {
      const state = (window as unknown as { __KAKSHA_R3F?: { gl: THREE_GL } })
        .__KAKSHA_R3F;
      const gl = state?.gl;
      setStats({
        fps: frames,
        drawCalls: gl?.info?.render?.calls ?? "-",
        triangles: gl?.info?.render?.triangles ?? "-",
        geometries: gl?.info?.memory?.geometries ?? "-",
        textures: gl?.info?.memory?.textures ?? "-",
        programs: gl?.info?.programs?.length ?? "-",
      });
      frames = 0;
    }, 1000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(id);
    };
  }, []);

  if (!import.meta.env.DEV) return null;

  const rows: [string, string | number][] = [
    ["webgl", report?.ok ? "READY" : "FAILED"],
    ["gpu", (report?.renderer ?? "-").slice(0, 30)],
    ["software", report?.softwareRendered ? "YES" : "no"],
    ["fps", stats.fps ?? "-"],
    ["draw calls", stats.drawCalls ?? "-"],
    ["triangles", stats.triangles ?? "-"],
    ["geometries", stats.geometries ?? "-"],
    ["textures", stats.textures ?? "-"],
    ["programs", stats.programs ?? "-"],
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 14,
        zIndex: 28,
        background: "rgba(8,13,21,0.9)",
        border: "1px solid var(--line)",
        borderRadius: 3,
        padding: "7px 9px",
        pointerEvents: "none",
        backdropFilter: "blur(6px)",
      }}
    >
      <div className="label" style={{ marginBottom: 4 }}>
        Renderer
      </div>
      {rows.map(([k, v]) => (
        <div
          key={k}
          style={{ display: "flex", justifyContent: "space-between", gap: 14 }}
        >
          <span style={{ fontSize: 9, color: "var(--text-faint)" }}>{k}</span>
          <span className="mono" style={{ fontSize: 9, color: "var(--text-dim)" }}>
            {String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Minimal shape of the bits of the three.js renderer this panel reads. */
interface THREE_GL {
  info?: {
    render?: { calls?: number; triangles?: number };
    memory?: { geometries?: number; textures?: number };
    programs?: unknown[];
  };
}

/* ---------------------------------------------------------------- viewport */

export function GlobeViewport({ onClose }: { onClose?: () => void }) {
  const [stage, setStage] = useState<Stage>("IDLE");
  const [report, setReport] = useState<WebGLReport | null>(null);
  const [crash, setCrash] = useState<{ message: string; stack: string } | null>(null);

  /**
   * Bumping this remounts the entire subtree, which is what makes retry safe:
   * React tears the old tree down first, so R3F disposes its renderer, scene
   * and animation loop before a new one is constructed. Retrying by clearing
   * an error flag alone would stack a second renderer on top of the first.
   */
  const [attempt, setAttempt] = useState(0);

  const hostRef = useRef<HTMLDivElement>(null);

  // Probe once per attempt, before any renderer is constructed.
  useEffect(() => {
    setStage("PROBING");
    const r = probeWebGL();
    setReport(r);
    setStage(r.ok ? "READY" : "UNSUPPORTED");
  }, [attempt]);

  /**
   * Context loss arrives as an event, not an exception -- so without this the
   * canvas simply turns black and nothing in the app ever notices. Preventing
   * the default keeps the door open for the browser to restore it.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const onLost = (e: Event) => {
      e.preventDefault();
      setStage("CONTEXT_LOST");
    };
    const onRestored = () => setAttempt((a) => a + 1);

    host.addEventListener("webglcontextlost", onLost, true);
    host.addEventListener("webglcontextrestored", onRestored, true);
    return () => {
      host.removeEventListener("webglcontextlost", onLost, true);
      host.removeEventListener("webglcontextrestored", onRestored, true);
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setCrash(null);
    setStage("IDLE");
    setAttempt((a) => a + 1);
  }, []);

  const handleCrash = useCallback((message: string, stack: string) => {
    setCrash({ message, stack });
    setStage("CRASHED");
  }, []);

  const diagnostic = useMemo(() => {
    const lines: string[] = [];
    if (report) {
      lines.push(`webgl        ${report.ok ? "available" : "unavailable"}`);
      if (report.version) lines.push(`version      ${report.version}`);
      if (report.renderer) lines.push(`renderer     ${report.renderer}`);
      if (report.vendor) lines.push(`vendor       ${report.vendor}`);
      if (report.maxTextureSize)
        lines.push(`maxTexture   ${report.maxTextureSize}px`);
      if (report.softwareRendered) lines.push("rasteriser   SOFTWARE (no GPU)");
      if (report.reason) lines.push(`reason       ${report.reason}`);
    }
    lines.push(`attempt      ${attempt + 1}`);
    lines.push(`dpr          ${window.devicePixelRatio}`);
    if (crash) {
      lines.push("", `error        ${crash.message}`, crash.stack);
    }
    return lines.join("\n");
  }, [report, crash, attempt]);

  return (
    <div ref={hostRef} style={{ position: "absolute", inset: 0 }}>
      {stage === "READY" && (
        <>
          <GlobeErrorBoundary key={attempt} onError={handleCrash}>
            <GlobeScene />
          </GlobeErrorBoundary>
          <Diagnostics report={report} />
          {report?.softwareRendered && (
            <div
              className="note"
              style={{
                position: "absolute",
                top: 12,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 30,
                background: "rgba(8,13,21,0.92)",
                border: "1px solid var(--amber)",
                borderRadius: 3,
                padding: "5px 11px",
                color: "var(--amber)",
                pointerEvents: "none",
              }}
            >
              Software rendering — no GPU acceleration. Expect low frame rates.
            </div>
          )}
        </>
      )}

      {stage === "PROBING" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span className="label">Checking graphics capability…</span>
        </div>
      )}

      {stage === "UNSUPPORTED" && (
        <FailurePanel
          title="3D visualization unavailable"
          detail={
            report?.reason ??
            "This browser or GPU could not initialise the 3D renderer."
          }
          diagnostic={diagnostic}
          onRetry={retry}
          onDismiss={onClose}
        />
      )}

      {stage === "CONTEXT_LOST" && (
        <FailurePanel
          title="Graphics context was lost"
          detail={
            "The browser released the WebGL context, usually because the GPU " +
            "driver reset or memory ran short. Nothing was corrupted — the " +
            "scene can be rebuilt."
          }
          diagnostic={diagnostic}
          onRetry={retry}
          onDismiss={onClose}
        />
      )}

      {stage === "CRASHED" && (
        <FailurePanel
          title="3D view failed to start"
          detail={
            "The orbital visualization raised an error while initialising. " +
            "The details below are the first failure, not a cascade."
          }
          diagnostic={diagnostic}
          onRetry={retry}
          onDismiss={onClose}
        />
      )}
    </div>
  );
}

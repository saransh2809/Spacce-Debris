/**
 * KAKSHA -- LLM explanation panel.
 *
 * The panel shows the generated text AND the result of the numeric audit, side
 * by side. That pairing is the point: a reader can see not only what the model
 * said but whether every number it used traces back to the pipeline.
 *
 * If the audit fails, the panel says so prominently and keeps the underlying
 * figures visible in the other tabs. The explanation is never allowed to become
 * the authoritative version of a value.
 */
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../../api/client";
import { useScreenParams } from "../../hooks/useKaksha";
import type { ExplainResponse } from "../../api/types";

export function ExplanationPanel({ eventId }: { eventId: string }) {
  const params = useScreenParams();

  const mutation = useMutation<ExplainResponse, Error>({
    mutationFn: () => api.explain(eventId, params),
  });

  // Generate once per event, automatically.
  useEffect(() => {
    mutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const data = mutation.data;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 9,
        }}
      >
        <span className="label">Explanation Layer</span>
        <button
          className="btn"
          style={{ padding: "3px 8px", fontSize: 9 }}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Generating…" : "↻ Regenerate"}
        </button>
      </div>

      <div
        className="note"
        style={{
          marginBottom: 10,
          padding: "7px 9px",
          background: "var(--bg-input)",
          border: "1px solid var(--line)",
          borderRadius: 3,
          lineHeight: 1.55,
        }}
      >
        The model receives only the finished, validated numbers. It cannot
        propagate orbits, solve for TCA, compute a miss distance, or change a
        risk ranking. Every numeral it produces is checked against the values it
        was given.
      </div>

      {mutation.isPending && (
        <div style={{ display: "grid", gap: 7 }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{ height: 11, width: `${72 + ((i * 13) % 26)}%` }}
            />
          ))}
        </div>
      )}

      {mutation.isError && (
        <div className="caveat">
          <strong>Explanation unavailable.</strong> {mutation.error.message}
        </div>
      )}

      {data && (
        <>
          {/* --- audit banner --- */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 10px",
              marginBottom: 10,
              borderRadius: 3,
              border: `1px solid ${data.verified ? "rgba(53,208,127,0.3)" : "rgba(240,71,71,0.35)"}`,
              background: data.verified
                ? "rgba(53,208,127,0.07)"
                : "rgba(240,71,71,0.08)",
            }}
          >
            <span style={{ fontSize: 13 }}>{data.verified ? "✓" : "⚠"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "var(--fs-micro)",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: data.verified ? "var(--ok)" : "var(--bad)",
                }}
              >
                {data.verified ? "NUMERIC AUDIT PASSED" : "NUMERIC AUDIT FAILED"}
              </div>
              <div className="mono" style={{ fontSize: 9.5, color: "var(--text-muted)" }}>
                {data.numeric_audit.numbers_verified} / {data.numeric_audit.numbers_found}{" "}
                numerals traced to pipeline values
                {data.numeric_audit.unverified_values.length > 0 &&
                  ` · unverified: ${data.numeric_audit.unverified_values.join(", ")}`}
              </div>
            </div>
          </div>

          {data.claim_violations.length > 0 && (
            <div className="caveat" style={{ marginBottom: 10 }}>
              <strong>Overstated claim detected:</strong>{" "}
              {data.claim_violations.join("; ")}. The numerical panels remain
              authoritative.
            </div>
          )}

          {/* --- generated text --- */}
          <div
            style={{
              fontSize: "var(--fs-small)",
              lineHeight: 1.68,
              color: "var(--text)",
              whiteSpace: "pre-wrap",
            }}
          >
            {data.explanation.split("\n").map((line, i) => {
              const isHeading =
                /^(SUMMARY|WHY THIS RANKING|UNCERTAINTY|WHAT THIS DOES NOT MEAN)$/.test(
                  line.trim(),
                );
              if (isHeading) {
                return (
                  <div
                    key={i}
                    className="label"
                    style={{
                      marginTop: i === 0 ? 0 : 13,
                      marginBottom: 4,
                      color: "var(--teal)",
                    }}
                  >
                    {line.trim()}
                  </div>
                );
              }
              if (!line.trim()) return <div key={i} style={{ height: 5 }} />;
              return <div key={i}>{line}</div>;
            })}
          </div>

          {/* --- provenance --- */}
          <div
            style={{
              marginTop: 12,
              paddingTop: 9,
              borderTop: "1px solid var(--line)",
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
            }}
          >
            <span
              className={`chip ${data.source === "llm" ? "chip-PUBLISHED" : "chip-neutral"}`}
            >
              {data.source === "llm" ? `MODEL: ${data.model}` : "DETERMINISTIC TEMPLATE"}
            </span>
            <span className="mono" style={{ fontSize: 9.5, color: "var(--text-faint)" }}>
              {data.elapsed_ms.toFixed(0)} ms
            </span>
          </div>

          {data.error && (
            <div className="caveat" style={{ marginTop: 8 }}>
              {data.error} The text above is generated directly from the numbers
              with no model involvement, so it cannot contain an invented value.
            </div>
          )}
        </>
      )}
    </div>
  );
}

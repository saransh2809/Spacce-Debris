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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useScreenParams } from "../../hooks/useKaksha";
import type { ExplainResponse } from "../../api/types";

/**
 * One explanation per event, shared by every component that shows it.
 *
 * This was a mutation fired from an effect, which meant the summary card and
 * the full panel each triggered their own generation, and every tab switch
 * paid for another one. As a cached query the model is called once per event
 * and both views read the same result.
 */
export function useExplanation(eventId: string) {
  const params = useScreenParams();
  return useQuery<ExplainResponse, Error>({
    queryKey: ["explain", eventId],
    queryFn: () => api.explain(eventId, params),
    // The explanation describes a fixed, validated result: it does not go stale
    // while the event is on screen.
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}

/**
 * The prominent AI EXPLANATION card.
 *
 * Sits in the default view of a selected conjunction rather than behind a tab,
 * because an explanation nobody finds is not an explanation. It shows the
 * narrative summary and the audit verdict; the full breakdown, including which
 * numerals were traced, stays in the dedicated panel.
 */
export function AiExplanationCard({
  eventId,
  onOpenFull,
}: {
  eventId: string;
  onOpenFull?: () => void;
}) {
  const { data, isPending, isError, error } = useExplanation(eventId);

  // The generated text is sectioned; the SUMMARY section is the part that
  // belongs in a card this size.
  const summary = (() => {
    if (!data) return "";
    const text = data.explanation;
    const start = text.indexOf("SUMMARY");
    if (start < 0) return text.slice(0, 420);
    const body = text.slice(start + "SUMMARY".length);
    const next = body.search(
      new RegExp("\\n(WHY THIS RANKING|UNCERTAINTY|WHAT THIS DOES NOT MEAN)"),
    );
    return (next > 0 ? body.slice(0, next) : body).trim();
  })();

  return (
    <div
      style={{
        marginTop: 14,
        border: "1px solid var(--teal-line, rgba(45,212,191,0.32))",
        borderLeft: "2px solid var(--teal)",
        borderRadius: 3,
        background: "rgba(45,212,191,0.045)",
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 7,
        }}
      >
        <span className="label" style={{ color: "var(--teal)" }}>
          &#10022; AI Explanation
        </span>
        {data && (
          <span
            className="mono"
            style={{
              fontSize: 9,
              color: data.verified ? "var(--ok)" : "var(--bad)",
              whiteSpace: "nowrap",
            }}
            title={
              data.verified
                ? "Every numeral in this text was traced back to a pipeline value"
                : "One or more numerals could not be traced to a pipeline value"
            }
          >
            {data.verified ? "✓ AUDIT PASSED" : "⚠ AUDIT FAILED"}
          </span>
        )}
      </div>

      {isPending && (
        <div style={{ display: "grid", gap: 6 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{ height: 10, width: `${76 + ((i * 11) % 20)}%` }}
            />
          ))}
        </div>
      )}

      {isError && (
        <div className="note">
          Explanation unavailable ({error.message}). The numerical panels above
          remain authoritative.
        </div>
      )}

      {data && (
        <>
          <div
            style={{
              fontSize: "var(--fs-small)",
              lineHeight: 1.62,
              color: "var(--text)",
              whiteSpace: "pre-wrap",
            }}
          >
            {summary}
          </div>

          <div
            style={{
              marginTop: 9,
              paddingTop: 7,
              borderTop: "1px solid var(--line-faint)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span className="note" style={{ margin: 0 }}>
              AI interpretation &middot; based on validated numerical results
            </span>
            {onOpenFull && (
              <button
                className="btn"
                style={{ padding: "3px 8px", fontSize: 9, flexShrink: 0 }}
                onClick={onOpenFull}
              >
                Full explanation
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function ExplanationPanel({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const query = useExplanation(eventId);
  const mutation = {
    isPending: query.isPending || query.isFetching,
    isError: query.isError,
    error: query.error as Error,
    mutate: () =>
      queryClient.invalidateQueries({ queryKey: ["explain", eventId] }),
  };

  const data = query.data;

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

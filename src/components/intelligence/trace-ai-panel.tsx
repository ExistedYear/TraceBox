"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ReportQualityBadge } from "@/components/intelligence/report-quality";
import { TriageSuggestion } from "@/components/intelligence/triage-suggestion";
import { DuplicateAnalysis } from "@/components/intelligence/duplicate-analysis";
import type { TriageAnalysis } from "@/lib/ai/schemas/triage";

type AiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: TriageAnalysis; cached?: boolean }
  | { status: "error"; code: string; message: string }
  | { status: "restricted" };

export function TraceAiPanel({
  issueId,
  projectKey,
  reportQualityIssue,
  attachments,
  allowedComponents,
  allowedAssignees,
  duplicateCandidates,
}: {
  issueId: string;
  projectKey: string;
  reportQualityIssue: { description?: string | null; steps_to_reproduce?: string | null; expected_behavior?: string | null; actual_behavior?: string | null; environment?: string | null; affected_version_id?: string | null; title?: string | null };
  attachments?: Array<{ filename?: string | null; mime_type?: string | null }>;
  allowedComponents: Array<{ id: string; name: string }>;
  allowedAssignees: Array<{ userId: string; displayName: string | null }>;
  duplicateCandidates: Array<{ issue_id: string; issue_number: number; title: string; similarity?: number | null }>;
}) {
  const [state, setState] = useState<AiState>({ status: "idle" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetch("/api/intelligence/triage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ issueId }),
        });
        const payload = (await response.json()) as unknown as Record<string, unknown>;
        if (cancelled) return;
        if (!response.ok) {
          const code = typeof payload.code === "string" ? payload.code : "AI_PROVIDER_ERROR";
          if (code === "AI_DISABLED_FOR_RESTRICTED_ISSUE") {
            setState({ status: "restricted" });
            return;
          }
          setState({ status: "error", code, message: typeof payload.message === "string" ? payload.message : "Trace AI is temporarily unavailable." });
          return;
        }
        const data = payload.data as TriageAnalysis | undefined;
        const cached = Boolean(payload.cached);
        if (!data) {
          setState({ status: "error", code: "AI_INVALID_RESPONSE", message: "Trace AI returned an invalid response." });
          return;
        }
        setState({ status: "success", data, cached });
      } catch {
        if (!cancelled) setState({ status: "error", code: "AI_PROVIDER_ERROR", message: "Trace AI is temporarily unavailable." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [issueId, retryKey]);

  return (
    <div className="space-y-3">
      <ReportQualityBadge issue={reportQualityIssue} attachments={attachments} />

      <div className="rounded-[10px] border border-border/80 bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Trace AI</span>
          {state.status === "success" && state.cached && <span className="rounded-full border bg-muted px-1.5 py-0.5 font-mono text-[10px]">cached</span>}
          {state.status === "loading" && <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> analysing</span>}
          {state.status === "error" && <span className="font-mono text-[10px] text-amber-600">{state.code}</span>}
          {state.status === "restricted" && <span className="font-mono text-[10px] text-amber-600">restricted</span>}
        </div>

        {state.status === "idle" && <p className="mt-2 text-xs text-muted-foreground">Trace AI is ready.</p>}
        {state.status === "loading" && <p className="mt-2 text-xs text-muted-foreground">Generating advisory triage… Deterministic analysis is still available.</p>}
        {state.status === "restricted" && (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Trace AI is disabled for restricted issues to prevent external disclosure. Deterministic report-quality and duplicate-search tools remain available where permitted.
          </p>
        )}
        {state.status === "error" && (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground">{state.message} Deterministic analysis is still available.</p>
            <button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
              className="mt-2 text-xs font-medium text-primary underline"
            >
              Retry
            </button>
          </div>
        )}
        {state.status === "success" && (
          <div className="mt-3">
            <TriageSuggestion
              analysis={state.data}
              issueId={issueId}
              projectKey={projectKey}
              allowedComponents={allowedComponents}
              allowedAssignees={allowedAssignees}
              onApplied={() => window.location.reload()}
            />
            <div className="mt-3">
              <DuplicateAnalysis
                candidates={duplicateCandidates}
                analysis={state.data.duplicate_analysis}
                projectKey={projectKey}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

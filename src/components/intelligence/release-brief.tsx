"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import type { ReleaseBrief } from "@/lib/ai/schemas/release";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: ReleaseBrief; cached?: boolean }
  | { status: "error"; code: string; message: string }
  | { status: "restricted" };

export function ReleaseBriefPanel({ projectId, milestoneId, versionId }: { projectId: string; milestoneId?: string | null; versionId?: string | null }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!milestoneId && !versionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetch("/api/intelligence/release", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, milestoneId: milestoneId ?? null, versionId: versionId ?? null }),
        });
        const payload = (await response.json()) as Record<string, unknown>;
        if (cancelled) return;
        if (!response.ok) {
          const code = typeof payload.code === "string" ? payload.code : "AI_PROVIDER_ERROR";
          setState({ status: "error", code, message: typeof payload.message === "string" ? payload.message : "Trace AI is temporarily unavailable." });
          return;
        }
        const data = payload.data as ReleaseBrief | undefined;
        if (!data) {
          setState({ status: "error", code: "AI_INVALID_RESPONSE", message: "Trace AI returned an invalid response." });
          return;
        }
        setState({ status: "success", data, cached: Boolean(payload.cached) });
      } catch {
        if (!cancelled) setState({ status: "error", code: "AI_PROVIDER_ERROR", message: "Trace AI is temporarily unavailable." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, milestoneId, versionId, retryKey]);

  if (!milestoneId && !versionId) return null;

  return (
    <div className="rounded-[10px] border border-border/80 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Trace AI · Release Brief</span>
        {state.status === "success" && state.cached && <span className="rounded-full border bg-muted px-1.5 py-0.5 font-mono text-[10px]">cached</span>}
        {state.status === "loading" && <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> briefing</span>}
      </div>

      {state.status === "idle" && <p className="mt-2 text-xs text-muted-foreground">Select a milestone or version to generate an AI briefing.</p>}
      {state.status === "loading" && <p className="mt-2 text-xs text-muted-foreground">Explaining deterministic readiness…</p>}
      {state.status === "error" && (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">{state.message}</p>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="mt-2 text-xs font-medium text-primary underline">
            Retry
          </button>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">Deterministic readiness score remains available.</p>
        </div>
      )}
      {state.status === "success" && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide">{state.data.risk_level} risk</span>
            <span className="font-mono text-[10px] text-muted-foreground">AI explanation · readiness score remains deterministic</span>
          </div>
          <p className="text-sm leading-6">{state.data.summary}</p>
          {state.data.primary_risks.length > 0 && (
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Primary risks</p>
              <ul className="mt-1 space-y-1 text-xs">
                {state.data.primary_risks.map((risk) => (
                  <li key={risk.issue_key} className="flex gap-2">
                    <span className="font-mono font-semibold text-primary">{risk.issue_key}</span>
                    <span className="text-muted-foreground">{risk.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Recommendation</p>
            <p className="mt-1 text-xs leading-5">{state.data.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

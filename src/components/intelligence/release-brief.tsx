"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ReleaseBrief } from "@/lib/ai/schemas/release";

type State = { status: "idle" } | { status: "loading" } | { status: "success"; data: ReleaseBrief; cached: boolean } | { status: "error"; code: string; message: string };

export function ReleaseBriefPanel({ projectId, milestoneId, versionId, targetLabel, aiConfigured = true }: { projectId: string; milestoneId?: string | null; versionId?: string | null; targetLabel?: string; aiConfigured?: boolean }) {
  const [state, setState] = useState<State>({ status: "idle" });
  if (!milestoneId && !versionId) return null;

  async function generate() {
    if (!aiConfigured || state.status === "loading") return;
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/intelligence/release", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, milestoneId: milestoneId ?? null, versionId: versionId ?? null, analyze: true }) });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) { setState({ status: "error", code: typeof payload.code === "string" ? payload.code : "AI_PROVIDER_ERROR", message: typeof payload.message === "string" ? payload.message : "Trace AI is temporarily unavailable." }); return; }
      if (!payload.data || typeof payload.data !== "object") { setState({ status: "error", code: "AI_INVALID_RESPONSE", message: "Trace AI returned an invalid response." }); return; }
      setState({ status: "success", data: payload.data as ReleaseBrief, cached: payload.cached === true });
    } catch { setState({ status: "error", code: "AI_PROVIDER_ERROR", message: "Trace AI is temporarily unavailable." }); }
  }

  return <section className="rounded-[10px] border border-border/80 bg-card p-4" aria-labelledby={`release-brief-${projectId}`}><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /><h2 id={`release-brief-${projectId}`} className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Trace AI · Release brief</h2></div>{state.status === "success" && state.cached ? <span className="rounded-full border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">cached</span> : null}</div><p className="mt-1 text-[11px] text-muted-foreground">{targetLabel ? `Explain the selected ${targetLabel} using the deterministic readiness result.` : "Explain this selected release target using deterministic readiness."}</p>{!aiConfigured ? <p className="mt-3 text-xs leading-5 text-muted-foreground">Release briefs are unavailable in this environment. The readiness score and risk groups remain canonical.</p> : state.status === "idle" ? <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void generate()}><Sparkles className="h-3.5 w-3.5" />Generate brief</Button><span className="text-[11px] text-muted-foreground">Nothing is sent until you choose Generate.</span></div> : state.status === "loading" ? <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite"><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating explanation…</p> : state.status === "error" ? <div className="mt-3 flex flex-wrap items-center gap-2" role="alert"><span className="text-xs text-muted-foreground">{state.message}</span><Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => void generate()}>Retry</Button><span className="font-mono text-[10px] text-muted-foreground">{state.code}</span></div> : <div className="mt-3 space-y-3"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-border/70 bg-muted/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide">{state.data.risk_level} risk</span><span className="font-mono text-[10px] text-muted-foreground">AI explanation · deterministic score unchanged</span></div><p className="text-sm leading-6">{state.data.summary}</p>{state.data.primary_risks.length > 0 ? <div><p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Primary risks</p><ul className="mt-1 space-y-1 text-xs">{state.data.primary_risks.map((risk) => <li key={risk.issue_key} className="flex gap-2"><span className="font-mono font-semibold text-primary">{risk.issue_key}</span><span className="text-muted-foreground">{risk.reason}</span></li>)}</ul></div> : null}<div className="rounded-lg border border-border/60 bg-background/50 p-2.5"><p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Recommendation</p><p className="mt-1 text-xs leading-5">{state.data.recommendation}</p></div></div>}</section>;
}

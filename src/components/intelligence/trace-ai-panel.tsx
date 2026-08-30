"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { DuplicateAnalysis } from "@/components/intelligence/duplicate-analysis";
import { ReportQualityBadge } from "@/components/intelligence/report-quality";
import { TriageSuggestion } from "@/components/intelligence/triage-suggestion";
import { Button } from "@/components/ui/button";
import type { TriageAnalysis } from "@/lib/ai/schemas/triage";
import { createClient } from "@/lib/supabase/client";

type AiState = { status: "idle" } | { status: "loading" } | { status: "success"; data: TriageAnalysis; cached: boolean } | { status: "error"; code: string; message: string } | { status: "restricted" };
type IssueEvidence = { type?: string | null; visibility?: string | null; title?: string | null; description?: string | null; steps_to_reproduce?: string | null; expected_behavior?: string | null; actual_behavior?: string | null; environment?: string | null; affected_version_id?: string | null };
type Candidate = { issue_id: string; issue_number: number; title: string; description?: string | null; similarity?: number | null };

export function TraceAiPanel({ issueId, projectKey, expectedUpdatedAt, reportQualityIssue, attachments, allowedComponents, allowedAssignees, duplicateCandidates, primaryIssue, aiConfigured = true, canApply = true, onApplied, onMarkDuplicate }: { issueId: string; projectKey: string; expectedUpdatedAt?: string | null; reportQualityIssue: IssueEvidence; attachments?: Array<{ filename?: string | null; mime_type?: string | null; name?: string | null }>; allowedComponents: Array<{ id: string; name: string }>; allowedAssignees: Array<{ userId: string; displayName: string | null }>; duplicateCandidates: Candidate[]; primaryIssue?: { keyLabel?: string; title: string; description?: string | null }; aiConfigured?: boolean; canApply?: boolean; onApplied?: () => void; onMarkDuplicate?: (issueId: string, keyLabel: string) => void }) {
  const [state, setState] = useState<AiState>({ status: "idle" });
  const router = useRouter();

  async function markDuplicate(candidateId: string, keyLabel: string) {
    if (!canApply) return;
    if (onMarkDuplicate) { onMarkDuplicate(candidateId, keyLabel); return; }
    const { data, error } = await createClient().rpc("resolve_duplicate_issue", { p_duplicate_issue_id: issueId, p_canonical_issue_id: candidateId });
    if (error || !data?.[0]) { toast.error("Could not resolve the duplicate. No changes were saved."); return; }
    toast.success(`Issue marked as duplicate of ${keyLabel}.`);
    router.refresh();
  }

  async function analyze() {
    if (!aiConfigured || state.status === "loading") return;
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/intelligence/triage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issueId, analyze: true }) });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        const code = typeof payload.code === "string" ? payload.code : "AI_PROVIDER_ERROR";
        setState(code === "AI_DISABLED_FOR_RESTRICTED_ISSUE" ? { status: "restricted" } : { status: "error", code, message: typeof payload.message === "string" ? payload.message : "Trace AI is temporarily unavailable." });
        return;
      }
      if (!payload.data || typeof payload.data !== "object") { setState({ status: "error", code: "AI_INVALID_RESPONSE", message: "Trace AI returned an invalid response." }); return; }
      setState({ status: "success", data: payload.data as TriageAnalysis, cached: payload.cached === true });
    } catch { setState({ status: "error", code: "AI_PROVIDER_ERROR", message: "Trace AI is temporarily unavailable." }); }
  }

  return <div className="space-y-3">
    <ReportQualityBadge issue={reportQualityIssue} attachments={attachments} />
    <section className="rounded-[10px] border border-border/80 bg-card p-3" aria-labelledby={`trace-ai-${issueId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /><h2 id={`trace-ai-${issueId}`} className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Trace AI</h2><span className="font-mono text-[10px] text-muted-foreground">advisory only</span></div><div className="flex items-center gap-2">{state.status === "success" && state.cached ? <span className="rounded-full border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">cached</span> : null}{state.status === "loading" ? <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> analyzing</span> : null}{state.status === "error" ? <span className="font-mono text-[10px] text-amber-300">{state.code}</span> : null}</div></div>
      {!aiConfigured ? <p className="mt-2 text-xs leading-5 text-muted-foreground">Trace AI is not configured for this environment. Deterministic report quality and duplicate search remain available.</p> : state.status === "restricted" ? <p className="mt-2 text-xs leading-5 text-muted-foreground">AI analysis is disabled for restricted issues to prevent external disclosure. Deterministic checks remain available.</p> : state.status === "idle" ? <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void analyze()}><Sparkles className="h-3.5 w-3.5" />Analyze issue</Button><span className="text-[11px] text-muted-foreground">Nothing is sent until you choose Analyze.</span></div> : state.status === "loading" ? <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">Generating advisory triage. The issue remains unchanged.</p> : state.status === "error" ? <div className="mt-2 flex flex-wrap items-center gap-2" role="alert"><p className="text-xs text-muted-foreground">{state.code === "AI_RATE_LIMITED" ? "AI requests are rate limited. Try again shortly." : state.message} Deterministic analysis is still available.</p><Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => void analyze()}>Retry analysis</Button></div> : state.status === "success" ? <div className="mt-3 space-y-3"><TriageSuggestion analysis={state.data} issueId={issueId} expectedUpdatedAt={expectedUpdatedAt} allowedComponents={allowedComponents} allowedAssignees={allowedAssignees} canApply={canApply} onApplied={onApplied} /><DuplicateAnalysis candidates={duplicateCandidates} analysis={state.data.duplicate_analysis} projectKey={projectKey} primaryIssue={primaryIssue} onMarkDuplicate={canApply ? (candidateId, keyLabel) => void markDuplicate(candidateId, keyLabel) : undefined} /></div> : null}
    </section>
  </div>;
}

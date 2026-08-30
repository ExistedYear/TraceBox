"use client";

import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { TriageAnalysis } from "@/lib/ai/schemas/triage";

type Props = { analysis: TriageAnalysis; issueId: string; expectedUpdatedAt?: string | null; allowedComponents: Array<{ id: string; name: string }>; allowedAssignees: Array<{ userId: string; displayName: string | null }>; canApply?: boolean; onApplied?: () => void };
type Suggestion = { key: "component" | "severity" | "priority" | "assignee"; label: string; value: string; reason: string; confidence: number; valid: boolean };

function confidence(value: number) { return value >= 80 ? "High" : value >= 50 ? "Medium" : "Low"; }

export function TriageSuggestion({ analysis, issueId, expectedUpdatedAt, allowedComponents, allowedAssignees, canApply = true, onApplied }: Props) {
  const [selected, setSelected] = useState<Set<Suggestion["key"]>>(new Set());
  const [applying, setApplying] = useState(false);
  const [conflict, setConflict] = useState(false);
  const componentMap = useMemo(() => new Map(allowedComponents.map((item) => [item.id, item.name])), [allowedComponents]);
  const assigneeMap = useMemo(() => new Map(allowedAssignees.map((item) => [item.userId, item.displayName ?? item.userId.slice(0, 8)])), [allowedAssignees]);
  const suggestions: Suggestion[] = [
    { key: "component", label: "Component", value: analysis.component.component_id ? componentMap.get(analysis.component.component_id) ?? "Unavailable" : "No suggestion", reason: analysis.component.reason, confidence: analysis.component.confidence, valid: Boolean(analysis.component.component_id && componentMap.has(analysis.component.component_id)) },
    { key: "severity", label: "Severity", value: analysis.severity.value, reason: analysis.severity.reason, confidence: analysis.severity.confidence, valid: true },
    { key: "priority", label: "Priority", value: analysis.priority.value, reason: analysis.priority.reason, confidence: analysis.priority.confidence, valid: true },
    { key: "assignee", label: "Assignee", value: analysis.assignee.user_id ? assigneeMap.get(analysis.assignee.user_id) ?? "Unavailable" : "No suggestion", reason: analysis.assignee.reason, confidence: analysis.assignee.confidence, valid: Boolean(analysis.assignee.user_id && assigneeMap.has(analysis.assignee.user_id)) },
  ];

  function toggle(key: Suggestion["key"]) { setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }

  async function applySelected() {
    if (!expectedUpdatedAt) { toast.error("Reload the issue before applying suggestions."); return; }
    if (selected.size === 0) { toast.error("Select at least one valid suggestion."); return; }
    setApplying(true); setConflict(false);
    try {
      const response = await fetch("/api/intelligence/triage/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issueId, updatedAt: expectedUpdatedAt, suggestion: { component: selected.has("component") ? analysis.component : { component_id: null }, severity: selected.has("severity") ? analysis.severity : { value: null }, priority: selected.has("priority") ? analysis.priority : { value: null }, assignee: selected.has("assignee") ? analysis.assignee : { user_id: null } } }) });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.status === 409 || payload.code === "CONFLICT" || payload.code === "STALE_ISSUE" || payload.code === "AI_STALE_ISSUE") { setConflict(true); return; }
      if (!response.ok) { toast.error(typeof payload.message === "string" ? payload.message : "Could not apply triage suggestions."); return; }
      toast.success("Selected suggestions applied."); setSelected(new Set()); onApplied?.();
    } catch { toast.error("Could not reach the server. No changes were applied."); }
    finally { setApplying(false); }
  }

  return <section className="rounded-[10px] border border-border/80 bg-card p-3" aria-labelledby={`triage-suggestions-${issueId}`}>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 id={`triage-suggestions-${issueId}`} className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Suggested triage</h3><span className="font-mono text-[10px] text-muted-foreground">select · review · apply</span></div>
    {conflict ? <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="alert">This issue changed while you reviewed the suggestions. Reload before applying anything.</div> : null}
    <div className="space-y-2">{suggestions.map((item) => <label key={item.key} className={`flex items-start gap-2 rounded-lg border p-2.5 ${item.valid ? "border-border/60 bg-background/50" : "border-border/40 bg-muted/20 opacity-70"}`}><input type="checkbox" className="mt-0.5" checked={selected.has(item.key)} onChange={() => toggle(item.key)} disabled={!item.valid || applying} aria-label={`Apply suggested ${item.label}`} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-xs font-semibold"><span>{item.label}</span><span className="rounded-full border border-border/70 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px]">{item.value}</span><span className="font-mono text-[10px] text-muted-foreground">{item.confidence}% · {confidence(item.confidence)} confidence</span></span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.reason}</span></span></label>)}</div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void applySelected()} disabled={!canApply || applying || selected.size === 0}>{applying ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Applying…</> : <><Check className="h-3.5 w-3.5" />Apply selected</>}</Button><p className="text-[11px] text-muted-foreground">{canApply ? "One conflict-aware request; existing authorization and audit rules still apply." : "You can review suggestions, but your project role cannot apply them."}</p></div>
    <div className="mt-3 rounded-lg border border-border/60 bg-background/50 p-2.5"><p className="text-xs font-semibold">Regression likelihood</p><p className="mt-1 flex items-center gap-2 font-mono text-xs"><span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] uppercase">{analysis.regression.likelihood}</span><span className="text-muted-foreground">{analysis.regression.confidence}% confidence</span></p><p className="mt-1 text-xs leading-5 text-muted-foreground">{analysis.regression.reason}</p></div>
    {analysis.follow_up_questions.length > 0 ? <div className="mt-2 rounded-lg border border-border/60 bg-background/50 p-2.5"><p className="text-xs font-semibold">Suggested follow-up</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{analysis.follow_up_questions.map((question, index) => <li key={`${question.question}-${index}`}><span className="text-foreground">{question.question}</span><span className="ml-1">— {question.reason}</span></li>)}</ul></div> : null}
  </section>;
}

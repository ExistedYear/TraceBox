"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { TriageAnalysis } from "@/lib/ai/schemas/triage";
import { toast } from "sonner";

type Props = {
  analysis: TriageAnalysis;
  issueId: string;
  projectKey: string;
  allowedComponents: Array<{ id: string; name: string }>;
  allowedAssignees: Array<{ userId: string; displayName: string | null }>;
  onApplied?: () => void;
};

export function TriageSuggestion({ analysis, issueId, allowedComponents: _allowedComponents, allowedAssignees: _allowedAssignees, onApplied }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  function toggle(key: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function applySelected() {
    if (selected.size === 0) {
      toast.error("Select at least one suggestion to apply.");
      return;
    }
    setApplying(true);
    const supabase = createClient();
    try {
      const updates: Record<string, unknown> = {};
      if (selected.has("component") && analysis.component.component_id) updates.component_id = analysis.component.component_id;
      if (selected.has("severity")) updates.severity = analysis.severity.value;
      if (selected.has("priority")) updates.priority = analysis.priority.value;

      if (Object.keys(updates).length > 0) {
        const { error } = await (supabase as unknown as { rpc: (name: string, args: unknown) => Promise<{ error: unknown | null }> }).rpc("update_issue_fields", { p_issue_id: issueId, p_updates: updates as unknown as never });
        if (error) {
          toast.error("Could not apply triage suggestions.");
          setApplying(false);
          return;
        }
      }
      if (selected.has("assignee") && analysis.assignee.user_id) {
        const { error } = await supabase.rpc("assign_issue", { p_issue_id: issueId, p_assignee_id: analysis.assignee.user_id });
        if (error) {
          toast.error("Could not assign issue.");
          setApplying(false);
          return;
        }
      }
      toast.success("Applied selected suggestions through trusted mutation path.");
      onApplied?.();
    } catch {
      toast.error("Could not reach server.");
    } finally {
      setApplying(false);
    }
  }

  const items: Array<{ key: string; label: string; value: string; confidence: number; reason: string; nullable?: boolean }> = [
    { key: "component", label: "Suggested component", value: analysis.component.component_id ?? "—", confidence: analysis.component.confidence, reason: analysis.component.reason, nullable: true },
    { key: "severity", label: "Severity", value: analysis.severity.value, confidence: analysis.severity.confidence, reason: analysis.severity.reason },
    { key: "priority", label: "Priority", value: analysis.priority.value, confidence: analysis.priority.confidence, reason: analysis.priority.reason },
    { key: "assignee", label: "Assignee", value: analysis.assignee.user_id ?? "—", confidence: analysis.assignee.confidence, reason: analysis.assignee.reason, nullable: true },
  ];

  return (
    <div className="rounded-[10px] border border-border/80 bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Trace AI — Triage</span>
        <span className="font-mono text-[10px] text-muted-foreground">advisory · requires approval</span>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <label key={item.key} className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/50 p-2.5">
            <input
              type="checkbox"
              checked={selected.has(item.key)}
              onChange={() => toggle(item.key)}
              disabled={item.nullable && item.value === "—"}
              className="mt-0.5"
              aria-label={`Apply ${item.label}`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold">{item.label}</span>
                <span className="rounded-full border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{item.value}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{item.confidence}% · {item.confidence >= 80 ? "High" : item.confidence >= 50 ? "Medium" : "Low"} confidence</span>
              </span>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.reason}</p>
            </span>
          </label>
        ))}

        <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
          <p className="text-xs font-semibold">Regression likelihood</p>
          <p className="mt-1 flex items-center gap-2 font-mono text-xs">
            <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase">{analysis.regression.likelihood}</span>
            <span className="text-muted-foreground">{analysis.regression.confidence}% confidence</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{analysis.regression.reason}</p>
        </div>

        {analysis.follow_up_questions.length > 0 && (
          <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
            <p className="text-xs font-semibold">Suggested follow-up</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {analysis.follow_up_questions.map((question, index) => (
                <li key={index}>
                  <span className="text-foreground">{question.question}</span>
                  <span className="ml-1">— {question.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={() => void applySelected()} disabled={applying || selected.size === 0} className="h-8 text-xs">
          {applying ? "Applying…" : "Apply selected"}
        </Button>
        <p className="text-[11px] text-muted-foreground">Applies via existing mutations with Zod + RLS checks.</p>
      </div>
    </div>
  );
}

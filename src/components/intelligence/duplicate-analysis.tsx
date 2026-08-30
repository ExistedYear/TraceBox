"use client";

import { useState } from "react";
import { ArrowRight, Check, GitCompareArrows } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatIssueKey } from "@/lib/issues";

type Candidate = { issue_id: string; issue_number: number; title: string; description?: string | null; similarity?: number | null };
type AnalysisEntry = { issue_id: string; likelihood: number; evidence: string[]; differences: string[] };
type PrimaryIssue = { keyLabel?: string; title: string; description?: string | null };

function confidenceLabel(value: number) {
  return value >= 80 ? "High" : value >= 50 ? "Medium" : "Low";
}

export function DuplicateAnalysis({ candidates, analysis, projectKey, primaryIssue, onMarkDuplicate }: { candidates: Candidate[]; analysis: AnalysisEntry[]; projectKey: string; primaryIssue?: PrimaryIssue; onMarkDuplicate?: (issueId: string, keyLabel: string) => void }) {
  const [compare, setCompare] = useState<Candidate | null>(null);
  const candidateMap = new Map(candidates.map((candidate) => [candidate.issue_id, candidate]));
  const merged = analysis.length > 0 ? analysis : candidates.slice(0, 3).map((candidate) => ({ issue_id: candidate.issue_id, likelihood: Math.round((candidate.similarity ?? 0) * 100), evidence: [], differences: [] }));

  if (candidates.length === 0) return <div className="rounded-[10px] border border-border/80 bg-card p-3"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Possible duplicates</p><p className="mt-1 text-xs text-muted-foreground">No deterministic candidates found. Similarity search remains available from triage.</p></div>;

  return (
    <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center justify-between gap-2"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300">Duplicate intelligence</p><span className="font-mono text-[10px] text-muted-foreground">advisory · deterministic candidates</span></div>
      <div className="mt-2 grid gap-2">
        {merged.map((entry) => {
          const candidate = candidateMap.get(entry.issue_id);
          if (!candidate) return null;
          const keyLabel = formatIssueKey(projectKey, candidate.issue_number);
          return <div key={entry.issue_id} className="rounded-lg border border-amber-500/20 bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs font-semibold text-primary">{keyLabel}</span><span aria-label={`${confidenceLabel(entry.likelihood)} confidence, ${entry.likelihood}% likely`} className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-200">{entry.likelihood}% · {confidenceLabel(entry.likelihood)} confidence</span></div>
            <p className="mt-1 truncate text-xs font-medium">{candidate.title}</p>
            {entry.evidence.length > 0 && <div className="mt-2"><p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Matching evidence</p><ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{entry.evidence.map((item, index) => <li key={`${entry.issue_id}-evidence-${index}`} className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />{item}</li>)}</ul></div>}
            {entry.differences.length > 0 && <div className="mt-2"><p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Differences</p><ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{entry.differences.map((item, index) => <li key={`${entry.issue_id}-difference-${index}`} className="flex gap-1.5"><span className="text-amber-400" aria-hidden="true">△</span>{item}</li>)}</ul></div>}
            <div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => setCompare(candidate)}><GitCompareArrows className="h-3 w-3" />Compare issues</Button>{onMarkDuplicate ? <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onMarkDuplicate(entry.issue_id, keyLabel)}>Mark duplicate</Button> : null}</div>
          </div>;
        })}
      </div>
      <p className="mt-2 font-mono text-[10px] text-muted-foreground">Evidence is explainable and advisory. Duplicate resolution still uses the trusted workflow.</p>

      <Dialog open={Boolean(compare)} onOpenChange={(open) => { if (!open) setCompare(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Compare issues</DialogTitle><DialogDescription>Review the supplied evidence side by side before deciding whether this is a duplicate.</DialogDescription></DialogHeader>
          {compare ? <div className="grid gap-3 md:grid-cols-2">
            <section className="rounded-lg border border-primary/30 bg-primary/5 p-3" aria-label="Current issue"><p className="font-mono text-[10px] uppercase tracking-wide text-primary">Current issue</p><h3 className="mt-2 text-sm font-semibold">{primaryIssue?.keyLabel ?? "Current issue"}</h3><p className="mt-1 text-sm font-medium">{primaryIssue?.title ?? "Issue under review"}</p><p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{primaryIssue?.description || "Description unavailable in this view."}</p></section>
            <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" aria-label="Candidate issue"><p className="font-mono text-[10px] uppercase tracking-wide text-amber-300">Candidate issue</p><h3 className="mt-2 font-mono text-sm font-semibold text-primary">{formatIssueKey(projectKey, compare.issue_number)}</h3><p className="mt-1 text-sm font-medium">{compare.title}</p><p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{compare.description || "Description unavailable in the deterministic candidate result."}</p></section>
          </div> : null}
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"><ArrowRight className="h-3.5 w-3.5 text-primary" />Compare title, evidence, and reproduction context before applying the duplicate decision.</div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setCompare(null)}>Close comparison</Button>{compare && onMarkDuplicate ? <Button type="button" onClick={() => { onMarkDuplicate(compare.issue_id, formatIssueKey(projectKey, compare.issue_number)); setCompare(null); }}>Mark duplicate</Button> : null}</DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


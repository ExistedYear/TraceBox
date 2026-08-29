"use client";

import { Button } from "@/components/ui/button";
import { formatIssueKey } from "@/lib/issues";

type Candidate = {
  issue_id: string;
  issue_number: number;
  title: string;
  similarity?: number | null;
};

type AnalysisEntry = {
  issue_id: string;
  likelihood: number;
  evidence: string[];
  differences: string[];
};

export function DuplicateAnalysis({
  candidates,
  analysis,
  projectKey,
  onMarkDuplicate,
}: {
  candidates: Candidate[];
  analysis: AnalysisEntry[];
  projectKey: string;
  onMarkDuplicate?: (issueId: string, keyLabel: string) => void;
}) {
  const candidateMap = new Map(candidates.map((candidate) => [candidate.issue_id, candidate]));
  const merged = analysis.length > 0 ? analysis : candidates.slice(0, 3).map((candidate) => ({ issue_id: candidate.issue_id, likelihood: Math.round((candidate.similarity ?? 0) * 100), evidence: [], differences: [] }));

  if (candidates.length === 0) {
    return (
      <div className="rounded-[10px] border border-border/80 bg-card p-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Possible duplicates</p>
        <p className="mt-1 text-xs text-muted-foreground">No deterministic candidates found. Deterministic search remains available.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-300">Duplicate Intelligence</p>
      <div className="mt-2 grid gap-2">
        {merged.map((entry) => {
          const candidate = candidateMap.get(entry.issue_id);
          if (!candidate) return null;
          const keyLabel = formatIssueKey(projectKey, candidate.issue_number);
          return (
            <div key={entry.issue_id} className="rounded-lg border border-amber-500/20 bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-primary">{keyLabel}</span>
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-700 dark:text-amber-300">
                  {entry.likelihood}% likely same defect
                </span>
              </div>
              <p className="mt-1 truncate text-xs font-medium">{candidate.title}</p>
              {entry.evidence.length > 0 && (
                <div className="mt-2">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Matching evidence</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {entry.evidence.map((item, index) => (
                      <li key={index} className="flex gap-1.5">
                        <span className="text-emerald-500">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {entry.differences.length > 0 && (
                <div className="mt-2">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Differences</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {entry.differences.map((item, index) => (
                      <li key={index} className="flex gap-1.5">
                        <span className="text-amber-500">△</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <Button asChild size="sm" variant="outline" className="h-7 text-[11px]">
                  <a href={`/dashboard/issues/${keyLabel}`} target="_blank" rel="noreferrer">
                    Compare
                  </a>
                </Button>
                {onMarkDuplicate && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onMarkDuplicate(entry.issue_id, keyLabel)}>
                    Mark duplicate
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 font-mono text-[10px] text-muted-foreground">Evidence is explainable and advisory. Mark duplicate uses existing mutation.</p>
    </div>
  );
}

import type { TriageAnalysis } from "@/lib/ai/schemas/triage";

export type DuplicateExplain = {
  issue_id: string;
  likelihood: number;
  evidence: string[];
  differences: string[];
};

export function normalizeDuplicateAnalysis(
  analysis: TriageAnalysis | null | undefined,
  allowedIds: Set<string>,
): DuplicateExplain[] {
  if (!analysis) return [];
  const entries = analysis.duplicate_analysis ?? [];
  return entries
    .filter((entry) => allowedIds.has(entry.issue_id))
    .map((entry) => ({
      issue_id: entry.issue_id,
      likelihood: Math.max(0, Math.min(100, entry.likelihood)),
      evidence: entry.evidence.slice(0, 6),
      differences: entry.differences.slice(0, 6),
    }));
}

"use client";

import { Check, Minus, X } from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { calculateReportQuality, type ReportQuality } from "@/features/intelligence/report-quality";
import { cn } from "@/lib/utils";

const ELIGIBLE_TYPES = new Set(["BUG", "REGRESSION", "PERFORMANCE", "SECURITY"]);

type IssueInput = {
  type?: string | null;
  visibility?: string | null;
  description?: string | null;
  steps_to_reproduce?: string | null;
  expected_behavior?: string | null;
  actual_behavior?: string | null;
  environment?: string | null;
  affected_version_id?: string | null;
  title?: string | null;
};

type AttachmentInput = { filename?: string | null; mime_type?: string | null; name?: string | null };

function scoreTone(score: number) {
  if (score >= 80) return "text-emerald-300";
  if (score >= 50) return "text-amber-300";
  return "text-red-300";
}

export function ReportQualityBadge({ issue, attachments }: { issue: IssueInput; attachments?: AttachmentInput[] }) {
  const eligible = !issue.type || ELIGIBLE_TYPES.has(issue.type);
  if (!eligible) {
    return (
      <Surface className="p-3" aria-label="Report quality unavailable">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Report quality</span>
          <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">Not scored</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Completeness checks apply to defect reports. Tasks and enhancements use their own acceptance criteria.</p>
      </Surface>
    );
  }

  const quality: ReportQuality = calculateReportQuality(issue, attachments);
  return (
    <Surface className="p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Report quality</span>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Deterministic evidence check · 100 point rubric</p>
        </div>
        <span className={cn("font-mono text-sm font-semibold", scoreTone(quality.score))}>{quality.score}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Report quality score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={quality.score}>
        <div className={cn("h-full rounded-full transition-[width] duration-300", quality.score >= 80 ? "bg-emerald-500" : quality.score >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${quality.score}%` }} />
      </div>
      <ul className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
        {quality.details.map((detail) => (
          <li key={detail.key} className="flex items-start gap-2">
            <span aria-hidden className={cn("mt-0.5", detail.status === "present" ? "text-emerald-400" : detail.status === "partial" ? "text-amber-400" : "text-muted-foreground")}>
              {detail.status === "present" ? <Check className="h-3.5 w-3.5" /> : detail.status === "partial" ? <Minus className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={detail.status === "missing" ? "text-muted-foreground" : "text-foreground"}>{detail.label}</span>
              <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{detail.earned}/{detail.points}</span>
            </span>
          </li>
        ))}
      </ul>
      {quality.missing.length > 0 ? <p className="mt-2 text-[11px] text-muted-foreground">Missing: {quality.missing.join(" · ")}</p> : <p className="mt-2 text-[11px] text-emerald-300">The report contains the expected evidence.</p>}
    </Surface>
  );
}

export function ReportQualityCompact({ score }: { score: number }) {
  return <div className="flex items-center gap-2" aria-label={`Report quality ${score}%`}><div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></div><span className="font-mono text-xs font-semibold">{score}%</span></div>;
}

"use client";

import { calculateReportQuality, type ReportQuality } from "@/features/intelligence/report-quality";

type IssueInput = {
  description?: string | null;
  steps_to_reproduce?: string | null;
  expected_behavior?: string | null;
  actual_behavior?: string | null;
  environment?: string | null;
  affected_version_id?: string | null;
  title?: string | null;
};

export function ReportQualityBadge({ issue, attachments }: { issue: IssueInput; attachments?: Array<{ filename?: string | null; mime_type?: string | null }> }) {
  const quality: ReportQuality = calculateReportQuality(issue, attachments);

  return (
    <div className="rounded-[10px] border border-border/80 bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Report Quality</span>
        <span className="font-mono text-xs font-semibold text-primary">{quality.score}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${quality.score}%` }} />
      </div>
      <ul className="mt-3 space-y-1 text-xs leading-5">
        {quality.details.map((detail) => (
          <li key={detail.key} className="flex items-start gap-2">
            <span aria-hidden className={detail.status === "present" ? "text-emerald-500" : detail.status === "partial" ? "text-amber-500" : "text-muted-foreground"}>
              {detail.status === "present" ? "✓" : detail.status === "partial" ? "△" : "✕"}
            </span>
            <span className="flex-1">
              <span className={detail.status === "missing" ? "text-muted-foreground" : "text-foreground"}>{detail.label}</span>
              <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                {detail.earned}/{detail.points}
              </span>
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">{detail.status}</span>
            </span>
          </li>
        ))}
      </ul>
      {quality.missing.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">Missing: {quality.missing.join(" · ")}</p>
      )}
    </div>
  );
}

export function ReportQualityCompact({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${score}%` }} />
      </div>
      <span className="font-mono text-xs font-semibold">{score}%</span>
    </div>
  );
}

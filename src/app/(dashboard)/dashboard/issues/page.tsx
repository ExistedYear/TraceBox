import type { Metadata } from "next";
import { Activity, CircleDot, Filter, GitPullRequest } from "lucide-react";

import { IssueTable } from "@/components/tracebox/issue-table";
import { MetricCard, SectionHeading } from "@/components/tracebox/primitives";

export const metadata: Metadata = { title: "Issues" };

export default function IssuesPage() {
  return <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8"><SectionHeading eyebrow="Workspace / issue queue" title="Issues" description="A dense, keyboard-friendly queue for finding the next useful decision." /><div className="mt-6 grid gap-3 sm:grid-cols-3"><MetricCard icon={CircleDot} label="Open" value="38" detail="Across 4 projects" /><MetricCard icon={Filter} label="Needs triage" value="06" detail="2 urgent priorities" /><MetricCard icon={GitPullRequest} label="In review" value="11" detail="3 need feedback" /></div><div className="mt-3"><IssueTable /></div><div className="mt-3 flex items-center gap-2 rounded-[10px] border border-dashed border-border px-4 py-3 text-xs text-muted-foreground"><Activity className="h-4 w-4 text-primary" /> Presentation fixtures are isolated here until the issue query and mutations are connected.</div></main>;
}

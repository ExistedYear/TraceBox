"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Filter, Plus, Search, SlidersHorizontal } from "lucide-react";

import { issues, type Issue } from "@/components/tracebox/issue-data";
import { Avatar, PriorityMark, StatusPill } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function IssueRow({ issue, selected, onSelect }: { issue: Issue; selected: boolean; onSelect: (id: string) => void }) {
  return <div className={cn("grid min-w-[760px] grid-cols-[34px_84px_minmax(260px,1fr)_128px_92px_132px_84px] items-center gap-3 border-b border-border/60 px-4 py-3 text-sm last:border-0", selected && "bg-primary/[0.04]")}><button type="button" onClick={() => onSelect(issue.id)} aria-label={`Select ${issue.id}`} className={cn("flex h-4 w-4 items-center justify-center rounded border", selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:border-primary")}>{selected && <Check className="h-3 w-3" />}</button><Link href={`/dashboard/issues/${issue.id}`} className="font-mono text-xs text-primary hover:underline">{issue.id}</Link><Link href={`/dashboard/issues/${issue.id}`} className="min-w-0 truncate font-medium hover:text-primary">{issue.title}</Link><StatusPill status={issue.status} /><PriorityMark priority={issue.priority} showLabel /><span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Avatar name={issue.assignee} size="sm" /><span className="truncate">{issue.assignee}</span></span><span className="font-mono text-[11px] text-muted-foreground">{issue.updated}</span></div>;
}

export function IssueTable({ compact = false }: { compact?: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "in-progress" | "blocked" | "resolved">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const visibleIssues = useMemo(() => issues.filter((issue) => (status === "all" || issue.status === status) && `${issue.id} ${issue.title} ${issue.assignee} ${issue.labels.join(" ")}`.toLowerCase().includes(query.toLowerCase())), [query, status]);

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return <div className="overflow-hidden rounded-[10px] border bg-card"><div className="flex flex-col gap-3 border-b border-border/80 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 flex-1 items-center gap-2"><div className="relative min-w-0 flex-1 sm:max-w-xs"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter issues..." className="h-8 pl-8 text-xs" aria-label="Filter issues" /></div><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"><option value="all">All statuses</option><option value="open">Open</option><option value="in-progress">In progress</option><option value="blocked">Blocked</option><option value="resolved">Resolved</option></select><Button variant="outline" size="sm" className="hidden h-8 gap-1.5 text-xs sm:inline-flex"><Filter className="h-3.5 w-3.5" /> More filters</Button></div><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-muted-foreground">{selected.length ? `${selected.length} selected` : `${visibleIssues.length} issues`}</span>{selected.length > 0 && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelected([])}>Clear</Button>}<Button size="sm" className="h-8 gap-1.5 text-xs"><Plus className="h-3.5 w-3.5" /> New issue</Button></div></div><div className="hidden min-w-[760px] grid-cols-[34px_84px_minmax(260px,1fr)_128px_92px_132px_84px] items-center gap-3 border-b border-border/70 bg-muted/35 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground sm:grid"><span /><span>Key</span><span>Issue</span><span>Status</span><span>Priority</span><span>Assignee</span><span>Updated</span></div><div className="overflow-x-auto">{visibleIssues.length ? visibleIssues.slice(0, compact ? 4 : undefined).map((issue) => <IssueRow key={issue.id} issue={issue} selected={selected.includes(issue.id)} onSelect={toggle} />) : <div className="px-6 py-12 text-center text-sm text-muted-foreground"><SlidersHorizontal className="mx-auto mb-3 h-5 w-5" />No issues match these filters.</div>}</div><div className="flex items-center justify-between border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground"><span>{compact ? "Showing latest activity" : "Saved view · Active issues"}</span><Link href="/dashboard/issues" className="flex items-center gap-1 font-medium text-primary hover:underline">View all <ChevronDown className="h-3 w-3 -rotate-90" /></Link></div></div>;
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Network, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Surface } from "@/components/tracebox/primitives";
import type { BlastRadiusResult } from "@/features/intelligence/blast-radius";

type State = { status: "idle" } | { status: "loading" } | { status: "success"; data: BlastRadiusResult } | { status: "error"; message: string };

export function BlastRadiusGraph({ issueId, projectKey, aiConfigured: _aiConfigured = true }: { issueId: string; projectKey: string; aiConfigured?: boolean }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function analyze() {
    if (state.status === "loading") return;
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/intelligence/blast-radius?issueId=${encodeURIComponent(issueId)}`);
      const payload = await response.json().catch(() => ({})) as { data?: BlastRadiusResult; message?: string };
      if (!response.ok || !payload.data) { setState({ status: "error", message: payload.message ?? "Could not load blast radius." }); return; }
      setState({ status: "success", data: payload.data });
    } catch { setState({ status: "error", message: "Could not reach the blast-radius service." }); }
  }

  return <Surface className="p-4" aria-labelledby={`blast-radius-${issueId}`}><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1.5"><Network className="h-3.5 w-3.5 text-primary" /><h2 id={`blast-radius-${issueId}`} className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Blast radius</h2></div><span className="font-mono text-[10px] text-muted-foreground">local graph · permission filtered</span></div>{state.status === "idle" ? <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void analyze()}><Network className="h-3.5 w-3.5" />Analyze impact</Button><span className="text-[11px] text-muted-foreground">Traverses visible blocking links only.</span></div> : state.status === "loading" ? <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite"><Loader2 className="h-3.5 w-3.5 animate-spin" />Calculating impact…</p> : state.status === "error" ? <div className="mt-3 flex flex-wrap items-center gap-2" role="alert"><AlertTriangle className="h-3.5 w-3.5 text-amber-300" /><span className="text-xs text-muted-foreground">{state.message}</span><Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => void analyze()}><RotateCcw className="h-3 w-3" />Retry</Button></div> : <BlastRadiusResultView data={state.data} projectKey={projectKey} />}</Surface>;
}

function BlastRadiusResultView({ data, projectKey }: { data: BlastRadiusResult; projectKey: string }) {
  const sorted = data.nodes.slice().sort((left, right) => left.depth - right.depth || (left.keyLabel ?? left.id).localeCompare(right.keyLabel ?? right.id));
  return <div className="mt-3"><div className="grid grid-cols-3 gap-2 text-xs"><Metric label="Downstream" value={data.transitiveBlocked} detail={`${data.directBlocked} direct`} /><Metric label="Components" value={data.affectedComponents} detail="affected" /><Metric label="Releases" value={data.affectedMilestones} detail={`${data.criticalIssues} critical`} /></div>{sorted.length > 1 ? <div className="mt-3 space-y-1"><p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Impact graph</p><ul role="tree" aria-label="Visible issue impact graph" className="space-y-1 rounded-lg border border-border/60 bg-background/50 p-2 font-mono text-xs">{sorted.map((node) => <li key={node.id} role="treeitem" aria-level={node.depth + 1} aria-selected={false} className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${Math.min(node.depth, 5) * 12}px` }}><span className="shrink-0 text-muted-foreground" aria-hidden="true">{node.depth === 0 ? "●" : "└─"}</span>{node.keyLabel ? <Link href={`/dashboard/issues/${node.keyLabel}`} className="shrink-0 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{node.keyLabel}</Link> : <span className="shrink-0 text-muted-foreground">Issue {node.id.slice(0, 8)}</span>}{node.title ? <span className="truncate text-muted-foreground">— {node.title}</span> : null}</li>)}</ul><p className="mt-2 font-mono text-[10px] text-muted-foreground">Max depth 5 · cycles are collapsed · restricted issues are omitted.</p></div> : <p className="mt-3 text-xs text-muted-foreground">No visible downstream blocking impact detected.</p>}</div>;
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) { return <div className="rounded-lg border border-border/60 bg-background/50 p-2 text-center"><p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}</p><p className="font-mono text-[10px] text-muted-foreground">{detail}</p></div>; }

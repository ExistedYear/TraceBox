"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import type { BlastRadiusResult } from "@/features/intelligence/blast-radius";

export function BlastRadiusGraph({ issueId, projectKey }: { issueId: string; projectKey: string }) {
  const [data, setData] = useState<BlastRadiusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/intelligence/blast-radius?issueId=${encodeURIComponent(issueId)}`);
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error(typeof payload.message === "string" ? payload.message : "Could not load blast radius.");
        }
        const payload = (await response.json()) as { data: BlastRadiusResult };
        if (!cancelled) setData(payload.data);
      } catch (error_) {
        if (!cancelled) setError(error_ instanceof Error ? error_.message : "Could not load blast radius.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [issueId]);

  if (loading) {
    return (
      <div className="rounded-[10px] border border-border/80 bg-card p-4">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Blast Radius</p>
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Calculating impact…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[10px] border border-border/80 bg-card p-4">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Blast Radius</p>
        <p className="mt-2 text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="rounded-[10px] border border-border/80 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Blast Radius</span>
        <span className="font-mono text-[10px] text-muted-foreground">local graph traversal</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-border/60 bg-background/50 p-2 text-center">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Downstream</p>
          <p className="text-lg font-semibold">{data.transitiveBlocked}</p>
          <p className="font-mono text-[10px] text-muted-foreground">{data.directBlocked} direct</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/50 p-2 text-center">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Components</p>
          <p className="text-lg font-semibold">{data.affectedComponents}</p>
          <p className="font-mono text-[10px] text-muted-foreground">affected</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/50 p-2 text-center">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Releases</p>
          <p className="text-lg font-semibold">{data.affectedMilestones}</p>
          <p className="font-mono text-[10px] text-muted-foreground">{data.criticalIssues} critical</p>
        </div>
      </div>

      {data.nodes.length > 1 ? (
        <div className="mt-3 space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Impact graph</p>
          <ul className="space-y-1 rounded-lg border border-border/60 bg-background/50 p-2 font-mono text-xs">
            {data.nodes
              .slice()
              .sort((left, right) => left.depth - right.depth)
              .map((node) => (
                <li key={node.id} className="flex items-center gap-2" style={{ paddingLeft: `${node.depth * 12}px` }}>
                  <span className="text-muted-foreground">{node.depth === 0 ? "●" : "├─"}</span>
                  {node.keyLabel ? (
                    <Link href={`/dashboard/issues/${projectKey}`} className="text-primary hover:underline">
                      {node.keyLabel}
                    </Link>
                  ) : (
                    <span className="truncate text-muted-foreground">{node.id.slice(0, 8)}</span>
                  )}
                  {node.title && <span className="truncate text-muted-foreground">— {node.title.slice(0, 60)}</span>}
                </li>
              ))}
          </ul>
          <p className="font-mono text-[10px] text-muted-foreground">Max depth 5 · cycle-safe · permission-filtered · restricted counts not leaked.</p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No downstream blocking impact detected.</p>
      )}
    </div>
  );
}

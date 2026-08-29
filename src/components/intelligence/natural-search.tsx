"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SearchParseResult } from "@/lib/ai/schemas/search";

type Props = {
  projectId: string;
  onApply: (filters: SearchParseResult) => void;
};

export function NaturalSearch({ projectId, onApply }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function parse() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/intelligence/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, query: query.trim() }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(typeof payload.message === "string" ? payload.message : "Natural-language parsing failed.");
      }
      const data = payload.data as SearchParseResult;
      setResult(data);
      onApply(data);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Parsing failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-[10px] border border-border/80 bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Natural Search</span>
        <span className="font-mono text-[10px] text-muted-foreground">AI → validated filters</span>
      </div>
      <div className="flex gap-2">
        <Input placeholder="critical auth regressions assigned to me blocking v2.8" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void parse(); }} />
        <Button size="sm" onClick={() => void parse()} disabled={loading || !query.trim()} className="h-9 shrink-0">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Parse"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-amber-600">{error} Use advanced filters instead.</p>}
      {result && (
        <div className="mt-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Trace AI understood:</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {result.priorities.map((priority) => <span key={priority} className="rounded-full border bg-muted px-2 py-0.5 font-mono text-[10px]">{priority}</span>)}
            {result.severities.map((severity) => <span key={severity} className="rounded-full border bg-muted px-2 py-0.5 font-mono text-[10px]">{severity}</span>)}
            {result.types.map((type) => <span key={type} className="rounded-full border bg-muted px-2 py-0.5 font-mono text-[10px]">{type}</span>)}
            {result.component_id && <span className="rounded-full border bg-muted px-2 py-0.5 font-mono text-[10px]">component:{result.component_id.slice(0, 6)}</span>}
            {result.assignee === "ME" && <span className="rounded-full border bg-muted px-2 py-0.5 font-mono text-[10px]">assigned to me</span>}
            {result.text && <span className="rounded-full border bg-muted px-2 py-0.5 font-mono text-[10px]">text: {result.text}</span>}
            {result.labels.length === 0 && result.priorities.length === 0 && result.severities.length === 0 && result.types.length === 0 && !result.text && !result.component_id && <span className="font-mono text-[10px] text-muted-foreground">No filters detected</span>}
          </div>
        </div>
      )}
    </div>
  );
}

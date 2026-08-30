"use client";

import { useState } from "react";
import { Loader2, Search, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SearchParseResult } from "@/lib/ai/schemas/search";

type NamedOption = { value: string; label: string };
type Props = { projectId: string; onApply: (filters: SearchParseResult) => void; aiConfigured?: boolean; options: { states: NamedOption[]; components: NamedOption[]; members: NamedOption[]; versions: NamedOption[]; milestones: NamedOption[]; labels: NamedOption[]; customFields: NamedOption[] } };
type Chip = { key: string; label: string; remove: () => void };

export function NaturalSearch({ projectId, onApply, aiConfigured = true, options }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function parse() {
    if (!query.trim() || !aiConfigured || loading) return;
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/intelligence/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, query: query.trim(), analyze: true }) });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok || !payload.data || typeof payload.data !== "object") { setError(typeof payload.message === "string" ? payload.message : "Natural-language parsing failed."); return; }
      setResult(payload.data as SearchParseResult);
    } catch { setError("Natural-language parsing is temporarily unavailable."); }
    finally { setLoading(false); }
  }

  function chips(): Chip[] {
    if (!result) return [];
    const items: Chip[] = [];
    const names = (values: NamedOption[]) => new Map(values.map((option) => [option.value, option.label]));
    const stateNames = names(options.states); const componentNames = names(options.components); const memberNames = names(options.members); const versionNames = names(options.versions); const milestoneNames = names(options.milestones); const labelNames = names(options.labels); const fieldNames = names(options.customFields);
    const add = (key: string, label: string, remove: () => void) => items.push({ key, label, remove });
    result.priorities.forEach((value) => add(`priority-${value}`, `priority: ${value}`, () => setResult({ ...result, priorities: result.priorities.filter((item: string) => item !== value) })));
    result.severities.forEach((value) => add(`severity-${value}`, `severity: ${value}`, () => setResult({ ...result, severities: result.severities.filter((item: string) => item !== value) })));
    result.types.forEach((value) => add(`type-${value}`, `type: ${value}`, () => setResult({ ...result, types: result.types.filter((item: string) => item !== value) })));
    result.statuses.forEach((value) => add(`status-${value}`, `status: ${stateNames.get(value) ?? "Unknown"}`, () => setResult({ ...result, statuses: result.statuses.filter((item: string) => item !== value) })));
    result.resolutions.forEach((value) => add(`resolution-${value}`, `resolution: ${value}`, () => setResult({ ...result, resolutions: result.resolutions.filter((item: string) => item !== value) })));
    result.labels.forEach((value) => add(`label-${value}`, `label: ${labelNames.get(value) ?? "Unknown"}`, () => setResult({ ...result, labels: result.labels.filter((item: string) => item !== value) })));
    if (result.component_id) add("component", `component: ${componentNames.get(result.component_id) ?? "Unknown"}`, () => setResult({ ...result, component_id: null }));
    if (result.affected_version_id) add("version", `version: ${versionNames.get(result.affected_version_id) ?? "Unknown"}`, () => setResult({ ...result, affected_version_id: null }));
    if (result.target_milestone_id) add("milestone", `milestone: ${milestoneNames.get(result.target_milestone_id) ?? "Unknown"}`, () => setResult({ ...result, target_milestone_id: null }));
    if (result.assignee) add("assignee", `assignee: ${result.assignee === "ME" ? "me" : memberNames.get(result.assignee) ?? "Unknown"}`, () => setResult({ ...result, assignee: null }));
    if (result.reporter) add("reporter", `reporter: ${result.reporter === "ME" ? "me" : memberNames.get(result.reporter) ?? "Unknown"}`, () => setResult({ ...result, reporter: null }));
    result.status_categories.forEach((value) => add(`category-${value}`, `status group: ${value.toLowerCase().replaceAll("_", " ")}`, () => setResult({ ...result, status_categories: result.status_categories.filter((item) => item !== value) })));
    if (result.visibility) add("visibility", `visibility: ${result.visibility.toLowerCase()}`, () => setResult({ ...result, visibility: null }));
    if (result.custom_field_id) add("custom-field", `field: ${fieldNames.get(result.custom_field_id) ?? "Unknown"}${result.custom_value ? ` = ${result.custom_value}` : ""}`, () => setResult({ ...result, custom_field_id: null, custom_value: null }));
    for (const [key, label, value] of [["created-from", "created after", result.created_from], ["created-to", "created before", result.created_to], ["updated-from", "updated after", result.updated_from], ["updated-to", "updated before", result.updated_to]] as const) if (value) add(key, `${label}: ${value}`, () => setResult({ ...result, [key.replace("-", "_")]: null }));
    if (result.unresolved) add("unresolved", "unresolved", () => setResult({ ...result, unresolved: false }));
    if (result.overdue) add("overdue", "overdue", () => setResult({ ...result, overdue: false }));
    if (result.critical) add("critical", "critical", () => setResult({ ...result, critical: false }));
    if (result.text) add("text", `text: ${result.text}`, () => setResult({ ...result, text: null }));
    return items;
  }

  return <section className="rounded-[10px] border border-border/80 bg-card p-3" aria-labelledby={`natural-search-${projectId}`}>
    <div className="mb-2 flex flex-wrap items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /><h2 id={`natural-search-${projectId}`} className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Natural search</h2><span className="font-mono text-[10px] text-muted-foreground">AI → validated filters</span></div>
    {!aiConfigured ? <p className="text-xs leading-5 text-muted-foreground">Natural search is unavailable in this environment. Use the labeled filters below.</p> : <><div className="flex flex-col gap-2 sm:flex-row"><label htmlFor="natural-issue-search" className="sr-only">Describe the issues to find</label><Input id="natural-issue-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void parse(); }} placeholder="critical auth regressions assigned to me…" className="h-8 text-xs" /><Button type="button" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={() => void parse()} disabled={loading || !query.trim()}>{loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Parsing…</> : <><Search className="h-3.5 w-3.5" />Parse</>}</Button></div>{error ? <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200"><span>{error} Use advanced filters instead.</span><Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => void parse()}>Retry</Button></div> : null}{result ? <div className="mt-3 rounded-lg border border-border/60 bg-background/50 p-2.5"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Editable interpretation</p><button type="button" className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setResult(null)}>Clear</button></div><div className="mt-2 flex flex-wrap gap-1.5">{chips().length > 0 ? chips().map((chip) => <button type="button" key={chip.key} onClick={chip.remove} className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-1 font-mono text-[10px] text-primary hover:bg-primary/20" aria-label={`Remove ${chip.label}`}>{chip.label}<X className="h-3 w-3" /></button>) : <span className="text-xs text-muted-foreground">No filters detected. The issue search text remains editable.</span>}</div><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" size="sm" className="h-8 text-xs" onClick={() => onApply(result)}>Apply filters</Button><span className="text-[11px] text-muted-foreground">Applies through the existing issue table URL contract.</span></div></div> : null}</>}
  </section>;
}

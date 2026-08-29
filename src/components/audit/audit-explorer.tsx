"use client";

import { useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export type AuditRow = {
  id: string;
  issue_id: string;
  actor_id: string | null;
  event_type: string;
  field_name: string | null;
  old_value: unknown;
  new_value: unknown;
  metadata: unknown;
  created_at: string;
  total_count: number;
};

export type AuditOption = { value: string; label: string };

const PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function displayValue(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unavailable]";
  }
}

function csvValue(value: unknown) {
  return `"${displayValue(value).replaceAll('"', '""')}"`;
}

type Props = {
  projectId: string;
  initialRows: AuditRow[];
  initialTotal: number;
  actors: AuditOption[];
  actions: AuditOption[];
  issues: AuditOption[];
};

export function AuditExplorer({ projectId, initialRows, initialTotal, actors, actions, issues }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0);
  const [actor, setActor] = useState("");
  const [event, setEvent] = useState("");
  const [issue, setIssue] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(false);

  const filterArgs = (limit: number, offset: number) => ({
    p_project_id: projectId,
    p_limit: limit,
    p_offset: offset,
    p_actor_id: actor || undefined,
    p_event_type: event || undefined,
    p_issue_id: issue || undefined,
    p_from: from ? `${from}T00:00:00.000Z` : undefined,
    p_to: to ? new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86400000).toISOString() : undefined,
  });

  const load = async (nextPage = 0) => {
    if ((actor && !UUID_PATTERN.test(actor)) || (issue && !UUID_PATTERN.test(issue))) {
      setValidationError("Choose a valid actor or issue.");
      return;
    }
    if (from && to && from > to) {
      setValidationError("Choose an end date on or after the start date.");
      return;
    }
    setValidationError(null);
    setLoading(true);
    setError(false);
    const { data, error: rpcError } = await createClient().rpc("list_project_audit_events", filterArgs(PAGE_SIZE, nextPage * PAGE_SIZE));
    if (rpcError) {
      console.error("Audit events load failed", { code: rpcError.code, message: rpcError.message });
      setError(true);
      toast.error("Audit events could not be loaded.");
    } else {
      const nextRows = (data ?? []) as AuditRow[];
      setRows(nextRows);
      setTotal(nextRows[0]?.total_count ?? 0);
      setPage(nextPage);
    }
    setLoading(false);
  };

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    setValidationError(null);
    const exported: AuditRow[] = [];
    let offset = 0;
    let filteredTotal = total;
    try {
      while (exported.length < MAX_EXPORT_ROWS && offset < Math.max(filteredTotal, 1)) {
        const { data, error: rpcError } = await createClient().rpc("list_project_audit_events", filterArgs(EXPORT_PAGE_SIZE, offset));
        if (rpcError) throw rpcError;
        const batch = (data ?? []) as AuditRow[];
        if (batch.length === 0) break;
        exported.push(...batch);
        filteredTotal = batch[0]?.total_count ?? filteredTotal;
        offset += batch.length;
        if (batch.length < EXPORT_PAGE_SIZE) break;
      }
      const header = ["event_id", "issue_id", "actor_id", "action", "field", "before", "after", "metadata", "created_at"];
      const lines = exported.slice(0, MAX_EXPORT_ROWS).map((row) => [row.id, row.issue_id, row.actor_id ?? "", row.event_type, row.field_name ?? "", row.old_value, row.new_value, row.metadata, row.created_at].map(csvValue).join(","));
      const url = URL.createObjectURL(new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "tracebox-audit.csv";
      anchor.click();
      URL.revokeObjectURL(url);
      if (filteredTotal > MAX_EXPORT_ROWS) toast.info(`Exported the first ${MAX_EXPORT_ROWS.toLocaleString()} of ${filteredTotal.toLocaleString()} matching events.`);
    } catch (rpcError) {
      const errorValue = rpcError as { code?: string; message?: string };
      console.error("Audit CSV export failed", { code: errorValue.code, message: errorValue.message });
      toast.error("The filtered audit export could not be prepared.");
    } finally {
      setExporting(false);
    }
  }

  const issueLabels = useMemo(() => new Map(issues.map((option) => [option.value, option.label])), [issues]);

  return (
    <Surface>
      <div className="flex flex-wrap items-end gap-3 border-b border-border/70 p-4">
        <div><label htmlFor="audit-actor" className="text-[10px] text-muted-foreground">Actor</label><select id="audit-actor" className="mt-1 h-8 w-52 rounded-md border border-input bg-background px-2 text-xs" value={actor} onChange={(event) => setActor(event.target.value)}><option value="">All actors</option>{actors.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
        <div><label htmlFor="audit-event" className="text-[10px] text-muted-foreground">Action</label><select id="audit-event" className="mt-1 h-8 w-52 rounded-md border border-input bg-background px-2 text-xs" value={event} onChange={(event) => setEvent(event.target.value)}><option value="">All actions</option>{actions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
        <div><label htmlFor="audit-issue" className="text-[10px] text-muted-foreground">Issue</label><select id="audit-issue" className="mt-1 h-8 w-64 rounded-md border border-input bg-background px-2 text-xs" value={issue} onChange={(event) => setIssue(event.target.value)}><option value="">All issues</option>{issues.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
        <div><label htmlFor="audit-from" className="text-[10px] text-muted-foreground">From</label><Input id="audit-from" type="date" className="mt-1 h-8 w-36 text-xs" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
        <div><label htmlFor="audit-to" className="text-[10px] text-muted-foreground">Through</label><Input id="audit-to" type="date" className="mt-1 h-8 w-36 text-xs" value={to} onChange={(event) => setTo(event.target.value)} /></div>
        <Button size="sm" className="h-8 text-xs" onClick={() => void load(0)} disabled={loading || exporting}>{loading ? <RefreshCw className="mr-1 h-3 w-3 animate-spin" /> : null}Apply</Button>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => void exportCsv()} disabled={loading || exporting || !total}><Download className="h-3 w-3" />{exporting ? "Preparing…" : "CSV"}</Button>
        {validationError && <p role="alert" className="basis-full text-xs text-destructive">{validationError}</p>}
      </div>

      {error ? <div role="alert" className="p-8 text-center text-xs text-muted-foreground">Audit events could not be loaded. <Button variant="link" size="sm" onClick={() => void load(page)}>Retry</Button></div> : rows.length === 0 ? <p className="p-10 text-center text-xs text-muted-foreground">No authorized audit events match these filters.</p> : <>
        <div className="divide-y divide-border/60">
          {rows.map((row) => <div key={row.id} className="grid gap-2 px-4 py-3 text-xs sm:grid-cols-[150px_minmax(120px,1fr)_minmax(180px,1.5fr)_180px]">
            <div><p className="font-mono text-primary">{row.event_type}</p><p className="mt-1 text-muted-foreground">{row.field_name ?? "event"}</p></div>
            <span className="min-w-0 truncate text-muted-foreground">{issueLabels.get(row.issue_id) ?? "Authorized issue"}</span>
            <div className="min-w-0"><p className="truncate text-muted-foreground">Actor {actors.find((option) => option.value === row.actor_id)?.label ?? (row.actor_id ? "Project member" : "System")}</p><p className="mt-1 break-words text-muted-foreground">Before: {displayValue(row.old_value)}</p><p className="break-words text-muted-foreground">After: {displayValue(row.new_value)}</p><p className="mt-1 break-words text-muted-foreground">Metadata: {displayValue(row.metadata)}</p></div>
            <time className="text-muted-foreground">{new Date(row.created_at).toLocaleString()}</time>
          </div>)}
        </div>
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-3 text-xs text-muted-foreground"><span>{total.toLocaleString()} authorized events · showing {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0 || loading || exporting} onClick={() => void load(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total || loading || exporting} onClick={() => void load(page + 1)}>Next</Button></div></div>
      </>}
    </Surface>
  );
}

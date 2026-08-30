import Link from "next/link";
import { ChevronRight, Eye, KeyRound, ShieldAlert } from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { formatIssueKey, humanizeEnum, personLabel } from "@/lib/issues";
import { formatDateTime } from "@/lib/date-format";

export type SecurityIssue = {
  id: string;
  issue_number: number;
  title: string;
  severity: string;
  priority: string;
  updated_at: string;
  status: { name: string; category: string } | null;
};

export type SecurityAccessEvent = {
  id: string;
  issue_id: string;
  actor_id: string | null;
  event_type: string;
  old_value: unknown;
  new_value: unknown;
  metadata: unknown;
  created_at: string;
};

function targetId(event: SecurityAccessEvent) {
  const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata as Record<string, unknown> : null;
  if (typeof metadata?.target_user_id === "string") return metadata.target_user_id;
  const value = event.event_type === "ACCESS_REVOKED" ? event.old_value : event.new_value;
  return typeof value === "string" ? value : null;
}

function eventLabel(event: SecurityAccessEvent, names: Map<string, string>) {
  const action = event.event_type === "ACCESS_GRANTED" ? "Granted access to" : "Revoked access from";
  const target = targetId(event);
  const targetName = target ? personLabel(names.get(target), target) : "an account";
  const actorName = personLabel(names.get(event.actor_id ?? ""), event.actor_id);
  return `${action} ${targetName} · by ${actorName}`;
}

export function SecurityIssueQueue({ projectKey, issues, accessEvents, names }: { projectKey: string; issues: SecurityIssue[]; accessEvents: SecurityAccessEvent[]; names: Map<string, string> }) {
  const eventsByIssue = new Map<string, SecurityAccessEvent[]>();
  for (const event of accessEvents) eventsByIssue.set(event.issue_id, [...(eventsByIssue.get(event.issue_id) ?? []), event]);

  return (
    <section aria-label="Restricted security issues" className="space-y-4">
      {issues.length === 0 ? (
        <Surface className="p-10 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-emerald-400" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">No restricted issues</h2>
          <p className="mt-1 text-xs text-muted-foreground">Restricted issues you are authorized to view will appear here.</p>
        </Surface>
      ) : issues.map((issue) => {
        const history = eventsByIssue.get(issue.id) ?? [];
        const key = formatIssueKey(projectKey, issue.issue_number);
        return (
          <Surface key={issue.id} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-300"><ShieldAlert className="h-3 w-3" /> Restricted</span>
                  <span className="font-mono text-xs text-primary">{key}</span>
                  <span className="text-[11px] text-muted-foreground">{issue.status?.name ?? "Unknown status"}</span>
                </div>
                <h2 className="mt-2 truncate text-base font-semibold">{issue.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{humanizeEnum(issue.severity)} severity · {issue.priority} priority · updated {formatDateTime(issue.updated_at)}</p>
              </div>
              <Link href={`/dashboard/issues/${key}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/80 px-2.5 text-xs font-medium transition-colors hover:bg-accent"><Eye className="h-3.5 w-3.5" /> Open <ChevronRight className="h-3.5 w-3.5" /></Link>
            </div>
            <div className="mt-4 border-t border-border/70 pt-3">
              <div className="flex items-center gap-2"><KeyRound className="h-3.5 w-3.5 text-primary" /><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Access history</h3></div>
              {history.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No access changes recorded yet.</p> : <ol className="mt-2 space-y-2">{history.map((event) => <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">{eventLabel(event, names)}</span><time className="font-mono text-[10px] text-muted-foreground/70" dateTime={event.created_at}>{formatDateTime(event.created_at)}</time></li>)}</ol>}
            </div>
          </Surface>
        );
      })}
    </section>
  );
}

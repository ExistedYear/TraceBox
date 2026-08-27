import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { CommentsSection } from "@/components/issues/comments-section";
import { IssueLinksSection } from "@/components/issues/issue-links-section";
import { IssuePlanningSection } from "@/components/issues/issue-planning-section";
import { IssueStatusTransition } from "@/components/issues/issue-status-transition";
import { IssueWatchButton } from "@/components/issues/issue-watch-button";
import { createClient } from "@/lib/supabase/server";
import { formatIssueKey, parseIssueKey, personLabel } from "@/lib/issues";
import type { TimelineComment, TimelineEventRow } from "@/lib/issues";
import { displayNameMap } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

type Params = Promise<{ issueKey: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { issueKey } = await params;
  return { title: issueKey.toUpperCase() };
}

export default async function IssueDetailPage({ params }: { params: Params }) {
  const { issueKey: rawKey } = await params;
  const parsed = parseIssueKey(rawKey);
  if (!parsed) notFound();

  const context = await getWorkspaceContext();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("organization_id", context.activeOrganization.id)
    .eq("key", parsed.projectKey)
    .eq("is_archived", false)
    .maybeSingle();
  if (!project) notFound();

  const { data: issue } = await supabase
    .from("issues")
    .select("* , status:workflow_states (name, category), component:components (id, name)")
    .eq("project_id", project.id)
    .eq("issue_number", parsed.issueNumber)
    .maybeSingle();
  if (!issue) notFound();

  const [
    { data: events },
    { data: comments },
    { data: componentRows },
    { data: viewerRole },
    { data: workflowStateRows },
    { data: transitionRows },
    { data: labelRows },
    { data: assignedLabelRows },
    { data: versionRows },
    { data: milestoneRows },
    { data: watcherRows },
  ] = await Promise.all([
    supabase.from("issue_events").select("*").eq("issue_id", issue.id).order("created_at").limit(100),
    supabase.from("comments").select("*").eq("issue_id", issue.id).order("created_at"),
    supabase.from("components").select("id, name").eq("project_id", project.id),
    supabase.rpc("project_role", { p_project_id: project.id }),
    supabase.from("workflow_states").select("id, name, category").eq("project_id", project.id).order("position"),
    supabase.from("workflow_transitions").select("to_state_id").eq("project_id", project.id).eq("from_state_id", issue.status_id),
    supabase.from("labels").select("id, name, color").eq("project_id", project.id).order("name"),
    supabase.from("issue_labels").select("label_id").eq("issue_id", issue.id),
    supabase.from("versions").select("id, name, is_released").eq("project_id", project.id).eq("is_archived", false).order("name"),
    supabase.from("milestones").select("id, name, status").eq("project_id", project.id).order("name"),
    supabase.from("issue_watchers").select("user_id").eq("issue_id", issue.id),
  ]);

  const componentNames = new Map((componentRows ?? []).map((component) => [component.id, component.name]));
  const actorIds = (events ?? []).map((event) => event.actor_id);
  const commentAuthorIds = (comments ?? []).map((comment) => comment.author_id);
  const mergedNames = await displayNameMap([issue.reporter_id, issue.assignee_id, ...actorIds, ...commentAuthorIds]);
  const canComment = viewerRole === "REPORTER" || viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER";
  const canEditAnyComment = viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER";

  const issueKeyLabel = formatIssueKey(parsed.projectKey, issue.issue_number);
  const facts: [string, string][] = [
    ["Status", issue.status?.name ?? "—"],
    ["Resolution", issue.resolution ?? "—"],
    ["Priority", issue.priority],
    ["Severity", issue.severity],
    ["Type", issue.type],
    ["Component", issue.component?.name ?? "—"],
    ["Assignee", personLabel(mergedNames.get(issue.assignee_id ?? ""), issue.assignee_id)],
    ["Reporter", personLabel(mergedNames.get(issue.reporter_id), issue.reporter_id)],
    ["Visibility", issue.visibility],
    ["Created", new Date(issue.created_at).toLocaleString()],
    ["Updated", new Date(issue.updated_at).toLocaleString()],
  ];
  const sections: [string, string | null][] = [
    ["Steps to reproduce", issue.steps_to_reproduce],
    ["Expected behaviour", issue.expected_behavior],
    ["Actual behaviour", issue.actual_behavior],
    ["Environment", issue.environment],
  ];

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          <Link href="/dashboard/issues" className="hover:text-foreground">{parsed.projectKey} · issues</Link>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              <span className="font-mono text-primary">{issueKeyLabel}</span> · {issue.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{issue.type} · {issue.severity} · {issue.priority}</p>
          </div>
          <div className="flex items-center gap-2">
            <IssueWatchButton
              issueId={issue.id}
              initialWatching={(watcherRows ?? []).some((w) => w.user_id === context.userId)}
              initialWatcherCount={watcherRows?.length ?? 0}
            />
            <IssueStatusTransition
              issueId={issue.id}
              projectKey={parsed.projectKey}
              issueNumber={issue.issue_number}
              currentStatusId={issue.status_id}
              currentStatusName={issue.status?.name ?? "—"}
              currentStatusCategory={issue.status?.category ?? "OPEN"}
              currentResolution={issue.resolution}
              states={(workflowStateRows ?? []).map((s) => ({ id: s.id, name: s.name, category: s.category }))}
              allowedTransitions={(transitionRows ?? []).map((t) => ({ toStateId: t.to_state_id }))}
              canTransition={viewerRole === "REPORTER" || viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER"}
              isMaintainer={viewerRole === "MAINTAINER"}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          <Surface className="p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</h2>
            <p className="whitespace-pre-wrap text-sm leading-6">{issue.description ?? "No description provided."}</p>
          </Surface>

          {sections.filter(([, value]) => Boolean(value)).map(([label, value]) => (
            <Surface key={label} className="p-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
              <p className="whitespace-pre-wrap text-sm leading-6">{value}</p>
            </Surface>
          ))}

          <CommentsSection
            issueId={issue.id}
            projectKey={parsed.projectKey}
            currentUserId={context.userId}
            canComment={canComment}
            canEditAnyComment={canEditAnyComment}
            comments={(comments ?? []) as unknown as TimelineComment[]}
            events={(events ?? []) as unknown as TimelineEventRow[]}
            displayNames={mergedNames}
            componentNames={componentNames}
          />
        </div>

        <aside className="space-y-3">
          <Surface className="p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Planning & Labels</h2>
            <IssuePlanningSection
              issueId={issue.id}
              canEdit={viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER"}
              assignedLabelIds={(assignedLabelRows ?? []).map((r) => r.label_id)}
              allLabels={(labelRows ?? []).map((l) => ({ id: l.id, name: l.name, color: l.color }))}
              affectedVersionId={issue.affected_version_id}
              allVersions={(versionRows ?? []).map((v) => ({ id: v.id, name: v.name, is_released: v.is_released }))}
              targetMilestoneId={issue.target_milestone_id}
              allMilestones={(milestoneRows ?? []).map((m) => ({ id: m.id, name: m.name, status: m.status }))}
            />
          </Surface>

          <Surface className="p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linked Issues</h2>
            <IssueLinksSection issueId={issue.id} projectId={project.id} projectKey={parsed.projectKey} canEdit={viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER"} />
          </Surface>

          <Surface className="p-4">
            <dl className="space-y-2.5 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="max-w-[60%] truncate text-right font-medium" title={value}>{value}</dd>
                </div>
              ))}
            </dl>
          </Surface>
          <Button asChild variant="outline" className="w-full">
            <Link href={`/dashboard/issues/${issueKeyLabel}`}>Refresh</Link>
          </Button>
        </aside>
      </div>
    </main>
  );
}

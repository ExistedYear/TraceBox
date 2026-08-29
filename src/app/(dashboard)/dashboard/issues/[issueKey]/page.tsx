import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Clock3 } from "lucide-react";
import { Surface } from "@/components/tracebox/primitives";
import { LoadErrorPage } from "@/components/tracebox/load-error";
import { Button } from "@/components/ui/button";
import { CommentsSection } from "@/components/issues/comments-section";
import { IssueAttachmentsSection } from "@/components/issues/issue-attachments-section";
import { IssueCustomFieldsSection } from "@/components/issues/issue-custom-fields-section";
import { MarkdownContent } from "@/components/tracebox/markdown-content";
import { IssueGithubLinksSection } from "@/components/issues/issue-github-links-section";
import { IssueLinksSection } from "@/components/issues/issue-links-section";
import { IssueSecuritySection } from "@/components/issues/issue-security-section";
import { IssuePlanningSection } from "@/components/issues/issue-planning-section";
import { IssueStatusTransition } from "@/components/issues/issue-status-transition";
import { IssueWatchButton } from "@/components/issues/issue-watch-button";
import { IssueEditForm } from "@/components/issues/issue-edit-form";
import { IssueRealtimeRefresh } from "@/components/issues/issue-realtime-refresh";
import { createClient } from "@/lib/supabase/server";
import { formatIssueKey, parseIssueKey, personLabel } from "@/lib/issues";
import type { TimelineComment, TimelineEventRow } from "@/lib/issues";
import { displayNameMap } from "@/lib/server-people";
import type { CommentMention } from "@/lib/comment-mentions";
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

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("organization_id", context.activeOrganization.id)
    .eq("key", parsed.projectKey)
    .eq("is_archived", false)
    .maybeSingle();
  if (projectError) {
    console.error("Issue project lookup failed", { code: projectError.code, message: projectError.message });
    return <LoadErrorPage title="Issue unavailable" description="We could not verify the project for this issue." retryHref={`/dashboard/issues/${rawKey}`} />;
  }
  if (!project) notFound();

  const { data: issue, error: issueError } = await supabase
    .from("issues")
    .select("* , status:workflow_states (name, category), component:components (id, name)")
    .eq("project_id", project.id)
    .eq("issue_number", parsed.issueNumber)
    .maybeSingle();
  if (issueError) {
    console.error("Issue detail lookup failed", { code: issueError.code, message: issueError.message });
    return <LoadErrorPage title="Issue unavailable" description="We could not load this issue. Your access was not inferred from an empty result." retryHref={`/dashboard/issues/${rawKey}`} />;
  }
  if (!issue) notFound();

  const [
    { data: events, error: eventsError },
    { data: comments, error: commentsError },
    { data: componentRows, error: componentsError },
    { data: viewerRole, error: roleError },
    { data: workflowStateRows, error: workflowStatesError },
    { data: transitionRows, error: transitionsError },
    { data: labelRows, error: labelsError },
    { data: assignedLabelRows, error: assignedLabelsError },
    { data: versionRows, error: versionsError },
    { data: milestoneRows, error: milestonesError },
    { data: watcherRows, error: watchersError },
    { data: attachmentRows, error: attachmentsError },
    { data: githubLinkRows, error: githubLinksError },
    { data: customFieldRows, error: customFieldsError },
    { data: customValueRows, error: customValuesError },
    { data: projectMemberRows, error: projectMembersError },
    { data: accessRows, error: accessError },
  ] = await Promise.all([
    supabase.from("issue_events").select("*").eq("issue_id", issue.id).order("created_at"),
    supabase.from("comments").select("*").eq("issue_id", issue.id).order("created_at"),
    supabase.from("components").select("id, name").eq("project_id", project.id),
    supabase.rpc("project_role", { p_project_id: project.id }),
    supabase.from("workflow_states").select("id, name, category").eq("project_id", project.id).order("position"),
    supabase.from("workflow_transitions").select("to_state_id, requires_resolution").eq("project_id", project.id).eq("from_state_id", issue.status_id),
    supabase.from("labels").select("id, name, color").eq("project_id", project.id).order("name"),
    supabase.from("issue_labels").select("label_id").eq("issue_id", issue.id),
    supabase.from("versions").select("id, name, is_released").eq("project_id", project.id).eq("is_archived", false).order("name"),
    supabase.from("milestones").select("id, name, status").eq("project_id", project.id).order("name"),
    supabase.from("issue_watchers").select("user_id").eq("issue_id", issue.id),
    supabase.from("attachments").select("*").eq("issue_id", issue.id).order("created_at"),
    (supabase as any).from("issue_github_links").select("id, repo_name, link_type, number, url, title, status, github_artifact_id, relationship, source, github_artifact:github_artifacts(head_branch, base_branch, author_login, head_sha, draft, merged, state, github_updated_at, last_synced_at, github_pr_check_summaries(total_count, completed_count, successful_count, failed_count, pending_count, state, checks, last_synced_at, error))").eq("issue_id", issue.id).order("created_at"),
    supabase.from("custom_fields").select("id, name, field_type, config, is_required").eq("project_id", project.id).order("name"),
    supabase.from("issue_custom_values").select("custom_field_id, value").eq("issue_id", issue.id),
    supabase.from("project_members").select("user_id").eq("project_id", project.id),
    supabase.from("issue_access").select("user_id, granted_by").eq("issue_id", issue.id),
  ]);
  let commentMentionRows: CommentMention[] = [];
  let mentionsError: { code: string; message: string } | null = null;
  if (!commentsError && (comments ?? []).length > 0) {
    const result = await supabase
      .from("comment_mentions")
      .select("comment_id, user_id, display_label, mention_token")
      .in("comment_id", (comments ?? []).map((comment) => comment.id));
    commentMentionRows = (result.data ?? []) as CommentMention[];
    mentionsError = result.error;
  }
  const loadError = eventsError ?? commentsError ?? mentionsError ?? componentsError ?? roleError ?? workflowStatesError ?? transitionsError ?? labelsError ?? assignedLabelsError ?? versionsError ?? milestonesError ?? watchersError ?? attachmentsError ?? githubLinksError ?? customFieldsError ?? customValuesError ?? projectMembersError ?? accessError;
  if (loadError) {
    console.error("Issue detail dependencies failed", { code: loadError.code, message: loadError.message });
    return <LoadErrorPage title="Issue details incomplete" description="We could not safely load the complete issue, activity, access, and planning data." retryHref={`/dashboard/issues/${rawKey}`} />;
  }
  const componentNames = new Map((componentRows ?? []).map((component) => [component.id, component.name]));
  const mentionsByComment = new Map<string, CommentMention[]>();
  for (const mention of commentMentionRows) {
    const existing = mentionsByComment.get(mention.comment_id) ?? [];
    existing.push(mention);
    mentionsByComment.set(mention.comment_id, existing);
  }
  const commentsWithMentions = (comments ?? []).map((comment) => ({ ...comment, mentions: mentionsByComment.get(comment.id) ?? [] }));
  const actorIds = (events ?? []).map((event) => event.actor_id);
  const commentAuthorIds = (comments ?? []).map((comment) => comment.author_id);
  const memberIds = (projectMemberRows ?? []).map((member) => member.user_id);
  const accessUserIds = (accessRows ?? []).map((grant) => grant.user_id);
  const mergedNames = await displayNameMap([issue.reporter_id, issue.assignee_id, ...actorIds, ...commentAuthorIds, ...memberIds, ...accessUserIds]);
  const canComment = viewerRole === "REPORTER" || viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER";
  const canEditAnyComment = viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER";
  const canEditIssue = viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER" || issue.reporter_id === context.userId;

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
    <main className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
      <IssueRealtimeRefresh projectId={project.id} issueId={issue.id} enabled={!canEditIssue} />
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/dashboard/issues" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Issues</Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />
        <span className="font-mono text-primary">{issueKeyLabel}</span>
      </nav>

      <div className="mb-6 border-b border-border/80 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold tracking-wide text-primary">{issueKeyLabel}</span>
              <span className="rounded-full border border-border/80 bg-muted/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{issue.type}</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" /> Updated {new Date(issue.updated_at).toLocaleDateString()}</span>
            </div>
            <h1 className="mt-2 max-w-4xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{issue.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{issue.severity} severity · {issue.priority} priority · reported by {personLabel(mergedNames.get(issue.reporter_id), issue.reporter_id)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
              allowedTransitions={(transitionRows ?? []).map((t) => ({ toStateId: t.to_state_id, requiresResolution: t.requires_resolution }))}
              canTransition={viewerRole === "REPORTER" || viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER"}
              isMaintainer={viewerRole === "MAINTAINER"}
            />
          </div>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <Surface id="description" className="p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Description</h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">Issue context</span>
            </div>
            <MarkdownContent body={issue.description ?? "No description provided."} />
          </Surface>

          <IssueEditForm
            issueId={issue.id}
            projectId={project.id}
            expectedUpdatedAt={issue.updated_at}
            canEdit={canEditIssue}
            initialValues={{
              title: issue.title,
              description: issue.description,
              environment: issue.environment,
              steps_to_reproduce: issue.steps_to_reproduce,
              expected_behavior: issue.expected_behavior,
              actual_behavior: issue.actual_behavior,
              priority: issue.priority,
              severity: issue.severity,
              type: issue.type,
              assignee_id: issue.assignee_id,
              component_id: issue.component_id,
            }}
            components={(componentRows ?? []).map((component) => ({ id: component.id, name: component.name }))}
            members={(projectMemberRows ?? []).map((member) => ({ userId: member.user_id, displayName: mergedNames.get(member.user_id) ?? member.user_id.slice(0, 8) }))}
          />

          {sections.map(([label, value]) => value ? (
            <Surface key={label} className="p-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
              <MarkdownContent body={value} />
            </Surface>
          ) : null)}

          <IssueAttachmentsSection key={`attachments-${issue.id}`}
            issueId={issue.id}
            canUpload={canComment}
            currentUserId={context.userId}
            isMaintainerOrDev={canEditAnyComment}
            initialAttachments={attachmentRows ?? []}
          />
          <IssueCustomFieldsSection key={`custom-${issue.id}`}
            issueId={issue.id}
            fields={(customFieldRows ?? []) as any}
            initialValues={(customValueRows ?? []) as any}
            canEdit={viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER"}
            members={(projectMemberRows ?? []).map((member) => ({ id: member.user_id, label: mergedNames.get(member.user_id) ?? member.user_id.slice(0, 8) }))}
          />

          <CommentsSection key={`comments-${issue.id}`}
            issueId={issue.id}
            projectId={project.id}
            projectKey={parsed.projectKey}
            currentUserId={context.userId}
            canComment={canComment}
            canEditAnyComment={canEditAnyComment}
            comments={commentsWithMentions as unknown as TimelineComment[]}
            events={(events ?? []) as unknown as TimelineEventRow[]}
            displayNames={mergedNames}
            componentNames={componentNames}
          />
        </div>

        <aside className="space-y-3 lg:sticky lg:top-[4.5rem]">
          <Surface id="issue-details" className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Details</h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">Facts</span>
            </div>
            <dl className="divide-y divide-border/70 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <dt className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 truncate text-right text-xs font-medium" title={value}>{value}</dd>
                </div>
              ))}
            </dl>
          </Surface>

          <Surface className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Planning & labels</h2>
            <IssuePlanningSection key={`planning-${issue.id}`}
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
            <IssueGithubLinksSection key={`github-${issue.id}`}
              issueId={issue.id}
              projectId={project.id}
              canEdit={viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER"}
              initialLinks={(githubLinkRows ?? []) as any}
            />
          </Surface>
          <IssueSecuritySection key={`security-${issue.id}`}
            issueId={issue.id}
            canEdit={canEditIssue}
            initialVisibility={issue.visibility}
            initialGrants={(accessRows ?? []) as any}
            members={(projectMemberRows ?? []).map((member) => ({ userId: member.user_id, label: mergedNames.get(member.user_id) ?? member.user_id.slice(0, 8) }))}
          />

          <Surface className="p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linked Issues</h2>
            <IssueLinksSection
              key={`links-${issue.id}`}
              issueId={issue.id}
              projectId={project.id}
              projectKey={parsed.projectKey}
              canEdit={viewerRole === "DEVELOPER" || viewerRole === "MAINTAINER"}
            />
          </Surface>

          <Button asChild variant="outline" className="w-full">
            <Link href={`/dashboard/issues/${issueKeyLabel}`}>Refresh</Link>
          </Button>
        </aside>
      </div>
    </main>
  );
}

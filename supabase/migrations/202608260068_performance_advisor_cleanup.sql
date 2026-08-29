-- Resolve concrete hosted performance-advisor findings. Unused-index notices
-- are deliberately excluded because the project has too little production
-- traffic for those statistics to justify destructive index removal.

create index if not exists api_tokens_organization_id_idx on public.api_tokens (organization_id);
create index if not exists github_installations_installed_by_idx on public.github_installations (installed_by);
create index if not exists github_webhook_retry_requests_requested_by_idx on public.github_webhook_retry_requests (requested_by);
create index if not exists issue_links_created_by_idx on public.issue_links (created_by);
create index if not exists issue_templates_created_by_idx on public.issue_templates (created_by);
create index if not exists issues_reporter_id_idx on public.issues (reporter_id);
create index if not exists membership_events_actor_id_idx on public.membership_events (actor_id);
create index if not exists membership_events_target_user_id_idx on public.membership_events (target_user_id);
create index if not exists notifications_actor_id_idx on public.notifications (actor_id);
create index if not exists project_events_actor_id_idx on public.project_events (actor_id);
create index if not exists project_github_repositories_created_by_idx on public.project_github_repositories (created_by);
create index if not exists projects_created_by_idx on public.projects (created_by);
create index if not exists release_readiness_snapshots_created_by_idx on public.release_readiness_snapshots (created_by);
create index if not exists release_readiness_snapshots_milestone_id_idx on public.release_readiness_snapshots (milestone_id);
create index if not exists release_readiness_snapshots_version_id_idx on public.release_readiness_snapshots (version_id);
create index if not exists workspace_invitations_accepted_by_idx on public.workspace_invitations (accepted_by);
create index if not exists workspace_invitations_invited_by_idx on public.workspace_invitations (invited_by);
create index if not exists workspace_invitations_project_id_idx on public.workspace_invitations (project_id);

drop policy if exists "Users can read own api tokens" on public.api_tokens;
create policy "Users can read own api tokens"
  on public.api_tokens for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Creators can read their readiness snapshots" on public.release_readiness_snapshots;
create policy "Creators can read their readiness snapshots"
  on public.release_readiness_snapshots for select to authenticated
  using (created_by = (select auth.uid()) and public.is_project_member(project_id));

drop policy if exists "Project members and grantees can read issue watchers" on public.issue_watchers;

drop index if exists public.idx_issue_links_target_issue_id;
drop index if exists public.idx_issues_affected_version_id;
drop index if exists public.idx_issues_target_milestone_id;

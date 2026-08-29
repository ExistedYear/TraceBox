-- Migration 079: reconcile contracts proven by disposable-database CI.
--
-- Keep issue visibility total (never NULL) and retire legacy/default direct
-- browser DML grants now that every mutation path is RPC-owned.

create or replace function public.can_view_issue(p_issue_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_issue record;
  v_role text;
begin
  if v_user is null then return false; end if;

  select i.id, i.project_id, i.reporter_id, i.assignee_id,
         coalesce(i.visibility, 'PROJECT') as visibility
    into v_issue
    from public.issues i
   where i.id = p_issue_id;

  if not found or not public.is_project_member(v_issue.project_id) then return false; end if;

  v_role := public.project_role(v_issue.project_id);
  if v_role = 'MAINTAINER' or public.can_manage_project(v_issue.project_id) then return true; end if;
  if v_issue.visibility in ('PROJECT', 'PUBLIC') then return true; end if;

  return v_issue.reporter_id = v_user
    or coalesce(v_issue.assignee_id = v_user, false)
    or exists (
      select 1
        from public.issue_access ia
       where ia.issue_id = p_issue_id
         and ia.user_id = v_user
    );
end;
$$;

revoke execute on function public.can_view_issue(uuid) from public, anon;
grant execute on function public.can_view_issue(uuid) to authenticated;

revoke insert, update, delete on table
  public.profiles,
  public.organizations,
  public.organization_members,
  public.projects,
  public.project_members,
  public.membership_events,
  public.workspace_invitations,
  public.components,
  public.workflow_states,
  public.workflow_transitions,
  public.issues,
  public.issue_events,
  public.comments,
  public.comment_mentions,
  public.labels,
  public.issue_labels,
  public.versions,
  public.milestones,
  public.issue_watchers,
  public.notifications,
  public.notification_preferences,
  public.saved_views,
  public.issue_links,
  public.attachments,
  public.issue_templates,
  public.issue_template_labels,
  public.issue_access,
  public.custom_fields,
  public.issue_custom_values,
  public.api_tokens,
  public.readiness_snapshots
from public, anon, authenticated;

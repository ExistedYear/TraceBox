-- Migration 024: Deep full-codebase audit hardening
-- 1. Revoke public/authenticated execution on internal notification dispatcher
-- 2. Add missing foreign key indexes for performance
-- 3. Harden unwatch_issue with project membership authorization
-- 4. Add ISSUE_UNLINKED audit logging to remove_issue_link

-- 1. Security: Revoke direct client RPC access to internal dispatcher
revoke execute on function public.dispatch_issue_notification(uuid, uuid, uuid, text, jsonb) from anon, authenticated, public;

-- 2. Performance: Add secondary indexes on foreign key columns
create index if not exists idx_notifications_issue_id on public.notifications(issue_id);
create index if not exists idx_issue_events_actor_id on public.issue_events(actor_id);
create index if not exists idx_issues_affected_version_id on public.issues(affected_version_id);
create index if not exists idx_issues_target_milestone_id on public.issues(target_milestone_id);
create index if not exists idx_issue_links_target_issue_id on public.issue_links(target_issue_id);

-- 3. Access Control: Harden unwatch_issue with project membership check
create or replace function public.unwatch_issue(p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select project_id into v_project_id
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.issue_watchers
  where issue_id = p_issue_id and user_id = v_user;
end;
$$;

revoke execute on function public.unwatch_issue(uuid) from anon, public;
grant execute on function public.unwatch_issue(uuid) to authenticated;

-- 4. Audit Logging: Add ISSUE_UNLINKED audit event to remove_issue_link
create or replace function public.remove_issue_link(
  p_link_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_link record;
  v_source_project_id uuid;
  v_target_project_id uuid;
  v_source_key text;
  v_target_key text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select il.*,
         s.project_id as source_project_id, s.issue_number as source_number, sp.key as source_proj_key,
         t.project_id as target_project_id, t.issue_number as target_number, tp.key as target_proj_key
  into v_link
  from public.issue_links il
  join public.issues s on s.id = il.source_issue_id
  join public.projects sp on sp.id = s.project_id
  join public.issues t on t.id = il.target_issue_id
  join public.projects tp on tp.id = t.project_id
  where il.id = p_link_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Require developer/maintainer on both projects
  if not public.can_manage_project(v_link.source_project_id) and public.project_role(v_link.source_project_id) not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if not public.can_manage_project(v_link.target_project_id) and public.project_role(v_link.target_project_id) not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.issue_links
  where id = p_link_id;

  v_source_key := v_link.source_proj_key || '-' || v_link.source_number;
  v_target_key := v_link.target_proj_key || '-' || v_link.target_number;

  -- Audit event on source issue
  insert into public.issue_events (
    issue_id, actor_id, event_type, field_name, old_value, metadata
  ) values (
    v_link.source_issue_id,
    v_user,
    'ISSUE_UNLINKED',
    'issue_link',
    to_jsonb(v_target_key),
    jsonb_build_object(
      'relationship', v_link.relationship,
      'target_issue_id', v_link.target_issue_id,
      'target_key', v_target_key
    )
  );

  -- Audit event on target issue
  insert into public.issue_events (
    issue_id, actor_id, event_type, field_name, old_value, metadata
  ) values (
    v_link.target_issue_id,
    v_user,
    'ISSUE_UNLINKED',
    'issue_link',
    to_jsonb(v_source_key),
    jsonb_build_object(
      'relationship', v_link.relationship,
      'source_issue_id', v_link.source_issue_id,
      'source_key', v_source_key
    )
  );
end;
$$;

revoke execute on function public.remove_issue_link(uuid) from anon, public;
grant execute on function public.remove_issue_link(uuid) to authenticated;

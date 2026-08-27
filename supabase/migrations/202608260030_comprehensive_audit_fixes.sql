-- Migration 030: Comprehensive Audit Fixes
-- 1. Normalize visibility check constraint and can_view_issue
-- 2. Project boundary and lock check on set_issue_custom_value
-- 3. can_view_issue enforcement across mutating RPCs
-- 4. RLS child metadata policy alignment
-- 5. REPLICA IDENTITY FULL for realtime tables

-- 1. Visibility check constraint & can_view_issue normalization
alter table public.issues drop constraint if exists issues_visibility_check;
alter table public.issues add constraint issues_visibility_check
  check (visibility in ('PUBLIC', 'PROJECT', 'RESTRICTED'));

create or replace function public.can_view_issue(p_issue_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_issue record;
  v_role text;
begin
  if v_user is null then
    return false;
  end if;

  select i.id, i.project_id, i.reporter_id, i.assignee_id, coalesce(i.visibility, 'PROJECT') as visibility
  into v_issue
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    return false;
  end if;

  -- Maintainer / org admin always has access to all project issues
  v_role := public.project_role(v_issue.project_id);
  if v_role = 'MAINTAINER' or public.can_manage_project(v_issue.project_id) then
    return true;
  end if;

  -- Project / Public issues are viewable by all active project members
  if v_issue.visibility in ('PUBLIC', 'PROJECT') and public.is_project_member(v_issue.project_id) then
    return true;
  end if;

  -- Restricted issues: reporter, assignee, or explicit access grantee
  if v_issue.reporter_id = v_user or v_issue.assignee_id = v_user then
    return true;
  end if;

  if exists (
    select 1 from public.issue_access ia
    where ia.issue_id = p_issue_id and ia.user_id = v_user
  ) then
    return true;
  end if;

  return false;
end;
$$;

revoke execute on function public.can_view_issue(uuid) from anon, public;
grant execute on function public.can_view_issue(uuid) to authenticated;

-- 2. Custom Field Validation & Locking
create or replace function public.set_issue_custom_value(
  p_issue_id uuid,
  p_custom_field_id uuid,
  p_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_issue record;
  v_archived boolean;
  v_role text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select project_id into v_issue
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select is_archived into v_archived
  from public.projects
  where id = v_issue.project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if not public.can_view_issue(p_issue_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Ensure custom field belongs to the same project
  if not exists (
    select 1 from public.custom_fields cf
    where cf.id = p_custom_field_id and cf.project_id = v_issue.project_id
  ) then
    raise exception 'VALIDATION: Custom field does not belong to this project' using errcode = '23503';
  end if;

  insert into public.issue_custom_values (issue_id, custom_field_id, value)
  values (p_issue_id, p_custom_field_id, p_value)
  on conflict (issue_id, custom_field_id)
  do update set value = excluded.value;
end;
$$;

revoke execute on function public.set_issue_custom_value(uuid, uuid, jsonb) from anon, public;
grant execute on function public.set_issue_custom_value(uuid, uuid, jsonb) to authenticated;

-- 3. RLS child metadata policies checking can_view_issue
drop policy if exists "Project members can read issue events" on public.issue_events;
create policy "Project members and grantees can read issue events"
  on public.issue_events
  for select
  to authenticated
  using (public.can_view_issue(issue_id));

drop policy if exists "Project members can read watchers" on public.issue_watchers;
create policy "Project members and grantees can read watchers"
  on public.issue_watchers
  for select
  to authenticated
  using (public.can_view_issue(issue_id));

drop policy if exists "Project members can read issue labels" on public.issue_labels;
create policy "Project members and grantees can read issue labels"
  on public.issue_labels
  for select
  to authenticated
  using (public.can_view_issue(issue_id));

-- 4. REPLICA IDENTITY FULL for realtime update target tables
alter table public.issues replica identity full;
alter table public.comments replica identity full;
alter table public.notifications replica identity full;
alter table public.issue_watchers replica identity full;
alter table public.issue_links replica identity full;
alter table public.issue_events replica identity full;
alter table public.attachments replica identity full;

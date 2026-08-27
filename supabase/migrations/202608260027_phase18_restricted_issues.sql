-- Migration 027: Phase 18 - Restricted Security Issues
-- Table, can_view_issue helper, RLS policies, and RPCs for restricted visibility issues

create table if not exists public.issue_access (
  issue_id uuid not null references public.issues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (issue_id, user_id)
);

comment on table public.issue_access is 'Explicit access grants for restricted security issues.';

create index if not exists idx_issue_access_user_id on public.issue_access(user_id, issue_id);

alter table public.issue_access enable row level security;

-- Helper function: can_view_issue
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

  select i.id, i.project_id, i.reporter_id, i.assignee_id, coalesce(i.visibility, 'PUBLIC') as visibility
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

  -- Public issues are viewable by all active project members
  if v_issue.visibility = 'PUBLIC' and public.is_project_member(v_issue.project_id) then
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

-- RLS Policy for issue_access
create policy "Grantees and maintainers can read issue access"
  on public.issue_access
  for select
  to authenticated
  using (public.can_view_issue(issue_id));

-- Update issues RLS SELECT policy
drop policy if exists "Project members can read issues" on public.issues;
drop policy if exists "Project members and access grantees can read issues" on public.issues;

create policy "Project members and access grantees can read issues"
  on public.issues
  for select
  to authenticated
  using (public.can_view_issue(id));

-- Update comments RLS SELECT policy
drop policy if exists "Project members can read comments" on public.comments;

create policy "Project members can read comments"
  on public.comments
  for select
  to authenticated
  using (public.can_view_issue(issue_id));

-- Update attachments RLS SELECT policy
drop policy if exists "Project members can read attachments" on public.attachments;

create policy "Project members can read attachments"
  on public.attachments
  for select
  to authenticated
  using (public.can_view_issue(issue_id));

-- RPC: grant_issue_access
create or replace function public.grant_issue_access(
  p_issue_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_issue record;
  v_role text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select project_id, reporter_id into v_issue
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') and v_issue.reporter_id <> v_user then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.issue_access (issue_id, user_id, granted_by)
  values (p_issue_id, p_user_id, v_user)
  on conflict do nothing;

  -- Add audit event
  insert into public.issue_events (
    issue_id, actor_id, event_type, field_name, new_value
  ) values (
    p_issue_id, v_user, 'ACCESS_GRANTED', 'issue_access', to_jsonb(p_user_id::text)
  );
end;
$$;

revoke execute on function public.grant_issue_access(uuid, uuid) from anon, public;
grant execute on function public.grant_issue_access(uuid, uuid) to authenticated;

-- RPC: revoke_issue_access
create or replace function public.revoke_issue_access(
  p_issue_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_issue record;
  v_role text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select project_id, reporter_id into v_issue
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') and v_issue.reporter_id <> v_user then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.issue_access
  where issue_id = p_issue_id and user_id = p_user_id;

  -- Add audit event
  insert into public.issue_events (
    issue_id, actor_id, event_type, field_name, old_value
  ) values (
    p_issue_id, v_user, 'ACCESS_REVOKED', 'issue_access', to_jsonb(p_user_id::text)
  );
end;
$$;

revoke execute on function public.revoke_issue_access(uuid, uuid) from anon, public;
grant execute on function public.revoke_issue_access(uuid, uuid) to authenticated;

-- RPC: set_issue_visibility
create or replace function public.set_issue_visibility(
  p_issue_id uuid,
  p_visibility text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_issue record;
  v_role text;
  v_vis text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_vis := upper(trim(coalesce(p_visibility, 'PUBLIC')));
  if v_vis not in ('PUBLIC', 'RESTRICTED') then
    raise exception 'VALIDATION: Visibility must be PUBLIC or RESTRICTED' using errcode = '22023';
  end if;

  select id, project_id, visibility, reporter_id into v_issue
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') and v_issue.reporter_id <> v_user then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  update public.issues
  set visibility = v_vis,
      updated_at = timezone('utc'::text, now())
  where id = p_issue_id;

  insert into public.issue_events (
    issue_id, actor_id, event_type, field_name, old_value, new_value
  ) values (
    p_issue_id, v_user, 'VISIBILITY_CHANGED', 'visibility', to_jsonb(v_issue.visibility), to_jsonb(v_vis)
  );
end;
$$;

revoke execute on function public.set_issue_visibility(uuid, text) from anon, public;
grant execute on function public.set_issue_visibility(uuid, text) to authenticated;

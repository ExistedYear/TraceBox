-- Migration 014: Fix create_project INSERT values expression count
-- Replaces create_project with the complete 6-column / 6-value expression list
-- including v_user as created_by to resolve PostgreSQL syntax error 42601.

create or replace function public.create_project(
  p_organization_id uuid,
  p_name text,
  p_key text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_state_triage uuid;
  v_state_open uuid;
  v_state_in_progress uuid;
  v_state_review uuid;
  v_state_resolved uuid;
  v_state_closed uuid;
  v_state_reopened uuid;
  v_name text;
  v_key text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_organization_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if not (
    public.is_org_admin(p_organization_id)
    or exists (
      select 1 from public.organizations o
      where o.id = p_organization_id and o.owner_id = v_user
    )
    or exists (
      select 1 from public.organization_members om
      where om.organization_id = p_organization_id
        and om.user_id = v_user
        and om.role in ('OWNER', 'ADMIN')
    )
  ) then
    raise exception 'NOT_ORG_ADMIN' using errcode = '42501';
  end if;

  -- Ensure caller profile exists to guarantee foreign key integrity
  insert into public.profiles (id, display_name)
  values (v_user, coalesce(auth.jwt()->>'display_name', split_part(coalesce(auth.jwt()->>'email', 'user'), '@', 1)))
  on conflict (id) do nothing;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  v_key := nullif(trim(coalesce(p_key, '')), '');

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  if v_key is null or char_length(v_key) < 2 or char_length(v_key) > 10 or upper(v_key) !~ '^[A-Z][A-Z0-9]+$' then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  insert into public.projects (organization_id, name, key, slug, description, created_by)
  values (
    p_organization_id,
    v_name,
    upper(v_key),
    lower(v_key),
    nullif(trim(coalesce(p_description, '')), ''),
    v_user
  )
  returning id into v_project_id;

  insert into public.project_members (project_id, user_id, role)
  values (v_project_id, v_user, 'MAINTAINER');

  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'Triage', 'TRIAGE', 0, true, false)
  returning id into v_state_triage;
  insert into public.workflow_states (project_id, name, category, position)
  values (v_project_id, 'Open', 'OPEN', 10)
  returning id into v_state_open;
  insert into public.workflow_states (project_id, name, category, position)
  values (v_project_id, 'In Progress', 'IN_PROGRESS', 20)
  returning id into v_state_in_progress;
  insert into public.workflow_states (project_id, name, category, position)
  values (v_project_id, 'In Review', 'REVIEW', 30)
  returning id into v_state_review;
  insert into public.workflow_states (project_id, name, category, position)
  values (v_project_id, 'Resolved', 'RESOLVED', 40)
  returning id into v_state_resolved;
  insert into public.workflow_states (project_id, name, category, position, is_terminal)
  values (v_project_id, 'Closed', 'CLOSED', 50, false, true)
  returning id into v_state_closed;
  insert into public.workflow_states (project_id, name, category, position)
  values (v_project_id, 'Reopened', 'OPEN', 60)
  returning id into v_state_reopened;

  insert into public.workflow_transitions (project_id, from_state_id, to_state_id) values
    (v_project_id, v_state_triage, v_state_open),
    (v_project_id, v_state_triage, v_state_in_progress),
    (v_project_id, v_state_open, v_state_in_progress),
    (v_project_id, v_state_open, v_state_resolved),
    (v_project_id, v_state_in_progress, v_state_review),
    (v_project_id, v_state_in_progress, v_state_resolved),
    (v_project_id, v_state_review, v_state_in_progress),
    (v_project_id, v_state_review, v_state_resolved),
    (v_project_id, v_state_resolved, v_state_closed),
    (v_project_id, v_state_resolved, v_state_reopened),
    (v_project_id, v_state_closed, v_state_reopened),
    (v_project_id, v_state_reopened, v_state_in_progress),
    (v_project_id, v_state_reopened, v_state_resolved);

  return v_project_id;
end;
$$;

revoke execute on function public.create_project(uuid, text, text, text) from anon, public;
grant execute on function public.create_project(uuid, text, text, text) to authenticated;

-- Phase 3: core issues with human-readable IDs and an immutable audit log.
-- affected_version_id/target_milestone_id arrive with versions/milestones (Phase 7).

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  issue_number bigint not null check (issue_number >= 1),
  title text not null check (char_length(title) between 1 and 200),
  description text,
  type text not null check (type in ('BUG', 'ENHANCEMENT', 'TASK', 'SECURITY', 'PERFORMANCE', 'REGRESSION')),
  status_id uuid not null references public.workflow_states (id),
  resolution text check (resolution in ('FIXED', 'DUPLICATE', 'WONT_FIX', 'INVALID', 'CANNOT_REPRODUCE', 'WORKS_AS_EXPECTED')),
  priority text not null default 'P2' check (priority in ('P0', 'P1', 'P2', 'P3', 'P4')),
  severity text not null default 'MAJOR' check (severity in ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL')),
  reporter_id uuid not null references public.profiles (id),
  assignee_id uuid references auth.users (id) on delete set null,
  component_id uuid references public.components (id) on delete set null,
  environment text,
  steps_to_reproduce text,
  expected_behavior text,
  actual_behavior text,
  visibility text not null default 'PROJECT' check (visibility in ('PROJECT', 'RESTRICTED')),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  resolved_at timestamptz,
  closed_at timestamptz,
  unique (project_id, issue_number)
);

create table if not exists public.issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  field_name text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.issues is 'Project issues; identity is PROJECTKEY-ISSUENUMBER.';
comment on table public.issue_events is 'Immutable audit trail written exclusively by trusted functions.';

create index if not exists issues_project_number_idx on public.issues (project_id, issue_number);
create index if not exists issues_project_updated_idx on public.issues (project_id, updated_at desc);
create index if not exists issues_status_idx on public.issues (status_id);
create index if not exists issues_assignee_idx on public.issues (assignee_id);
create index if not exists issues_component_idx on public.issues (component_id);
create index if not exists issue_events_issue_created_idx on public.issue_events (issue_id, created_at);

create trigger issues_set_updated_at
before update on public.issues
for each row execute procedure public.set_updated_at();

alter table public.issues enable row level security;
alter table public.issue_events enable row level security;

-- Role of a user inside a project: MAINTAINER/DEVELOPER/REPORTER/VIEWER or null.
create or replace function public.project_role(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select m.role from public.project_members m
      where m.project_id = p_project_id and m.user_id = auth.uid()
      limit 1
    ),
    case when public.is_org_admin(p_project_id) then 'MAINTAINER' end
  );
$$;

create or replace function public.can_view_issue(p_issue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.issues i
    where i.id = p_issue_id and public.is_project_member(i.project_id)
  );
$$;

revoke execute on function public.project_role(uuid), public.can_view_issue(uuid) from anon, public;
grant execute on function public.project_role(uuid), public.can_view_issue(uuid) to authenticated;

create policy "Project members can read issues"
  on public.issues
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "Reporters and above can file issues"
  on public.issues
  for insert
  to authenticated
  with check (
    (select auth.uid()) = reporter_id
    and public.project_role(project_id) in ('REPORTER', 'DEVELOPER', 'MAINTAINER')
  );

create policy "Project members can read the audit trail"
  on public.issue_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = issue_id and public.is_project_member(i.project_id)
    )
  );

-- Atomic issue creation: lock the counter row, allocate the number, write the
-- audit event. Returns the allocated issue_number so clients build KEY-N.
create or replace function public.create_issue(
  p_project_id uuid,
  p_title text,
  p_type text,
  p_description text default null,
  p_component_id uuid default null,
  p_priority text default 'P2',
  p_severity text default 'MAJOR',
  p_assignee_id uuid default null,
  p_environment text default null,
  p_steps_to_reproduce text default null,
  p_expected_behavior text default null,
  p_actual_behavior text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_number bigint;
  v_issue_id uuid;
  v_initial_state uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_role := public.project_role(p_project_id);
  if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_component_id is not null and not exists (
    select 1 from public.components c
    where c.id = p_component_id and c.project_id = p_project_id and not c.is_archived
  ) then
    raise exception 'INVALID_COMPONENT' using errcode = '23503';
  end if;

  select p.next_issue_number into v_number
  from public.projects p
  where p.id = p_project_id
  for update;

  update public.projects
  set next_issue_number = v_number + 1
  where id = p_project_id;

  select s.id into v_initial_state
  from public.workflow_states s
  where s.project_id = p_project_id
  order by s.is_initial desc, s.position
  limit 1;

  insert into public.issues (
    project_id, issue_number, title, description, type, status_id,
    priority, severity, reporter_id, assignee_id, component_id,
    environment, steps_to_reproduce, expected_behavior, actual_behavior
  ) values (
    p_project_id, v_number, p_title, nullif(trim(coalesce(p_description, '')), ''), p_type, v_initial_state,
    coalesce(p_priority, 'P2'), coalesce(p_severity, 'MAJOR'), v_user,
    p_assignee_id, p_component_id,
    nullif(p_environment, ''), nullif(p_steps_to_reproduce, ''),
    nullif(p_expected_behavior, ''), nullif(p_actual_behavior, '')
  )
  returning id into v_issue_id;

  insert into public.issue_events (issue_id, actor_id, event_type, metadata)
  values (
    v_issue_id,
    v_user,
    'ISSUE_CREATED',
    jsonb_build_object('title', p_title, 'type', p_type, 'priority', coalesce(p_priority, 'P2'), 'severity', coalesce(p_severity, 'MAJOR'))
  );

  return v_number;
end;
$$;

revoke execute on function public.create_issue(uuid, text, text, text, uuid, text, text, uuid, text, text, text, text) from anon, public;
grant execute on function public.create_issue(uuid, text, text, text, uuid, text, text, uuid, text, text, text, text) to authenticated;

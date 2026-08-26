-- Phase 2: project components and the default issue workflow.
-- Workflow states carry a category (TRIAGE/OPEN/IN_PROGRESS/REVIEW/RESOLVED/CLOSED);
-- the visible name may differ. Transitions are seeded per plan §10; resolution
-- requirements derive from the target state's category at transition time.

create table if not exists public.components (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 280),
  default_assignee_id uuid references public.profiles (id) on delete set null,
  is_archived boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (project_id, name)
);

create table if not exists public.workflow_states (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  category text not null check (category in ('TRIAGE', 'OPEN', 'IN_PROGRESS', 'REVIEW', 'RESOLVED', 'CLOSED')),
  position integer not null check (position >= 0),
  color text,
  is_initial boolean not null default false,
  is_terminal boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (project_id, name),
  unique (project_id, position)
);

create table if not exists public.workflow_transitions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  from_state_id uuid not null references public.workflow_states (id) on delete cascade,
  to_state_id uuid not null references public.workflow_states (id) on delete cascade,
  required_role text check (required_role in ('MAINTAINER', 'DEVELOPER', 'REPORTER', 'VIEWER')),
  created_at timestamptz not null default timezone('utc'::text, now()),
  check (from_state_id <> to_state_id),
  unique (project_id, from_state_id, to_state_id)
);

comment on table public.components is 'Project components with optional default assignee.';
comment on table public.workflow_states is 'Per-project workflow states ordered by position.';
comment on table public.workflow_transitions is 'Allowed state-to-state moves per project.';

create index if not exists components_project_id_idx on public.components (project_id);
create index if not exists workflow_states_project_id_idx on public.workflow_states (project_id);
create index if not exists workflow_transitions_project_id_idx on public.workflow_transitions (project_id);

create trigger components_set_updated_at
before update on public.components
for each row execute procedure public.set_updated_at();

alter table public.components enable row level security;
alter table public.workflow_states enable row level security;
alter table public.workflow_transitions enable row level security;

create policy "Project members can read components"
  on public.components
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "Maintainers manage components"
  on public.components
  for insert
  to authenticated
  with check (public.can_manage_project(project_id));

create policy "Maintainers update components"
  on public.components
  for update
  to authenticated
  using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));

create policy "Maintainers delete components"
  on public.components
  for delete
  to authenticated
  using (public.can_manage_project(project_id));

create policy "Project members can read workflow states"
  on public.workflow_states
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "Project members can read workflow transitions"
  on public.workflow_transitions
  for select
  to authenticated
  using (public.is_project_member(project_id));

-- Extend transactional project creation with the default workflow (plan §10).
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
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if not public.is_org_admin(p_organization_id) then
    raise exception 'NOT_ORG_ADMIN' using errcode = '42501';
  end if;

  insert into public.projects (organization_id, name, key, slug, description, created_by)
  values (
    p_organization_id,
    p_name,
    upper(p_key),
    lower(p_key),
    nullif(trim(coalesce(p_description, '')), '')
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

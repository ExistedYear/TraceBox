create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  avatar_url text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.profiles is 'Public profile metadata for authenticated TraceBox users.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'user'), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;

create policy "Authenticated users can read profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
-- Phase 1: organizations, members, projects, project members.
-- Access model: organization roles OWNER/ADMIN/MEMBER/VIEWER, project roles
-- MAINTAINER/DEVELOPER/REPORTER/VIEWER. Membership rows are managed exclusively
-- through the create_organization()/create_project() functions; clients never
-- write them directly.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  slug text not null unique check (char_length(slug) between 2 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'MEMBER' check (role in ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')),
  joined_at timestamptz not null default timezone('utc'::text, now()),
  primary key (organization_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  key text not null check (char_length(key) between 2 and 10 and key ~ '^[A-Z][A-Z0-9]+$'),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text check (char_length(description) <= 280),
  next_issue_number bigint not null default 1 check (next_issue_number >= 1),
  is_archived boolean not null default false,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (organization_id, slug),
  unique (organization_id, key)
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'DEVELOPER' check (role in ('MAINTAINER', 'DEVELOPER', 'REPORTER', 'VIEWER')),
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (project_id, user_id)
);

comment on table public.organizations is 'Top-level workspaces owned by a profile.';
comment on table public.organization_members is 'Workspace membership with OWNER/ADMIN/MEMBER/VIEWER roles.';
comment on table public.projects is 'Projects inside a workspace; issue keys are KEY-N.';
comment on table public.project_members is 'Project membership with MAINTAINER/DEVELOPER/REPORTER/VIEWER roles.';

create index if not exists organizations_owner_id_idx on public.organizations (owner_id);
create index if not exists organization_members_user_id_idx on public.organization_members (user_id);
create index if not exists projects_organization_id_idx on public.projects (organization_id);
create index if not exists project_members_user_id_idx on public.project_members (user_id);

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute procedure public.set_updated_at();

create trigger projects_set_updated_at
before update on public.projects
for each row execute procedure public.set_updated_at();

-- RLS helpers. SECURITY DEFINER so policies can consult membership without
-- recursing into the same tables' policies; they only read membership rows.
create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = auth.uid()
  )
  or exists (
    select 1 from public.organizations o
    where o.id = p_organization_id and o.owner_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.role in ('OWNER', 'ADMIN')
  );
$$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id and pm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.projects p
    where p.id = p_project_id and public.is_org_member(p.organization_id)
  );
$$;

create or replace function public.can_manage_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.role = 'MAINTAINER'
  )
  or exists (
    select 1 from public.projects p
    where p.id = p_project_id and public.is_org_admin(p.organization_id)
  );
$$;

revoke execute on function
  public.is_org_member(uuid),
  public.is_org_admin(uuid),
  public.is_project_member(uuid),
  public.can_manage_project(uuid)
from anon, public;
grant execute on function
  public.is_org_member(uuid),
  public.is_org_admin(uuid),
  public.is_project_member(uuid),
  public.can_manage_project(uuid)
to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;

create policy "Org members can read their organizations"
  on public.organizations
  for select
  to authenticated
  using (public.is_org_member(id));

create policy "Authenticated users can create organizations they own"
  on public.organizations
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Org admins can update their organizations"
  on public.organizations
  for update
  to authenticated
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

create policy "Members can read workspace membership"
  on public.organization_members
  for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_org_member(organization_id));

create policy "Org members can read their projects"
  on public.projects
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "Project maintainers and org admins can update projects"
  on public.projects
  for update
  to authenticated
  using (public.can_manage_project(id))
  with check (public.can_manage_project(id));

create policy "Project members can read project membership"
  on public.project_members
  for select
  to authenticated
  using (public.is_project_member(project_id));

-- Transactional onboarding mutations. Clients call these via RPC; direct
-- inserts into memberships are blocked by the absence of INSERT policies.
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_organization_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  insert into public.organizations (name, slug, owner_id)
  values (p_name, p_slug, v_user)
  returning id into v_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, v_user, 'OWNER');

  return v_organization_id;
end;
$$;

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

  return v_project_id;
end;
$$;

revoke execute on function
  public.create_organization(text, text),
  public.create_project(uuid, text, text, text)
from anon, public;
grant execute on function
  public.create_organization(text, text),
  public.create_project(uuid, text, text, text)
to authenticated;
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
-- Phase 4: inline field editing for issues. General fields require DEVELOPER or
-- MAINTAINER (plan §7 matrix). Each change appends an immutable audit event;
-- status transitions and resolution stay reserved for Phase 6.

create or replace function public.update_issue_fields(p_issue_id uuid, p_updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_old record;
  v_new_title text;
  v_new_value text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into v_old from public.issues where id = p_issue_id;

  if p_updates ? 'title' then
    v_new_title := nullif(trim(p_updates->>'title'), '');
    if v_new_title is null or char_length(v_new_title) > 200 then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_title is distinct from v_old.title then
      update public.issues set title = v_new_title where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TITLE_CHANGED', 'title', to_jsonb(v_old.title), to_jsonb(v_new_title));
    end if;
  end if;

  if p_updates ? 'priority' then
    v_new_value := p_updates->>'priority';
    if v_new_value not in ('P0', 'P1', 'P2', 'P3', 'P4') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.priority then
      update public.issues set priority = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'PRIORITY_CHANGED', 'priority', to_jsonb(v_old.priority), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'severity' then
    v_new_value := p_updates->>'severity';
    if v_new_value not in ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.severity then
      update public.issues set severity = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'SEVERITY_CHANGED', 'severity', to_jsonb(v_old.severity), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'type' then
    v_new_value := p_updates->>'type';
    if v_new_value not in ('BUG', 'ENHANCEMENT', 'TASK', 'SECURITY', 'PERFORMANCE', 'REGRESSION') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.type then
      update public.issues set type = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TYPE_CHANGED', 'type', to_jsonb(v_old.type), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'component_id' then
    v_new_value := nullif(p_updates->>'component_id', '');
    if v_new_value is not null and not exists (
      select 1 from public.components c
      where c.id = v_new_value::uuid and c.project_id = v_project_id
    ) then
      raise exception 'INVALID_COMPONENT' using errcode = '23503';
    end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.component_id::text, '') then
      update public.issues set component_id = v_new_value::uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'COMPONENT_CHANGED', 'component_id',
              case when v_old.component_id is null then to_jsonb(null::text) else to_jsonb(v_old.component_id::text) end,
              to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'assignee_id' then
    v_new_value := nullif(p_updates->>'assignee_id', '');
    if v_new_value is not null and not exists (
      select 1 from public.project_members m
      where m.user_id = v_new_value::uuid and m.project_id = v_project_id
    ) then
      raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
    end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.assignee_id::text, '') then
      update public.issues set assignee_id = v_new_value::uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ASSIGNEE_CHANGED', 'assignee_id',
              case when v_old.assignee_id is null then to_jsonb(null::text) else to_jsonb(v_old.assignee_id::text) end,
              to_jsonb(v_new_value));
    end if;
  end if;
end;
$$;

revoke execute on function public.update_issue_fields(uuid, jsonb) from anon, public;
grant execute on function public.update_issue_fields(uuid, jsonb) to authenticated;
-- Security & integrity hardening from the phase-4 audit.
-- Strategy: clients mutate rows only through trusted RPCs; direct table writes
-- are narrowed to safe columns; ownership truth is unified on owner_id + roles;
-- destructive cascades become restricted deletes requiring explicit offboarding.

-- SQL-001: direct issue inserts bypassed counter allocation (number squatting
-- could permanently brick create_issue) and skipped the audit event.
drop policy if exists "Reporters and above can file issues" on public.issues;

-- SQL-002/006: one deleted account must never wipe a multi-user workspace, and
-- account deletion must not silently fail either. Ownership/history references
-- become RESTRICT: offboarding requires an explicit transfer flow.
alter table public.organizations
  drop constraint organizations_owner_id_fkey;
alter table public.organizations
  add constraint organizations_owner_id_fkey
  foreign key (owner_id) references public.profiles (id) on delete restrict;

alter table public.projects
  drop constraint projects_created_by_fkey;
alter table public.projects
  add constraint projects_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete restrict;

alter table public.issues
  drop constraint issues_reporter_id_fkey;
alter table public.issues
  add constraint issues_reporter_id_fkey
  foreign key (reporter_id) references public.profiles (id) on delete restrict;

-- SQL-003/004: row policies cannot protect individual columns. Strip UPDATE
-- from authenticated wholesale, then re-grant only safe columns. The definer
-- RPCs run as the migration owner and are unaffected.
revoke update on public.organizations from anon, authenticated, public;
grant update (name, slug) on public.organizations to authenticated;

revoke update on public.projects from anon, authenticated, public;
grant update (name, slug, description, is_archived) on public.projects to authenticated;

-- SQL-005/009: unify authorization helpers. project_role must resolve the org
-- through projects before consulting is_org_admin, and is_org_admin must honor
-- organizations.owner_id exactly like is_org_member does.
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
    case when public.is_org_admin(
      (select p.organization_id from public.projects p where p.id = p_project_id)
    ) then 'MAINTAINER' end
  );
$$;

create or replace function public.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_organization_id is not null and (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = p_organization_id
        and m.user_id = auth.uid()
        and m.role in ('OWNER', 'ADMIN')
    )
    or exists (
      select 1 from public.organizations o
      where o.id = p_organization_id and o.owner_id = auth.uid()
    )
  );
$$;

-- SQL-011: serialize audit capture with the field writes so old/new pairs are
-- always consistent under concurrent edits.
create or replace function public.update_issue_fields(p_issue_id uuid, p_updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_old record;
  v_new_title text;
  v_new_value text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into v_old from public.issues where id = p_issue_id for update;

  if p_updates ? 'title' then
    v_new_title := nullif(trim(p_updates->>'title'), '');
    if v_new_title is null or char_length(v_new_title) > 200 then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_title is distinct from v_old.title then
      update public.issues set title = v_new_title where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TITLE_CHANGED', 'title', to_jsonb(v_old.title), to_jsonb(v_new_title));
    end if;
  end if;

  if p_updates ? 'priority' then
    v_new_value := p_updates->>'priority';
    if v_new_value not in ('P0', 'P1', 'P2', 'P3', 'P4') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.priority then
      update public.issues set priority = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'PRIORITY_CHANGED', 'priority', to_jsonb(v_old.priority), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'severity' then
    v_new_value := p_updates->>'severity';
    if v_new_value not in ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.severity then
      update public.issues set severity = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'SEVERITY_CHANGED', 'severity', to_jsonb(v_old.severity), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'type' then
    v_new_value := p_updates->>'type';
    if v_new_value not in ('BUG', 'ENHANCEMENT', 'TASK', 'SECURITY', 'PERFORMANCE', 'REGRESSION') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.type then
      update public.issues set type = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TYPE_CHANGED', 'type', to_jsonb(v_old.type), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'component_id' then
    v_new_value := nullif(p_updates->>'component_id', '');
    if v_new_value is not null and not exists (
      select 1 from public.components c
      where c.id = v_new_value::uuid and c.project_id = v_project_id
    ) then
      raise exception 'INVALID_COMPONENT' using errcode = '23503';
    end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.component_id::text, '') then
      update public.issues set component_id = v_new_value::uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'COMPONENT_CHANGED', 'component_id',
              case when v_old.component_id is null then to_jsonb(null::text) else to_jsonb(v_old.component_id::text) end,
              to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'assignee_id' then
    v_new_value := nullif(p_updates->>'assignee_id', '');
    if v_new_value is not null and not exists (
      select 1 from public.project_members m
      where m.user_id = v_new_value::uuid and m.project_id = v_project_id
    ) then
      raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
    end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.assignee_id::text, '') then
      update public.issues set assignee_id = v_new_value::uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ASSIGNEE_CHANGED', 'assignee_id',
              case when v_old.assignee_id is null then to_jsonb(null::text) else to_jsonb(v_old.assignee_id::text) end,
              to_jsonb(v_new_value));
    end if;
  end if;
end;
$$;

-- SQL-007: creation path must enforce the same assignee-membership rule as the
-- edit path. (Full function re-declaration keeps the diff reviewable.)
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

  if p_assignee_id is not null and not exists (
    select 1 from public.project_members m
    where m.user_id = p_assignee_id and m.project_id = p_project_id
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
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

-- SQL-008: unique(project_id, issue_number) already backs an identical index.
drop index if exists public.issues_project_number_idx;
-- Round-2 audit guards: archived projects reject writes; archived components
-- are rejected consistently; assignee eligibility matches implicit roles;
-- profile bootstrap cannot abort on oversized provider metadata.

-- R2-SQL-001/002: archived targets are invisible to every UI surface, so both
-- trusted write paths must refuse them explicitly.
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

  if exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.is_archived
  ) then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  if p_component_id is not null and not exists (
    select 1 from public.components c
    where c.id = p_component_id and c.project_id = p_project_id and not c.is_archived
  ) then
    raise exception 'INVALID_COMPONENT' using errcode = '23503';
  end if;

  if p_assignee_id is not null and not exists (
    select 1 from public.project_members m
    where m.user_id = p_assignee_id and m.project_id = p_project_id
  )
  and not public.is_org_admin((
    select p.organization_id from public.projects p where p.id = p_project_id
  )) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
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

create or replace function public.update_issue_fields(p_issue_id uuid, p_updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_old record;
  v_new_title text;
  v_new_value text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.projects p
    where p.id = v_project_id and p.is_archived
  ) then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  select * into v_old from public.issues where id = p_issue_id for update;

  if p_updates ? 'title' then
    v_new_title := nullif(trim(p_updates->>'title'), '');
    if v_new_title is null or char_length(v_new_title) > 200 then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_title is distinct from v_old.title then
      update public.issues set title = v_new_title where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TITLE_CHANGED', 'title', to_jsonb(v_old.title), to_jsonb(v_new_title));
    end if;
  end if;

  if p_updates ? 'priority' then
    v_new_value := p_updates->>'priority';
    if v_new_value not in ('P0', 'P1', 'P2', 'P3', 'P4') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.priority then
      update public.issues set priority = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'PRIORITY_CHANGED', 'priority', to_jsonb(v_old.priority), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'severity' then
    v_new_value := p_updates->>'severity';
    if v_new_value not in ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.severity then
      update public.issues set severity = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'SEVERITY_CHANGED', 'severity', to_jsonb(v_old.severity), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'type' then
    v_new_value := p_updates->>'type';
    if v_new_value not in ('BUG', 'ENHANCEMENT', 'TASK', 'SECURITY', 'PERFORMANCE', 'REGRESSION') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.type then
      update public.issues set type = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TYPE_CHANGED', 'type', to_jsonb(v_old.type), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'component_id' then
    v_new_value := nullif(p_updates->>'component_id', '');
    if v_new_value is not null and not exists (
      select 1 from public.components c
      where c.id = v_new_value::uuid and c.project_id = v_project_id and not c.is_archived
    ) then
      raise exception 'INVALID_COMPONENT' using errcode = '23503';
    end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.component_id::text, '') then
      update public.issues set component_id = v_new_value::uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'COMPONENT_CHANGED', 'component_id',
              case when v_old.component_id is null then to_jsonb(null::text) else to_jsonb(v_old.component_id::text) end,
              to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'assignee_id' then
    v_new_value := nullif(p_updates->>'assignee_id', '');
    if v_new_value is not null and not (
      exists (
        select 1 from public.project_members m
        where m.user_id = v_new_value::uuid and m.project_id = v_project_id
      )
      or public.is_org_admin((
        select p.organization_id from public.projects p where p.id = v_project_id
      ))
    ) then
      raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
    end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.assignee_id::text, '') then
      update public.issues set assignee_id = v_new_value::uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ASSIGNEE_CHANGED', 'assignee_id',
              case when v_old.assignee_id is null then to_jsonb(null::text) else to_jsonb(v_old.assignee_id::text) end,
              to_jsonb(v_new_value));
    end if;
  end if;
end;
$$;

-- R2-SQL-005: provider metadata is attacker-controlled length-wise; clamp so a
-- >120-char OAuth display name can never abort user creation.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'user'), '@', 1)), 120),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- R2-SQL-003: components are archive-only for clients. Direct DELETE would
-- cascade component_id=null across issues with no audit trail; retiring the
-- policy keeps the "audit rows come only from trusted functions" invariant.
drop policy if exists "Maintainers delete components" on public.components;
-- Round-3 refinements: race-free archival checks, candidate-scoped assignee
-- eligibility, no-op-safe component updates, and component column hardening.
-- Lock ordering is uniformly project-row first, then issue row.

-- R3-SQL-003: prevent relocating a component across projects (dual-maintainer
-- move would silently break issue↔component coupling and leak names).
revoke update on public.components from anon, authenticated, public;
grant update (name, description, default_assignee_id, is_archived) on public.components to authenticated;

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
  v_archived boolean;
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

  -- Single locked read closes the archive-vs-write race window.
  select next_issue_number, is_archived
  into v_number, v_archived
  from public.projects
  where id = p_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  if p_component_id is not null and not exists (
    select 1 from public.components c
    where c.id = p_component_id and c.project_id = p_project_id and not c.is_archived
  ) then
    raise exception 'INVALID_COMPONENT' using errcode = '23503';
  end if;

  -- Assignee eligibility is a property of the CANDIDATE: explicit membership
  -- or an implicit MAINTAINER via organization ownership/admin.
  if p_assignee_id is not null and not (
    exists (
      select 1 from public.project_members m
      where m.user_id = p_assignee_id and m.project_id = p_project_id
    )
    or exists (
      select 1
      from public.projects p
      join public.organizations o on o.id = p.organization_id
      left join public.organization_members om
        on om.organization_id = o.id and om.user_id = p_assignee_id
      where p.id = p_project_id
        and (o.owner_id = p_assignee_id or om.role in ('OWNER', 'ADMIN'))
    )
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
  end if;

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

create or replace function public.update_issue_fields(p_issue_id uuid, p_updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_old record;
  v_new_title text;
  v_new_value text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock project first (consistent order), then the issue row, so archival is
  -- evaluated under the same serialization as every other write.
  select is_archived into v_archived
  from public.projects
  where id = v_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  select * into v_old from public.issues where id = p_issue_id for update;

  if p_updates ? 'title' then
    v_new_title := nullif(trim(p_updates->>'title'), '');
    if v_new_title is null or char_length(v_new_title) > 200 then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_title is distinct from v_old.title then
      update public.issues set title = v_new_title where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TITLE_CHANGED', 'title', to_jsonb(v_old.title), to_jsonb(v_new_title));
    end if;
  end if;

  if p_updates ? 'priority' then
    v_new_value := p_updates->>'priority';
    if v_new_value not in ('P0', 'P1', 'P2', 'P3', 'P4') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.priority then
      update public.issues set priority = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'PRIORITY_CHANGED', 'priority', to_jsonb(v_old.priority), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'severity' then
    v_new_value := p_updates->>'severity';
    if v_new_value not in ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.severity then
      update public.issues set severity = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'SEVERITY_CHANGED', 'severity', to_jsonb(v_old.severity), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'type' then
    v_new_value := p_updates->>'type';
    if v_new_value not in ('BUG', 'ENHANCEMENT', 'TASK', 'SECURITY', 'PERFORMANCE', 'REGRESSION') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.type then
      update public.issues set type = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TYPE_CHANGED', 'type', to_jsonb(v_old.type), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'component_id' then
    v_new_value := nullif(p_updates->>'component_id', '');
    -- No-op detection first so re-confirming an already-attached (possibly
    -- since-archived) component never errors.
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.component_id::text, '') then
      if v_new_value is not null and not exists (
        select 1 from public.components c
        where c.id = v_new_value::uuid and c.project_id = v_project_id and not c.is_archived
      ) then
        raise exception 'INVALID_COMPONENT' using errcode = '23503';
      end if;
      update public.issues set component_id = v_new_value::uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'COMPONENT_CHANGED', 'component_id',
              case when v_old.component_id is null then to_jsonb(null::text) else to_jsonb(v_old.component_id::text) end,
              to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'assignee_id' then
    v_new_value := nullif(p_updates->>'assignee_id', '');
    if v_new_value is not null and not (
      exists (
        select 1 from public.project_members m
        where m.user_id = v_new_value::uuid and m.project_id = v_project_id
      )
      or exists (
        select 1
        from public.projects p
        join public.organizations o on o.id = p.organization_id
        left join public.organization_members om
          on om.organization_id = o.id and om.user_id = v_new_value::uuid
        where p.id = v_project_id
          and (o.owner_id = v_new_value::uuid or om.role in ('OWNER', 'ADMIN'))
      )
    ) then
      raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
    end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.assignee_id::text, '') then
      update public.issues set assignee_id = v_new_value::uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ASSIGNEE_CHANGED', 'assignee_id',
              case when v_old.assignee_id is null then to_jsonb(null::text) else to_jsonb(v_old.assignee_id::text) end,
              to_jsonb(v_new_value));
    end if;
  end if;
end;
$$;

-- Components are archive-only and their default assignee must belong to the
-- same project or be an owner/admin of its organization.
create or replace function public.validate_component_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.is_archived
  ) then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  if new.default_assignee_id is not null and not (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = new.project_id and pm.user_id = new.default_assignee_id
    )
    or exists (
      select 1
      from public.projects p
      join public.organizations o on o.id = p.organization_id
      left join public.organization_members om
        on om.organization_id = o.id and om.user_id = new.default_assignee_id
      where p.id = new.project_id
        and (o.owner_id = new.default_assignee_id or om.role in ('OWNER', 'ADMIN'))
    )
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_component_assignment() from anon, public;
grant execute on function public.validate_component_assignment() to authenticated;

drop trigger if exists components_validate_assignment on public.components;
create trigger components_validate_assignment
before insert or update on public.components
for each row execute procedure public.validate_component_assignment();
-- Final audit fixes: organization creation is RPC-only, and component writes
-- serialize on their project's row so archive state cannot race issue writes.

drop policy if exists "Authenticated users can create organizations they own" on public.organizations;

create or replace function public.validate_component_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = new.project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  if new.default_assignee_id is not null and not (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = new.project_id and pm.user_id = new.default_assignee_id
    )
    or exists (
      select 1
      from public.projects p
      join public.organizations o on o.id = p.organization_id
      left join public.organization_members om
        on om.organization_id = o.id and om.user_id = new.default_assignee_id
      where p.id = new.project_id
        and (o.owner_id = new.default_assignee_id or om.role in ('OWNER', 'ADMIN'))
    )
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
  end if;

  return new;
end;
$$;
-- Normalize UUID inputs before comparison so equivalent spellings are true
-- no-ops and audit events always contain canonical stored values.
create or replace function public.update_issue_fields(p_issue_id uuid, p_updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_old record;
  v_new_title text;
  v_new_value text;
  v_new_component_id uuid;
  v_new_assignee_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select is_archived into v_archived
  from public.projects
  where id = v_project_id
  for update;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  select * into v_old from public.issues where id = p_issue_id for update;

  if p_updates ? 'title' then
    v_new_title := nullif(trim(p_updates->>'title'), '');
    if v_new_title is null or char_length(v_new_title) > 200 then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_title is distinct from v_old.title then
      update public.issues set title = v_new_title where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TITLE_CHANGED', 'title', to_jsonb(v_old.title), to_jsonb(v_new_title));
    end if;
  end if;

  if p_updates ? 'priority' then
    v_new_value := p_updates->>'priority';
    if v_new_value not in ('P0', 'P1', 'P2', 'P3', 'P4') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.priority then
      update public.issues set priority = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'PRIORITY_CHANGED', 'priority', to_jsonb(v_old.priority), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'severity' then
    v_new_value := p_updates->>'severity';
    if v_new_value not in ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.severity then
      update public.issues set severity = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'SEVERITY_CHANGED', 'severity', to_jsonb(v_old.severity), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'type' then
    v_new_value := p_updates->>'type';
    if v_new_value not in ('BUG', 'ENHANCEMENT', 'TASK', 'SECURITY', 'PERFORMANCE', 'REGRESSION') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.type then
      update public.issues set type = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TYPE_CHANGED', 'type', to_jsonb(v_old.type), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'component_id' then
    v_new_component_id := nullif(p_updates->>'component_id', '')::uuid;
    if v_new_component_id is distinct from v_old.component_id then
      if v_new_component_id is not null then
        perform 1
        from public.components c
        where c.id = v_new_component_id
          and c.project_id = v_project_id
          and not c.is_archived
        for update;
        if not found then
          raise exception 'INVALID_COMPONENT' using errcode = '23503';
        end if;
      end if;
      update public.issues set component_id = v_new_component_id where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'COMPONENT_CHANGED', 'component_id',
              to_jsonb(v_old.component_id::text), to_jsonb(v_new_component_id::text));
    end if;
  end if;

  if p_updates ? 'assignee_id' then
    v_new_assignee_id := nullif(p_updates->>'assignee_id', '')::uuid;
    if v_new_assignee_id is distinct from v_old.assignee_id then
      if v_new_assignee_id is not null and not (
        exists (
          select 1 from public.project_members m
          where m.user_id = v_new_assignee_id and m.project_id = v_project_id
        )
        or exists (
          select 1
          from public.projects p
          join public.organizations o on o.id = p.organization_id
          left join public.organization_members om
            on om.organization_id = o.id and om.user_id = v_new_assignee_id
          where p.id = v_project_id
            and (o.owner_id = v_new_assignee_id or om.role in ('OWNER', 'ADMIN'))
        )
      ) then
        raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
      end if;
      update public.issues set assignee_id = v_new_assignee_id where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ASSIGNEE_CHANGED', 'assignee_id',
              to_jsonb(v_old.assignee_id::text), to_jsonb(v_new_assignee_id::text));
    end if;
  end if;
end;
$$;
-- Serialize component writes with issue writes: both lock the project row first,
-- then mutate a component. This prevents component archival/assignment deadlocks
-- and keeps archived projects fully read-only.

drop policy if exists "Maintainers manage components" on public.components;
drop policy if exists "Maintainers update components" on public.components;

create or replace function public.create_component(
  p_project_id uuid,
  p_name text,
  p_description text default null,
  p_default_assignee_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_archived boolean;
  v_component_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = p_project_id
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.components (project_id, name, description, default_assignee_id)
  values (p_project_id, p_name, nullif(trim(coalesce(p_description, '')), ''), p_default_assignee_id)
  returning id into v_component_id;
  return v_component_id;
end;
$$;

create or replace function public.update_component(
  p_component_id uuid,
  p_name text,
  p_description text default null,
  p_default_assignee_id uuid default null,
  p_is_archived boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select c.project_id into v_project_id
  from public.components c
  where c.id = p_component_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock after the project row, matching create_issue/update_issue_fields.
  perform 1 from public.components c where c.id = p_component_id for update;
  update public.components
  set name = p_name,
      description = nullif(trim(coalesce(p_description, '')), ''),
      default_assignee_id = p_default_assignee_id,
      is_archived = p_is_archived
  where id = p_component_id;
end;
$$;

revoke execute on function public.create_component(uuid, text, text, uuid), public.update_component(uuid, text, text, uuid, boolean) from anon, public;
grant execute on function public.create_component(uuid, text, text, uuid), public.update_component(uuid, text, text, uuid, boolean) to authenticated;
-- Phase 5: comments + activity timeline.
-- Schema §6.14 and plan §18/§19. Comments are project-member readable,
-- RPC-only writes, with immutable COMMENT_ADDED / COMMENT_EDITED audit events.
-- Activity timeline is a merged view of issue_events + comments ordered by time.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 10000),
  edited_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.comments is 'Issue comments; writes go through trusted RPCs.';

create index if not exists comments_issue_created_idx on public.comments (issue_id, created_at);
create index if not exists comments_author_idx on public.comments (author_id);

create trigger comments_set_updated_at
before update on public.comments
for each row execute procedure public.set_updated_at();

alter table public.comments enable row level security;

-- Helper: can the current user comment on this issue?
-- Reporter+ in the issue's project, and project not archived.
create or replace function public.can_comment_on_issue(p_issue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.issues i
    join public.projects p on p.id = i.project_id
    where i.id = p_issue_id
      and not p.is_archived
      and public.project_role(i.project_id) in ('REPORTER', 'DEVELOPER', 'MAINTAINER')
  );
$$;

revoke execute on function public.can_comment_on_issue(uuid) from anon, public;
grant execute on function public.can_comment_on_issue(uuid) to authenticated;

create policy "Project members can read comments"
  on public.comments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = issue_id and public.is_project_member(i.project_id)
    )
  );

-- Tighten column grants for direct client updates (definer RPCs bypass these).
revoke update on public.comments from anon, authenticated, public;
grant update (body) on public.comments to authenticated;

-- Close direct INSERT/DELETE via RLS: no insert/delete policies remain.
-- Clients must call add_comment / edit_comment.

create or replace function public.add_comment(p_issue_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_body text;
  v_comment_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null or char_length(v_body) < 1 or char_length(v_body) > 10000 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Serialize comment writes against issue field writes on the same project row.
  -- Already locked projects row above.

  insert into public.comments (issue_id, author_id, body)
  values (p_issue_id, v_user, v_body)
  returning id into v_comment_id;

  -- Touch the parent issue so "recently updated" sorting reflects new activity.
  update public.issues set updated_at = timezone('utc'::text, now()) where id = p_issue_id;

  insert into public.issue_events (issue_id, actor_id, event_type, metadata)
  values (
    p_issue_id,
    v_user,
    'COMMENT_ADDED',
    jsonb_build_object('comment_id', v_comment_id, 'excerpt', left(v_body, 200))
  );

  return v_comment_id;
end;
$$;

create or replace function public.edit_comment(p_comment_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_body text;
  v_old record;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null or char_length(v_body) < 1 or char_length(v_body) > 10000 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  -- Resolve the target comment and its project without locks first.
  select * into v_old from public.comments where id = p_comment_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_body = v_old.body then
    return;
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = v_old.issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Lock project row first (consistent hierarchy: projects -> issues -> components -> comments).
  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  -- Only the author or a Developer/Maintainer may edit. Reporters may edit only their own.
  if v_old.author_id <> v_user then
    v_role := public.project_role(v_project_id);
    if v_role not in ('DEVELOPER', 'MAINTAINER') then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;

  -- Lock comment row under the project lock.
  perform 1 from public.comments where id = p_comment_id for update;
  update public.comments
  set body = v_body,
      edited_at = timezone('utc'::text, now())
  where id = p_comment_id;

  update public.issues set updated_at = timezone('utc'::text, now()) where id = v_old.issue_id;

  insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (
    v_old.issue_id,
    v_user,
    'COMMENT_EDITED',
    'comment_id',
    to_jsonb(v_old.id::text),
    to_jsonb(v_body),
    jsonb_build_object('comment_id', v_old.id, 'excerpt', left(v_body, 200))
  );
end;
$$;

revoke execute on function public.add_comment(uuid, text), public.edit_comment(uuid, text) from anon, public;
grant execute on function public.add_comment(uuid, text), public.edit_comment(uuid, text) to authenticated;
-- Migration 013: Security & Role Refinements
-- 1. project_role: Org Admins unconditionally have MAINTAINER permissions.
-- 2. edit_comment: Authors must still hold REPORTER+ role to edit past comments.
-- 3. create_issue / create_component: Trim and validate titles and component names.
-- 4. validate_component_assignment: Permit service_role / postgres maintenance context.

create or replace function public.project_role(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_org_admin(
      (select p.organization_id from public.projects p where p.id = p_project_id)
    ) then 'MAINTAINER'
    else (
      select m.role from public.project_members m
      where m.project_id = p_project_id and m.user_id = auth.uid()
      limit 1
    )
  end;
$$;

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

  if p_organization_id is null or not public.is_org_admin(p_organization_id) then
    raise exception 'NOT_ORG_ADMIN' using errcode = '42501';
  end if;

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
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'Open', 'OPEN', 10, false, false)
  returning id into v_state_open;
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'In Progress', 'IN_PROGRESS', 20, false, false)
  returning id into v_state_in_progress;
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'In Review', 'REVIEW', 30, false, false)
  returning id into v_state_review;
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'Resolved', 'RESOLVED', 40, false, false)
  returning id into v_state_resolved;
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'Closed', 'CLOSED', 50, false, true)
  returning id into v_state_closed;
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'Reopened', 'OPEN', 60, false, false)
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
  v_archived boolean;
  v_issue_id uuid;
  v_initial_state uuid;
  v_title text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null or char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  v_role := public.project_role(p_project_id);
  if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select next_issue_number, is_archived
  into v_number, v_archived
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  if p_component_id is not null and not exists (
    select 1 from public.components c
    where c.id = p_component_id and c.project_id = p_project_id and not c.is_archived
  ) then
    raise exception 'INVALID_COMPONENT' using errcode = '23503';
  end if;

  if p_assignee_id is not null and not (
    exists (
      select 1 from public.project_members m
      where m.user_id = p_assignee_id and m.project_id = p_project_id
    )
    or exists (
      select 1
      from public.projects p
      join public.organizations o on o.id = p.organization_id
      left join public.organization_members om
        on om.organization_id = o.id and om.user_id = p_assignee_id
      where p.id = p_project_id
        and (o.owner_id = p_assignee_id or om.role in ('OWNER', 'ADMIN'))
    )
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
  end if;

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
    p_project_id, v_number, v_title, nullif(trim(coalesce(p_description, '')), ''), p_type, v_initial_state,
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
    jsonb_build_object('title', v_title, 'type', p_type, 'priority', coalesce(p_priority, 'P2'), 'severity', coalesce(p_severity, 'MAJOR'))
  );

  return v_number;
end;
$$;

create or replace function public.create_component(
  p_project_id uuid,
  p_name text,
  p_description text default null,
  p_default_assignee_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_archived boolean;
  v_component_id uuid;
  v_name text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = p_project_id
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.components (project_id, name, description, default_assignee_id)
  values (p_project_id, v_name, nullif(trim(coalesce(p_description, '')), ''), p_default_assignee_id)
  returning id into v_component_id;
  return v_component_id;
end;
$$;

create or replace function public.update_component(
  p_component_id uuid,
  p_name text,
  p_description text default null,
  p_default_assignee_id uuid default null,
  p_is_archived boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_name text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  select c.project_id into v_project_id
  from public.components c
  where c.id = p_component_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  perform 1 from public.components c where c.id = p_component_id for update;
  update public.components
  set name = v_name,
      description = nullif(trim(coalesce(p_description, '')), ''),
      default_assignee_id = p_default_assignee_id,
      is_archived = p_is_archived
  where id = p_component_id;
end;
$$;

create or replace function public.edit_comment(p_comment_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_body text;
  v_old record;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null or char_length(v_body) < 1 or char_length(v_body) > 10000 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  select * into v_old from public.comments where id = p_comment_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_body = v_old.body then
    return;
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = v_old.issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_old.author_id = v_user then
    if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  else
    if v_role not in ('DEVELOPER', 'MAINTAINER') then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;

  perform 1 from public.comments where id = p_comment_id for update;
  update public.comments
  set body = v_body,
      edited_at = timezone('utc'::text, now())
  where id = p_comment_id;

  update public.issues set updated_at = timezone('utc'::text, now()) where id = v_old.issue_id;

  insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (
    v_old.issue_id,
    v_user,
    'COMMENT_EDITED',
    'comment_id',
    to_jsonb(v_old.id::text),
    to_jsonb(v_body),
    jsonb_build_object('comment_id', v_old.id, 'excerpt', left(v_body, 200))
  );
end;
$$;

create or replace function public.validate_component_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived boolean;
begin
  -- Permit service role / background maintenance scripts where auth.uid() is null
  if auth.uid() is null then
    return new;
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = new.project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  if new.default_assignee_id is not null and not (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = new.project_id and pm.user_id = new.default_assignee_id
    )
    or exists (
      select 1
      from public.projects p
      join public.organizations o on o.id = p.organization_id
      left join public.organization_members om
        on om.organization_id = o.id and om.user_id = new.default_assignee_id
      where p.id = new.project_id
        and (o.owner_id = new.default_assignee_id or om.role in ('OWNER', 'ADMIN'))
    )
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
  end if;

  return new;
end;
$$;
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
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'Open', 'OPEN', 10, false, false)
  returning id into v_state_open;
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'In Progress', 'IN_PROGRESS', 20, false, false)
  returning id into v_state_in_progress;
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'In Review', 'REVIEW', 30, false, false)
  returning id into v_state_review;
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'Resolved', 'RESOLVED', 40, false, false)
  returning id into v_state_resolved;
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'Closed', 'CLOSED', 50, false, true)
  returning id into v_state_closed;
  insert into public.workflow_states (project_id, name, category, position, is_initial, is_terminal)
  values (v_project_id, 'Reopened', 'OPEN', 60, false, false)
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
-- Migration 015: Phase 6 - Assignment & Workflow Lifecycle
-- Implements transition_issue, assign_issue, reopen_issue, and can_transition_issue
-- with strict top-down lock ordering, resolution enforcement, and audit events.

create or replace function public.can_transition_issue(p_issue_id uuid, p_to_state_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_current_state_id uuid;
  v_is_archived boolean;
begin
  if v_user is null then
    return false;
  end if;

  select i.project_id, i.status_id, p.is_archived
  into v_project_id, v_current_state_id, v_is_archived
  from public.issues i
  join public.projects p on p.id = i.project_id
  where i.id = p_issue_id;

  if not found or v_is_archived then
    return false;
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER', 'REPORTER') then
    return false;
  end if;

  -- Same state is a no-op / allowed
  if v_current_state_id = p_to_state_id then
    return true;
  end if;

  -- Maintainers can override transitions
  if v_role = 'MAINTAINER' then
    return exists (
      select 1 from public.workflow_states ws
      where ws.id = p_to_state_id and ws.project_id = v_project_id
    );
  end if;

  -- Check workflow_transitions table
  return exists (
    select 1 from public.workflow_transitions wt
    where wt.project_id = v_project_id
      and wt.from_state_id = v_current_state_id
      and wt.to_state_id = p_to_state_id
      and (wt.required_role is null or wt.required_role = v_role or (wt.required_role = 'REPORTER' and v_role in ('DEVELOPER', 'MAINTAINER')) or (wt.required_role = 'DEVELOPER' and v_role = 'MAINTAINER'))
  );
end;
$$;

create or replace function public.transition_issue(
  p_issue_id uuid,
  p_to_state_id uuid,
  p_resolution text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_old record;
  v_target_state record;
  v_resolution text;
  v_resolved_at timestamptz;
  v_closed_at timestamptz;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Top-down lock: project row first
  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER', 'REPORTER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock target state
  select * into v_target_state
  from public.workflow_states ws
  where ws.id = p_to_state_id and ws.project_id = v_project_id;

  if not found then
    raise exception 'INVALID_STATE' using errcode = '23503';
  end if;

  -- Lock issue row
  select * into v_old
  from public.issues
  where id = p_issue_id
  for update;

  -- If same state and resolution unchanged, no-op
  if v_old.status_id = p_to_state_id and (p_resolution is null or p_resolution = v_old.resolution) then
    return;
  end if;

  -- Validate transition permission unless Maintainer override
  if v_old.status_id <> p_to_state_id and v_role <> 'MAINTAINER' then
    if not exists (
      select 1 from public.workflow_transitions wt
      where wt.project_id = v_project_id
        and wt.from_state_id = v_old.status_id
        and wt.to_state_id = p_to_state_id
        and (wt.required_role is null or wt.required_role = v_role or (wt.required_role = 'REPORTER' and v_role in ('DEVELOPER', 'MAINTAINER')) or (wt.required_role = 'DEVELOPER' and v_role = 'MAINTAINER'))
    ) then
      raise exception 'INVALID_TRANSITION' using errcode = '42501';
    end if;
  end if;

  -- Determine resolution and timestamps based on target state category
  if v_target_state.category in ('RESOLVED', 'CLOSED') then
    v_resolution := nullif(trim(coalesce(p_resolution, v_old.resolution, 'FIXED')), '');
    if v_resolution not in ('FIXED', 'DUPLICATE', 'WONT_FIX', 'INVALID', 'CANNOT_REPRODUCE', 'WORKS_AS_EXPECTED') then
      raise exception 'VALIDATION: Invalid resolution' using errcode = '22023';
    end if;
    v_resolved_at := coalesce(v_old.resolved_at, v_now);
    if v_target_state.category = 'CLOSED' then
      v_closed_at := v_now;
    else
      v_closed_at := null;
    end if;
  else
    -- Reopening or transitioning back to non-resolved state clears resolution
    v_resolution := null;
    v_resolved_at := null;
    v_closed_at := null;
  end if;

  -- Update issue row
  update public.issues
  set status_id = p_to_state_id,
      resolution = v_resolution,
      resolved_at = v_resolved_at,
      closed_at = v_closed_at,
      updated_at = v_now
  where id = p_issue_id;

  -- Insert STATUS_CHANGED audit event if status changed
  if v_old.status_id <> p_to_state_id then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
    values (
      p_issue_id,
      v_user,
      'STATUS_CHANGED',
      'status_id',
      to_jsonb(v_old.status_id::text),
      to_jsonb(p_to_state_id::text),
      jsonb_build_object(
        'old_state_id', v_old.status_id,
        'new_state_id', p_to_state_id,
        'new_category', v_target_state.category,
        'resolution', v_resolution
      )
    );
  end if;

  -- Insert RESOLUTION_CHANGED audit event if resolution changed
  if coalesce(v_old.resolution, '') is distinct from coalesce(v_resolution, '') then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
    values (
      p_issue_id,
      v_user,
      'RESOLUTION_CHANGED',
      'resolution',
      to_jsonb(v_old.resolution),
      to_jsonb(v_resolution)
    );
  end if;
end;
$$;

create or replace function public.assign_issue(
  p_issue_id uuid,
  p_assignee_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_old record;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Top-down lock: project row first
  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Verify assignee eligibility if assigned
  if p_assignee_id is not null and not (
    exists (
      select 1 from public.project_members m
      where m.user_id = p_assignee_id and m.project_id = v_project_id
    )
    or exists (
      select 1
      from public.projects p
      join public.organizations o on o.id = p.organization_id
      left join public.organization_members om
        on om.organization_id = o.id and om.user_id = p_assignee_id
      where p.id = v_project_id
        and (o.owner_id = p_assignee_id or om.role in ('OWNER', 'ADMIN'))
    )
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
  end if;

  -- Lock issue row
  select * into v_old
  from public.issues
  where id = p_issue_id
  for update;

  if v_old.assignee_id is distinct from p_assignee_id then
    update public.issues
    set assignee_id = p_assignee_id,
        updated_at = v_now
    where id = p_issue_id;

    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
    values (
      p_issue_id,
      v_user,
      'ASSIGNEE_CHANGED',
      'assignee_id',
      case when v_old.assignee_id is null then to_jsonb(null::text) else to_jsonb(v_old.assignee_id::text) end,
      case when p_assignee_id is null then to_jsonb(null::text) else to_jsonb(p_assignee_id::text) end
    );
  end if;
end;
$$;

create or replace function public.reopen_issue(
  p_issue_id uuid,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_reopen_state_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Find Reopened or Open state
  select ws.id into v_reopen_state_id
  from public.workflow_states ws
  where ws.project_id = v_project_id
    and (ws.name in ('Reopened', 'Open') or ws.category in ('OPEN', 'TRIAGE'))
  order by case when ws.name = 'Reopened' then 1 when ws.name = 'Open' then 2 else 3 end, ws.position
  limit 1;

  if v_reopen_state_id is null then
    raise exception 'INVALID_STATE: No open workflow state found' using errcode = 'P0002';
  end if;

  -- Transition issue
  perform public.transition_issue(p_issue_id, v_reopen_state_id, null);

  -- Optionally add comment
  if p_comment is not null and nullif(trim(p_comment), '') is not null then
    perform public.add_comment(p_issue_id, p_comment);
  end if;
end;
$$;

revoke execute on function public.can_transition_issue(uuid, uuid) from anon, public;
revoke execute on function public.transition_issue(uuid, uuid, text) from anon, public;
revoke execute on function public.assign_issue(uuid, uuid) from anon, public;
revoke execute on function public.reopen_issue(uuid, text) from anon, public;

grant execute on function public.can_transition_issue(uuid, uuid) to authenticated;
grant execute on function public.transition_issue(uuid, uuid, text) to authenticated;
grant execute on function public.assign_issue(uuid, uuid) to authenticated;
grant execute on function public.reopen_issue(uuid, text) to authenticated;
-- Migration 016: Phase 7 - Labels, Versions & Milestones
-- Adds tables: labels, issue_labels, versions, milestones
-- Adds planning columns to issues: affected_version_id, target_milestone_id
-- Implements trusted RPCs for planning metadata with project-first locking and RLS.

-- 1. Labels Table
create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  description text check (char_length(description) <= 200),
  color text not null default '#6366f1' check (char_length(color) between 4 and 30),
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (project_id, name)
);

create index if not exists labels_project_idx on public.labels (project_id);

-- 2. Issue Labels Junction Table
create table if not exists public.issue_labels (
  issue_id uuid not null references public.issues (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  primary key (issue_id, label_id)
);

create index if not exists issue_labels_label_idx on public.issue_labels (label_id);

-- 3. Versions Table
create table if not exists public.versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 280),
  released_at timestamptz,
  is_released boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (project_id, name)
);

create index if not exists versions_project_idx on public.versions (project_id);

create trigger versions_set_updated_at
before update on public.versions
for each row execute procedure public.set_updated_at();

-- 4. Milestones Table
create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  due_at timestamptz,
  status text not null default 'ACTIVE' check (status in ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (project_id, name)
);

create index if not exists milestones_project_idx on public.milestones (project_id);

create trigger milestones_set_updated_at
before update on public.milestones
for each row execute procedure public.set_updated_at();

-- 5. Add Planning Columns to Issues Table
alter table public.issues
  add column if not exists affected_version_id uuid references public.versions (id) on delete set null,
  add column if not exists target_milestone_id uuid references public.milestones (id) on delete set null;

create index if not exists issues_affected_version_idx on public.issues (affected_version_id);
create index if not exists issues_target_milestone_idx on public.issues (target_milestone_id);

-- 6. Enable RLS
alter table public.labels enable row level security;
alter table public.issue_labels enable row level security;
alter table public.versions enable row level security;
alter table public.milestones enable row level security;

-- 7. Read Policies
create policy "Project members can read labels"
  on public.labels for select to authenticated
  using (public.is_project_member(project_id));

create policy "Project members can read issue labels"
  on public.issue_labels for select to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = issue_id and public.is_project_member(i.project_id)
    )
  );

create policy "Project members can read versions"
  on public.versions for select to authenticated
  using (public.is_project_member(project_id));

create policy "Project members can read milestones"
  on public.milestones for select to authenticated
  using (public.is_project_member(project_id));

-- 8. RPCs for Labels
create or replace function public.create_label(
  p_project_id uuid,
  p_name text,
  p_color text default '#6366f1',
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_archived boolean;
  v_label_id uuid;
  v_name text;
  v_color text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 50 then
    raise exception 'VALIDATION: Label name must be 1–50 characters' using errcode = '22023';
  end if;

  v_color := coalesce(nullif(trim(p_color), ''), '#6366f1');

  select p.is_archived into v_archived
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.labels (project_id, name, color, description)
  values (p_project_id, v_name, v_color, nullif(trim(coalesce(p_description, '')), ''))
  returning id into v_label_id;

  return v_label_id;
end;
$$;

create or replace function public.update_label(
  p_label_id uuid,
  p_name text,
  p_color text default '#6366f1',
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_name text;
  v_color text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 50 then
    raise exception 'VALIDATION: Label name must be 1–50 characters' using errcode = '22023';
  end if;

  v_color := coalesce(nullif(trim(p_color), ''), '#6366f1');

  select l.project_id into v_project_id
  from public.labels l
  where l.id = p_label_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  update public.labels
  set name = v_name,
      color = v_color,
      description = nullif(trim(coalesce(p_description, '')), '')
  where id = p_label_id;
end;
$$;

create or replace function public.delete_label(p_label_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select l.project_id into v_project_id
  from public.labels l
  where l.id = p_label_id;

  if not found then
    return;
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.labels where id = p_label_id;
end;
$$;

-- 9. RPC for Issue Label Association
create or replace function public.set_issue_labels(p_issue_id uuid, p_label_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_label_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Clear existing and re-insert given labels
  delete from public.issue_labels where issue_id = p_issue_id;

  if p_label_ids is not null then
    foreach v_label_id in array p_label_ids loop
      if exists (select 1 from public.labels l where l.id = v_label_id and l.project_id = v_project_id) then
        insert into public.issue_labels (issue_id, label_id)
        values (p_issue_id, v_label_id)
        on conflict (issue_id, label_id) do nothing;
      end if;
    end loop;
  end if;

  update public.issues set updated_at = timezone('utc'::text, now()) where id = p_issue_id;
end;
$$;

-- 10. RPCs for Versions
create or replace function public.create_version(
  p_project_id uuid,
  p_name text,
  p_description text default null,
  p_released_at timestamptz default null,
  p_is_released boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_archived boolean;
  v_version_id uuid;
  v_name text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION: Version name must be 1–80 characters' using errcode = '22023';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.versions (project_id, name, description, released_at, is_released)
  values (p_project_id, v_name, nullif(trim(coalesce(p_description, '')), ''), p_released_at, p_is_released)
  returning id into v_version_id;

  return v_version_id;
end;
$$;

create or replace function public.update_version(
  p_version_id uuid,
  p_name text,
  p_description text default null,
  p_released_at timestamptz default null,
  p_is_released boolean default false,
  p_is_archived boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_name text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION: Version name must be 1–80 characters' using errcode = '22023';
  end if;

  select v.project_id into v_project_id
  from public.versions v
  where v.id = p_version_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  update public.versions
  set name = v_name,
      description = nullif(trim(coalesce(p_description, '')), ''),
      released_at = p_released_at,
      is_released = p_is_released,
      is_archived = p_is_archived
  where id = p_version_id;
end;
$$;

-- 11. RPCs for Milestones
create or replace function public.create_milestone(
  p_project_id uuid,
  p_name text,
  p_description text default null,
  p_due_at timestamptz default null,
  p_status text default 'ACTIVE'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_archived boolean;
  v_milestone_id uuid;
  v_name text;
  v_status text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION: Milestone name must be 1–80 characters' using errcode = '22023';
  end if;

  v_status := coalesce(nullif(trim(p_status), ''), 'ACTIVE');
  if v_status not in ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED') then
    raise exception 'VALIDATION: Invalid milestone status' using errcode = '22023';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.milestones (project_id, name, description, due_at, status)
  values (p_project_id, v_name, nullif(trim(coalesce(p_description, '')), ''), p_due_at, v_status)
  returning id into v_milestone_id;

  return v_milestone_id;
end;
$$;

create or replace function public.update_milestone(
  p_milestone_id uuid,
  p_name text,
  p_description text default null,
  p_due_at timestamptz default null,
  p_status text default 'ACTIVE'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_name text;
  v_status text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION: Milestone name must be 1–80 characters' using errcode = '22023';
  end if;

  v_status := coalesce(nullif(trim(p_status), ''), 'ACTIVE');
  if v_status not in ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED') then
    raise exception 'VALIDATION: Invalid milestone status' using errcode = '22023';
  end if;

  select m.project_id into v_project_id
  from public.milestones m
  where m.id = p_milestone_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  update public.milestones
  set name = v_name,
      description = nullif(trim(coalesce(p_description, '')), ''),
      due_at = p_due_at,
      status = v_status
  where id = p_milestone_id;
end;
$$;

-- 12. RPC to Update Issue Planning Metadata (Version + Milestone)
create or replace function public.update_issue_planning(
  p_issue_id uuid,
  p_affected_version_id uuid default null,
  p_target_milestone_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Validate version if provided
  if p_affected_version_id is not null and not exists (
    select 1 from public.versions v where v.id = p_affected_version_id and v.project_id = v_project_id and not v.is_archived
  ) then
    raise exception 'INVALID_VERSION' using errcode = '23503';
  end if;

  -- Validate milestone if provided
  if p_target_milestone_id is not null and not exists (
    select 1 from public.milestones m where m.id = p_target_milestone_id and m.project_id = v_project_id
  ) then
    raise exception 'INVALID_MILESTONE' using errcode = '23503';
  end if;

  update public.issues
  set affected_version_id = p_affected_version_id,
      target_milestone_id = p_target_milestone_id,
      updated_at = timezone('utc'::text, now())
  where id = p_issue_id;
end;
$$;

-- Revoke/Grant Execution Rights
revoke execute on function public.create_label(uuid, text, text, text) from anon, public;
revoke execute on function public.update_label(uuid, text, text, text) from anon, public;
revoke execute on function public.delete_label(uuid) from anon, public;
revoke execute on function public.set_issue_labels(uuid, uuid[]) from anon, public;
revoke execute on function public.create_version(uuid, text, text, timestamptz, boolean) from anon, public;
revoke execute on function public.update_version(uuid, text, text, timestamptz, boolean, boolean) from anon, public;
revoke execute on function public.create_milestone(uuid, text, text, timestamptz, text) from anon, public;
revoke execute on function public.update_milestone(uuid, text, text, timestamptz, text) from anon, public;
revoke execute on function public.update_issue_planning(uuid, uuid, uuid) from anon, public;

grant execute on function public.create_label(uuid, text, text, text) to authenticated;
grant execute on function public.update_label(uuid, text, text, text) to authenticated;
grant execute on function public.delete_label(uuid) to authenticated;
grant execute on function public.set_issue_labels(uuid, uuid[]) to authenticated;
grant execute on function public.create_version(uuid, text, text, timestamptz, boolean) to authenticated;
grant execute on function public.update_version(uuid, text, text, timestamptz, boolean, boolean) to authenticated;
grant execute on function public.create_milestone(uuid, text, text, timestamptz, text) to authenticated;
grant execute on function public.update_milestone(uuid, text, text, timestamptz, text) to authenticated;
grant execute on function public.update_issue_planning(uuid, uuid, uuid) to authenticated;
-- Migration 017: Phase 8 - Watchers & Notifications
-- Implements issue_watchers, notifications, notification_preferences
-- and automated notification generation on assign, comment, mention, and status change.

-- 1. Issue Watchers Table
create table if not exists public.issue_watchers (
  issue_id uuid not null references public.issues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (issue_id, user_id)
);

create index if not exists issue_watchers_user_idx on public.issue_watchers (user_id);

-- 2. Notifications Table
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  issue_id uuid references public.issues (id) on delete cascade,
  type text not null check (type in ('ASSIGNED', 'MENTION', 'COMMENT', 'STATUS_CHANGED', 'ISSUE_LINKED', 'MILESTONE_CHANGED', 'WATCHED_ISSUE_UPDATED')),
  data jsonb,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists notifications_user_read_created_idx on public.notifications (user_id, read_at, created_at desc);

-- 3. Notification Preferences Table
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  mentions boolean not null default true,
  assignments boolean not null default true,
  comments boolean not null default true,
  status_changes boolean not null default true,
  watch_updates boolean not null default true,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- 4. Enable RLS
alter table public.issue_watchers enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;

-- 5. RLS Policies
create policy "Project members can read issue watchers"
  on public.issue_watchers for select to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = issue_id and public.is_project_member(i.project_id)
    )
  );

create policy "Users can read their own notifications"
  on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can update their own notifications"
  on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own notifications"
  on public.notifications for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their notification preferences"
  on public.notification_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can update their notification preferences"
  on public.notification_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can insert their notification preferences"
  on public.notification_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- 6. RPCs for Watching
create or replace function public.toggle_watch_issue(p_issue_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_watching boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.issue_watchers
    where issue_id = p_issue_id and user_id = v_user
  ) into v_watching;

  if v_watching then
    delete from public.issue_watchers
    where issue_id = p_issue_id and user_id = v_user;
    return false;
  else
    insert into public.issue_watchers (issue_id, user_id)
    values (p_issue_id, v_user)
    on conflict (issue_id, user_id) do nothing;
    return true;
  end if;
end;
$$;

create or replace function public.watch_issue(p_issue_id uuid)
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

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.issue_watchers (issue_id, user_id)
  values (p_issue_id, v_user)
  on conflict (issue_id, user_id) do nothing;
end;
$$;

create or replace function public.unwatch_issue(p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  delete from public.issue_watchers
  where issue_id = p_issue_id and user_id = v_user;
end;
$$;

-- 7. RPCs for Notification Management
create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  update public.notifications
  set read_at = timezone('utc'::text, now())
  where id = p_notification_id and user_id = v_user and read_at is null;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  update public.notifications
  set read_at = timezone('utc'::text, now())
  where user_id = v_user and read_at is null;
end;
$$;

create or replace function public.get_unread_notifications_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.notifications
  where user_id = auth.uid() and read_at is null;
$$;

-- 8. Internal Notification Dispatcher
create or replace function public.dispatch_issue_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_issue_id uuid,
  p_type text,
  p_data jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Do not notify self
  if p_recipient_id is null or p_recipient_id = p_actor_id then
    return;
  end if;

  insert into public.notifications (user_id, actor_id, issue_id, type, data)
  values (p_recipient_id, p_actor_id, p_issue_id, p_type, p_data);
end;
$$;

-- 9. Trigger on Issue Creation: Auto-watch for reporter and assignee, and notify assignee
create or replace function public.on_issue_created_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Auto-watch reporter
  insert into public.issue_watchers (issue_id, user_id)
  values (new.id, new.reporter_id)
  on conflict (issue_id, user_id) do nothing;

  -- Auto-watch assignee if assigned
  if new.assignee_id is not null then
    insert into public.issue_watchers (issue_id, user_id)
    values (new.id, new.assignee_id)
    on conflict (issue_id, user_id) do nothing;

    -- Notify assignee
    perform public.dispatch_issue_notification(
      new.assignee_id,
      new.reporter_id,
      new.id,
      'ASSIGNED',
      jsonb_build_object('title', new.title, 'issue_number', new.issue_number)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_issue_created_notifications on public.issues;
create trigger trg_issue_created_notifications
after insert on public.issues
for each row execute procedure public.on_issue_created_notifications();

-- 10. Trigger on Comments: Notify watchers & mentioned users
create or replace function public.on_comment_created_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watcher record;
  v_issue record;
begin
  select i.id, i.issue_number, i.title, i.project_id into v_issue
  from public.issues i
  where i.id = new.issue_id;

  if not found then
    return new;
  end if;

  -- Auto-watch commenter
  insert into public.issue_watchers (issue_id, user_id)
  values (new.issue_id, new.author_id)
  on conflict (issue_id, user_id) do nothing;

  -- Notify all watchers (except commenter)
  for v_watcher in (
    select user_id from public.issue_watchers
    where issue_id = new.issue_id and user_id <> new.author_id
  ) loop
    perform public.dispatch_issue_notification(
      v_watcher.user_id,
      new.author_id,
      new.issue_id,
      'COMMENT',
      jsonb_build_object('excerpt', left(new.body, 140), 'issue_number', v_issue.issue_number, 'title', v_issue.title)
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_comment_created_notifications on public.comments;
create trigger trg_comment_created_notifications
after insert on public.comments
for each row execute procedure public.on_comment_created_notifications();

-- 11. Revoke / Grant Permissions
revoke execute on function public.toggle_watch_issue(uuid) from anon, public;
revoke execute on function public.watch_issue(uuid) from anon, public;
revoke execute on function public.unwatch_issue(uuid) from anon, public;
revoke execute on function public.mark_notification_read(uuid) from anon, public;
revoke execute on function public.mark_all_notifications_read() from anon, public;
revoke execute on function public.get_unread_notifications_count() from anon, public;

grant execute on function public.toggle_watch_issue(uuid) to authenticated;
grant execute on function public.watch_issue(uuid) to authenticated;
grant execute on function public.unwatch_issue(uuid) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.get_unread_notifications_count() to authenticated;
-- Migration 018: Phase 10 - Search + Saved Views
-- Adds pg_trgm, saved_views table, and FTS indexes for issues

create extension if not exists pg_trgm;

-- Saved Views Table
create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  filters jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists saved_views_project_idx on public.saved_views (project_id);
create index if not exists saved_views_created_by_idx on public.saved_views (created_by);

create trigger saved_views_set_updated_at
before update on public.saved_views
for each row execute procedure public.set_updated_at();

-- FTS & Trigram Indexes for Issues
create index if not exists issues_title_trgm_idx on public.issues using gin (title gin_trgm_ops);
create index if not exists issues_description_trgm_idx on public.issues using gin (description gin_trgm_ops);
create index if not exists issues_search_tsv_idx on public.issues using gin (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
);

-- Enable RLS for saved_views
alter table public.saved_views enable row level security;

create policy "Project members can read saved views"
  on public.saved_views for select to authenticated
  using (
    public.is_project_member(project_id)
    and (is_shared = true or created_by = auth.uid())
  );

create policy "Project members can create saved views"
  on public.saved_views for insert to authenticated
  with check (
    public.is_project_member(project_id) and created_by = auth.uid()
  );

create policy "Owners can update/delete their saved views"
  on public.saved_views for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "Owners can delete their saved views"
  on public.saved_views for delete to authenticated
  using (created_by = auth.uid());

-- RPCs for Saved Views
create or replace function public.create_saved_view(
  p_project_id uuid,
  p_name text,
  p_filters jsonb default '{}'::jsonb,
  p_is_shared boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_view_id uuid;
  v_name text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION: Saved view name must be 1–80 characters' using errcode = '22023';
  end if;

  if not public.is_project_member(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.saved_views (project_id, created_by, name, filters, is_shared)
  values (p_project_id, v_user, v_name, coalesce(p_filters, '{}'::jsonb), coalesce(p_is_shared, false))
  returning id into v_view_id;

  return v_view_id;
end;
$$;

create or replace function public.delete_saved_view(p_view_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  delete from public.saved_views where id = p_view_id and created_by = v_user;
end;
$$;

revoke execute on function public.create_saved_view(uuid, text, jsonb, boolean) from anon, public;
revoke execute on function public.delete_saved_view(uuid) from anon, public;
grant execute on function public.create_saved_view(uuid, text, jsonb, boolean) to authenticated;
grant execute on function public.delete_saved_view(uuid) to authenticated;
-- Migration 019: Phase 11 - Dependencies & Duplicates
-- Adds issue_links table for BLOCKS, DEPENDS_ON, DUPLICATE_OF, etc.

create table if not exists public.issue_links (
  id uuid primary key default gen_random_uuid(),
  source_issue_id uuid not null references public.issues (id) on delete cascade,
  target_issue_id uuid not null references public.issues (id) on delete cascade,
  relationship text not null check (relationship in ('BLOCKS', 'DEPENDS_ON', 'DUPLICATE_OF', 'RELATES_TO', 'CAUSED_BY', 'REGRESSION_OF')),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  check (source_issue_id <> target_issue_id),
  unique (source_issue_id, target_issue_id, relationship)
);

create index if not exists issue_links_source_idx on public.issue_links (source_issue_id);
create index if not exists issue_links_target_idx on public.issue_links (target_issue_id);

alter table public.issue_links enable row level security;

create policy "Project members can read issue links"
  on public.issue_links for select to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = source_issue_id and public.is_project_member(i.project_id)
    )
  );

-- RPC: Add Link
create or replace function public.add_issue_link(
  p_source_issue_id uuid,
  p_target_issue_id uuid,
  p_relationship text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_link_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_source_issue_id = p_target_issue_id then
    raise exception 'VALIDATION: Cannot link issue to itself' using errcode = '22023';
  end if;

  if p_relationship not in ('BLOCKS', 'DEPENDS_ON', 'DUPLICATE_OF', 'RELATES_TO', 'CAUSED_BY', 'REGRESSION_OF') then
    raise exception 'VALIDATION: Invalid relationship' using errcode = '22023';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_source_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  -- Ensure target is same project
  if not exists (select 1 from public.issues i where i.id = p_target_issue_id and i.project_id = v_project_id) then
    raise exception 'VALIDATION: Target issue must be in same project' using errcode = '22023';
  end if;

  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.issue_links (source_issue_id, target_issue_id, relationship, created_by)
  values (p_source_issue_id, p_target_issue_id, p_relationship, v_user)
  returning id into v_link_id;

  -- Audit
  insert into public.issue_events (issue_id, actor_id, event_type, metadata)
  values (p_source_issue_id, v_user, 'ISSUE_LINKED', jsonb_build_object('target_id', p_target_issue_id, 'relationship', p_relationship));

  -- Handle DUPLICATE_OF: auto transition to resolved with DUPLICATE resolution
  if p_relationship = 'DUPLICATE_OF' then
    perform public.transition_issue(p_source_issue_id, (
      select ws.id from public.workflow_states ws where ws.project_id = v_project_id and ws.category = 'RESOLVED' limit 1
    ), 'DUPLICATE');
  end if;

  return v_link_id;
end;
$$;

create or replace function public.remove_issue_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  delete from public.issue_links where id = p_link_id;
end;
$$;

create or replace function public.find_duplicate_candidates(p_project_id uuid, p_title text, p_limit integer default 5)
returns table (issue_id uuid, issue_number bigint, title text, similarity double precision)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.issue_number, i.title, similarity(i.title, p_title) as sim
  from public.issues i
  where i.project_id = p_project_id
    and i.title % p_title
  order by sim desc
  limit p_limit;
$$;

revoke execute on function public.add_issue_link(uuid, uuid, text) from anon, public;
revoke execute on function public.remove_issue_link(uuid) from anon, public;
revoke execute on function public.find_duplicate_candidates(uuid, text, integer) from anon, public;
grant execute on function public.add_issue_link(uuid, uuid, text) to authenticated;
grant execute on function public.remove_issue_link(uuid) to authenticated;
grant execute on function public.find_duplicate_candidates(uuid, text, integer) to authenticated;
-- Migration 020: Deep Audit Security Fixes
-- Addresses findings F01-F14 from Phase 1-11 deep audit

-- Fix F01: remove_issue_link authorization
create or replace function public.remove_issue_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  select i.project_id into v_project_id
  from public.issue_links l
  join public.issues i on i.id = l.source_issue_id
  where l.id = p_link_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.issue_links where id = p_link_id;
end;
$$;

-- Fix F02: find_duplicate_candidates leaks + DoS
create or replace function public.find_duplicate_candidates(p_project_id uuid, p_title text, p_limit integer default 5)
returns table (issue_id uuid, issue_number bigint, title text, similarity double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_title text;
  v_limit integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not public.is_project_member(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null or char_length(v_title) < 3 then
    raise exception 'VALIDATION: Title must be at least 3 characters' using errcode = '22023';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 5), 1), 20);

  return query
    select i.id, i.issue_number, i.title, similarity(i.title, v_title) as sim
    from public.issues i
    where i.project_id = p_project_id
      and i.title % v_title
      and similarity(i.title, v_title) > 0.2
    order by sim desc
    limit v_limit;
end;
$$;

-- Fix F06: add_issue_link - add project lock before insert
create or replace function public.add_issue_link(
  p_source_issue_id uuid,
  p_target_issue_id uuid,
  p_relationship text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_link_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_source_issue_id = p_target_issue_id then
    raise exception 'VALIDATION: Cannot link issue to itself' using errcode = '22023';
  end if;

  if p_relationship not in ('BLOCKS', 'DEPENDS_ON', 'DUPLICATE_OF', 'RELATES_TO', 'CAUSED_BY', 'REGRESSION_OF') then
    raise exception 'VALIDATION: Invalid relationship' using errcode = '22023';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_source_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  -- Top-down lock first
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Ensure target is same project
  if not exists (select 1 from public.issues i where i.id = p_target_issue_id and i.project_id = v_project_id) then
    raise exception 'VALIDATION: Target issue must be in same project' using errcode = '22023';
  end if;

  insert into public.issue_links (source_issue_id, target_issue_id, relationship, created_by)
  values (p_source_issue_id, p_target_issue_id, p_relationship, v_user)
  returning id into v_link_id;

  insert into public.issue_events (issue_id, actor_id, event_type, metadata)
  values (p_source_issue_id, v_user, 'ISSUE_LINKED', jsonb_build_object('target_id', p_target_issue_id, 'relationship', p_relationship));

  if p_relationship = 'DUPLICATE_OF' then
    perform public.transition_issue(p_source_issue_id, (
      select ws.id from public.workflow_states ws where ws.project_id = v_project_id and ws.category = 'RESOLVED' limit 1
    ), 'DUPLICATE');
  end if;

  return v_link_id;
end;
$$;

-- Fix F07: set_issue_labels missing issue row lock
create or replace function public.set_issue_labels(p_issue_id uuid, p_label_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_label_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock issue row
  perform 1 from public.issues where id = p_issue_id for update;

  delete from public.issue_labels where issue_id = p_issue_id;

  if p_label_ids is not null then
    foreach v_label_id in array p_label_ids loop
      if exists (select 1 from public.labels l where l.id = v_label_id and l.project_id = v_project_id) then
        insert into public.issue_labels (issue_id, label_id)
        values (p_issue_id, v_label_id)
        on conflict (issue_id, label_id) do nothing;
      end if;
    end loop;
  end if;

  update public.issues set updated_at = timezone('utc'::text, now()) where id = p_issue_id;
end;
$$;

-- Fix F08: watchers RPCs bypass archival + lock ordering
create or replace function public.toggle_watch_issue(p_issue_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_watching boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.issue_watchers
    where issue_id = p_issue_id and user_id = v_user
  ) into v_watching;

  if v_watching then
    delete from public.issue_watchers
    where issue_id = p_issue_id and user_id = v_user;
    return false;
  else
    insert into public.issue_watchers (issue_id, user_id)
    values (p_issue_id, v_user)
    on conflict (issue_id, user_id) do nothing;
    return true;
  end if;
end;
$$;

create or replace function public.watch_issue(p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.issue_watchers (issue_id, user_id)
  values (p_issue_id, v_user)
  on conflict (issue_id, user_id) do nothing;
end;
$$;

create or replace function public.unwatch_issue(p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;

  delete from public.issue_watchers
  where issue_id = p_issue_id and user_id = v_user;
end;
$$;

-- Fix F03 & F11: saved_views isolation + archived guard
drop policy if exists "Owners can update their saved views" on public.saved_views;
drop policy if exists "Owners can delete their saved views" on public.saved_views;

create policy "Owners can update their saved views"
  on public.saved_views for update to authenticated
  using (created_by = auth.uid() and public.is_project_member(project_id))
  with check (created_by = auth.uid() and public.is_project_member(project_id));

create policy "Owners can delete their saved views"
  on public.saved_views for delete to authenticated
  using (created_by = auth.uid() and public.is_project_member(project_id));

create or replace function public.create_saved_view(
  p_project_id uuid,
  p_name text,
  p_filters jsonb default '{}'::jsonb,
  p_is_shared boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_view_id uuid;
  v_name text;
  v_archived boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION: Saved view name must be 1–80 characters' using errcode = '22023';
  end if;

  if octet_length(coalesce(p_filters, '{}'::jsonb)::text) > 8000 then
    raise exception 'VALIDATION: Filters too large' using errcode = '22023';
  end if;

  select p.is_archived into v_archived from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.saved_views (project_id, created_by, name, filters, is_shared)
  values (p_project_id, v_user, v_name, coalesce(p_filters, '{}'::jsonb), coalesce(p_is_shared, false))
  returning id into v_view_id;

  return v_view_id;
end;
$$;

create or replace function public.delete_saved_view(p_view_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cnt integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  with deleted as (
    delete from public.saved_views where id = p_view_id and created_by = v_user returning id
  ) select count(*) into v_cnt from deleted;

  if v_cnt = 0 then
    raise exception 'NOT_FOUND: View not found or not owned' using errcode = 'P0002';
  end if;
end;
$$;

-- Fix F05: Add filters size check trigger
create or replace function public.prevent_saved_view_project_change()
returns trigger
language plpgsql
as $$
begin
  if OLD.project_id is distinct from NEW.project_id then
    raise exception 'VALIDATION: Cannot change project of saved view' using errcode = '22023';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_prevent_saved_view_project_change on public.saved_views;
create trigger trg_prevent_saved_view_project_change
before update on public.saved_views
for each row execute procedure public.prevent_saved_view_project_change();

-- Fix F13: update_issue_planning missing lock
create or replace function public.update_issue_planning(
  p_issue_id uuid,
  p_affected_version_id uuid default null,
  p_target_milestone_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  perform 1 from public.issues where id = p_issue_id for update;

  if p_affected_version_id is not null and not exists (
    select 1 from public.versions v where v.id = p_affected_version_id and v.project_id = v_project_id and not v.is_archived
  ) then
    raise exception 'INVALID_VERSION' using errcode = '23503';
  end if;

  if p_target_milestone_id is not null and not exists (
    select 1 from public.milestones m where m.id = p_target_milestone_id and m.project_id = v_project_id
  ) then
    raise exception 'INVALID_MILESTONE' using errcode = '23503';
  end if;

  update public.issues
  set affected_version_id = p_affected_version_id,
      target_milestone_id = p_target_milestone_id,
      updated_at = timezone('utc'::text, now())
  where id = p_issue_id;
end;
$$;
-- Migration 021: Label color hardening + Realtime publication

-- Fix label color XSS: enforce hex pattern at DB level
alter table public.labels drop constraint if exists labels_color_check;
alter table public.labels add constraint labels_color_check check (color ~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');

-- Harden RPCs to validate color
create or replace function public.create_label(
  p_project_id uuid,
  p_name text,
  p_color text default '#6366f1',
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_archived boolean;
  v_label_id uuid;
  v_name text;
  v_color text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 50 then raise exception 'VALIDATION: Label name must be 1–50 characters' using errcode = '22023'; end if;
  v_color := coalesce(nullif(trim(p_color), ''), '#6366f1');
  if v_color !~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' then raise exception 'VALIDATION: Invalid color' using errcode = '22023'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_manage_project(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.labels (project_id, name, color, description) values (p_project_id, v_name, v_color, nullif(trim(coalesce(p_description, '')), '')) returning id into v_label_id;
  return v_label_id;
end;
$$;

create or replace function public.update_label(
  p_label_id uuid,
  p_name text,
  p_color text default '#6366f1',
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_name text;
  v_color text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 50 then raise exception 'VALIDATION: Label name must be 1–50 characters' using errcode = '22023'; end if;
  v_color := coalesce(nullif(trim(p_color), ''), '#6366f1');
  if v_color !~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' then raise exception 'VALIDATION: Invalid color' using errcode = '22023'; end if;
  select l.project_id into v_project_id from public.labels l where l.id = p_label_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_manage_project(v_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.labels set name = v_name, color = v_color, description = nullif(trim(coalesce(p_description, '')), '') where id = p_label_id;
end;
$$;

-- Enable Realtime for key tables
do $$
begin
  -- Add tables to supabase_realtime publication if not already added
  begin
    alter publication supabase_realtime add table public.comments;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.issues;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.issue_watchers;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.issue_links;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.issue_events;
  exception when duplicate_object then null;
  end;
end $$;
-- Migration 022: Final Audit Refinements
-- 1. create_organization: input trimming & caller profile upsert
-- 2. dispatch_issue_notification: check notification_preferences
-- 3. can_transition_issue: support VIEWER required_role in transition hierarchy
-- 4. prevent_saved_view_project_change: set search_path = public

create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_organization_id uuid;
  v_name text;
  v_slug text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  v_slug := nullif(lower(trim(coalesce(p_slug, ''))), '');

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'VALIDATION: Organization name must be 2–60 characters' using errcode = '22023';
  end if;

  if v_slug is null or char_length(v_slug) < 2 or char_length(v_slug) > 60 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'VALIDATION: Invalid workspace slug' using errcode = '22023';
  end if;

  -- Ensure caller profile exists
  insert into public.profiles (id, display_name)
  values (v_user, coalesce(auth.jwt()->>'display_name', split_part(coalesce(auth.jwt()->>'email', 'user'), '@', 1)))
  on conflict (id) do nothing;

  insert into public.organizations (name, slug, owner_id)
  values (v_name, v_slug, v_user)
  returning id into v_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, v_user, 'OWNER');

  return v_organization_id;
end;
$$;

create or replace function public.dispatch_issue_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_issue_id uuid,
  p_type text,
  p_data jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pref record;
  v_enabled boolean := true;
begin
  -- Do not notify self
  if p_recipient_id is null or p_recipient_id = p_actor_id then
    return;
  end if;

  -- Check user notification preferences if set
  select * into v_pref from public.notification_preferences where user_id = p_recipient_id;
  if found then
    if p_type = 'MENTION' and not v_pref.mentions then v_enabled := false; end if;
    if p_type = 'ASSIGNED' and not v_pref.assignments then v_enabled := false; end if;
    if p_type = 'COMMENT' and not v_pref.comments then v_enabled := false; end if;
    if p_type = 'STATUS_CHANGED' and not v_pref.status_changes then v_enabled := false; end if;
    if p_type = 'WATCHED_ISSUE_UPDATED' and not v_pref.watch_updates then v_enabled := false; end if;
  end if;

  if v_enabled then
    insert into public.notifications (user_id, actor_id, issue_id, type, data)
    values (p_recipient_id, p_actor_id, p_issue_id, p_type, p_data);
  end if;
end;
$$;

create or replace function public.can_transition_issue(p_issue_id uuid, p_to_state_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_current_state_id uuid;
  v_is_archived boolean;
begin
  if v_user is null then
    return false;
  end if;

  select i.project_id, i.status_id, p.is_archived
  into v_project_id, v_current_state_id, v_is_archived
  from public.issues i
  join public.projects p on p.id = i.project_id
  where i.id = p_issue_id;

  if not found or v_is_archived then
    return false;
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER', 'REPORTER') then
    return false;
  end if;

  -- Same state is a no-op / allowed
  if v_current_state_id = p_to_state_id then
    return true;
  end if;

  -- Maintainers can override transitions
  if v_role = 'MAINTAINER' then
    return exists (
      select 1 from public.workflow_states ws
      where ws.id = p_to_state_id and ws.project_id = v_project_id
    );
  end if;

  -- Check workflow_transitions table
  return exists (
    select 1 from public.workflow_transitions wt
    where wt.project_id = v_project_id
      and wt.from_state_id = v_current_state_id
      and wt.to_state_id = p_to_state_id
      and (
        wt.required_role is null
        or wt.required_role = v_role
        or wt.required_role = 'VIEWER'
        or (wt.required_role = 'REPORTER' and v_role in ('DEVELOPER', 'MAINTAINER'))
        or (wt.required_role = 'DEVELOPER' and v_role = 'MAINTAINER')
      )
  );
end;
$$;

create or replace function public.prevent_saved_view_project_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if OLD.project_id is distinct from NEW.project_id then
    raise exception 'VALIDATION: Cannot change project of saved view' using errcode = '22023';
  end if;
  return NEW;
end;
$$;
-- Migration 023: Fix transition_issue role check to match can_transition_issue
-- Supports wt.required_role = 'VIEWER' across all workflow transitions

create or replace function public.transition_issue(
  p_issue_id uuid,
  p_to_state_id uuid,
  p_resolution text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_old record;
  v_target_state record;
  v_resolution text;
  v_resolved_at timestamptz;
  v_closed_at timestamptz;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Top-down lock: project row first
  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER', 'REPORTER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock target state
  select * into v_target_state
  from public.workflow_states ws
  where ws.id = p_to_state_id and ws.project_id = v_project_id;

  if not found then
    raise exception 'INVALID_STATE' using errcode = '23503';
  end if;

  -- Lock issue row
  select * into v_old
  from public.issues
  where id = p_issue_id
  for update;

  -- If same state and resolution unchanged, no-op
  if v_old.status_id = p_to_state_id and (p_resolution is null or p_resolution = v_old.resolution) then
    return;
  end if;

  -- Validate transition permission unless Maintainer override
  if v_old.status_id <> p_to_state_id and v_role <> 'MAINTAINER' then
    if not exists (
      select 1 from public.workflow_transitions wt
      where wt.project_id = v_project_id
        and wt.from_state_id = v_old.status_id
        and wt.to_state_id = p_to_state_id
        and (
          wt.required_role is null
          or wt.required_role = v_role
          or wt.required_role = 'VIEWER'
          or (wt.required_role = 'REPORTER' and v_role in ('DEVELOPER', 'MAINTAINER'))
          or (wt.required_role = 'DEVELOPER' and v_role = 'MAINTAINER')
        )
    ) then
      raise exception 'INVALID_TRANSITION' using errcode = '42501';
    end if;
  end if;

  -- Determine resolution and timestamps based on target state category
  if v_target_state.category in ('RESOLVED', 'CLOSED') then
    v_resolution := nullif(trim(coalesce(p_resolution, v_old.resolution, 'FIXED')), '');
    if v_resolution not in ('FIXED', 'DUPLICATE', 'WONT_FIX', 'INVALID', 'CANNOT_REPRODUCE', 'WORKS_AS_EXPECTED') then
      raise exception 'VALIDATION: Invalid resolution' using errcode = '22023';
    end if;
    v_resolved_at := coalesce(v_old.resolved_at, v_now);
    if v_target_state.category = 'CLOSED' then
      v_closed_at := v_now;
    else
      v_closed_at := null;
    end if;
  else
    -- Reopening or transitioning back to non-resolved state clears resolution
    v_resolution := null;
    v_resolved_at := null;
    v_closed_at := null;
  end if;

  -- Update issue row
  update public.issues
  set status_id = p_to_state_id,
      resolution = v_resolution,
      resolved_at = v_resolved_at,
      closed_at = v_closed_at,
      updated_at = v_now
  where id = p_issue_id;

  -- Insert STATUS_CHANGED audit event if status changed
  if v_old.status_id <> p_to_state_id then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
    values (
      p_issue_id,
      v_user,
      'STATUS_CHANGED',
      'status_id',
      to_jsonb(v_old.status_id::text),
      to_jsonb(p_to_state_id::text),
      jsonb_build_object(
        'old_state_id', v_old.status_id,
        'new_state_id', p_to_state_id,
        'new_category', v_target_state.category,
        'resolution', v_resolution
      )
    );
  end if;

  -- Insert RESOLUTION_CHANGED audit event if resolution changed
  if coalesce(v_old.resolution, '') is distinct from coalesce(v_resolution, '') then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
    values (
      p_issue_id,
      v_user,
      'RESOLUTION_CHANGED',
      'resolution',
      to_jsonb(v_old.resolution),
      to_jsonb(v_resolution)
    );
  end if;
end;
$$;

revoke execute on function public.transition_issue(uuid, uuid, text) from anon, public;
grant execute on function public.transition_issue(uuid, uuid, text) to authenticated;
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
-- Migration 025: Phase 13 - Attachments
-- Table, RLS, Storage Bucket, RPCs, and Realtime publication for issue file attachments

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  uploader_id uuid not null references auth.users (id) on delete restrict,
  filename text not null check (char_length(trim(filename)) between 1 and 255),
  storage_path text not null check (char_length(trim(storage_path)) between 1 and 1000),
  mime_type text,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 52428800), -- 50MB max
  created_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.attachments is 'File and image attachments uploaded to issues.';

create index if not exists idx_attachments_issue_id on public.attachments(issue_id, created_at);
create index if not exists idx_attachments_uploader_id on public.attachments(uploader_id);

alter table public.attachments enable row level security;

-- Project members can view attachments of issues in accessible projects
create policy "Project members can read attachments"
  on public.attachments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = attachments.issue_id
        and public.is_project_member(i.project_id)
    )
  );

-- RPC: add_attachment
create or replace function public.add_attachment(
  p_issue_id uuid,
  p_filename text,
  p_storage_path text,
  p_mime_type text default null,
  p_size_bytes bigint default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_role text;
  v_filename text;
  v_storage_path text;
  v_attachment_id uuid;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_filename := nullif(trim(p_filename), '');
  if v_filename is null then
    raise exception 'VALIDATION: Filename is required' using errcode = '22023';
  end if;

  v_storage_path := nullif(trim(p_storage_path), '');
  if v_storage_path is null then
    raise exception 'VALIDATION: Storage path is required' using errcode = '22023';
  end if;

  if p_size_bytes < 0 or p_size_bytes > 52428800 then
    raise exception 'VALIDATION: File size must be between 0 and 50MB' using errcode = '22023';
  end if;

  select project_id into v_project_id
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Lock project row
  select is_archived into v_archived
  from public.projects
  where id = v_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.attachments (
    issue_id,
    uploader_id,
    filename,
    storage_path,
    mime_type,
    size_bytes,
    created_at
  ) values (
    p_issue_id,
    v_user,
    v_filename,
    v_storage_path,
    nullif(trim(p_mime_type), ''),
    p_size_bytes,
    v_now
  ) returning id into v_attachment_id;

  -- Update issue updated_at
  update public.issues
  set updated_at = v_now
  where id = p_issue_id;

  -- Insert audit event
  insert into public.issue_events (
    issue_id,
    actor_id,
    event_type,
    field_name,
    new_value,
    metadata
  ) values (
    p_issue_id,
    v_user,
    'ATTACHMENT_ADDED',
    'attachment',
    to_jsonb(v_filename),
    jsonb_build_object(
      'attachment_id', v_attachment_id,
      'filename', v_filename,
      'mime_type', p_mime_type,
      'size_bytes', p_size_bytes
    )
  );

  return v_attachment_id;
end;
$$;

revoke execute on function public.add_attachment(uuid, text, text, text, bigint) from anon, public;
grant execute on function public.add_attachment(uuid, text, text, text, bigint) to authenticated;

-- RPC: delete_attachment
create or replace function public.delete_attachment(
  p_attachment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_att record;
  v_archived boolean;
  v_role text;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select a.*, i.project_id
  into v_att
  from public.attachments a
  join public.issues i on i.id = a.issue_id
  where a.id = p_attachment_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select is_archived into v_archived
  from public.projects
  where id = v_att.project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_att.project_id);
  if v_att.uploader_id <> v_user and v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.attachments
  where id = p_attachment_id;

  -- Insert audit event
  insert into public.issue_events (
    issue_id,
    actor_id,
    event_type,
    field_name,
    old_value,
    metadata
  ) values (
    v_att.issue_id,
    v_user,
    'ATTACHMENT_DELETED',
    'attachment',
    to_jsonb(v_att.filename),
    jsonb_build_object(
      'attachment_id', p_attachment_id,
      'filename', v_att.filename,
      'storage_path', v_att.storage_path
    )
  );
end;
$$;

revoke execute on function public.delete_attachment(uuid) from anon, public;
grant execute on function public.delete_attachment(uuid) to authenticated;

-- Realtime publication for attachments
alter publication supabase_realtime add table public.attachments;
-- Migration 026: Phase 17 - Issue Templates
-- Table, RLS, and RPCs for markdown issue templates

create table if not exists public.issue_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (char_length(trim(description)) <= 280),
  issue_type text not null check (issue_type in ('BUG', 'ENHANCEMENT', 'TASK', 'SECURITY', 'PERFORMANCE', 'REGRESSION')),
  body_template text not null check (char_length(trim(body_template)) <= 10000),
  default_priority text check (default_priority in ('P0', 'P1', 'P2', 'P3', 'P4')),
  default_severity text check (default_severity in ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL')),
  default_component_id uuid references public.components (id) on delete set null,
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.issue_templates is 'Standard markdown templates for reporting bugs, security issues, and tasks.';

create index if not exists idx_issue_templates_project_id on public.issue_templates(project_id);

alter table public.issue_templates enable row level security;

create policy "Project members can read issue templates"
  on public.issue_templates
  for select
  to authenticated
  using (public.is_project_member(project_id));

-- Trigger for updated_at
create trigger issue_templates_set_updated_at
  before update on public.issue_templates
  for each row execute procedure public.set_updated_at();

-- RPC: create_issue_template
create or replace function public.create_issue_template(
  p_project_id uuid,
  p_name text,
  p_description text default null,
  p_issue_type text default 'BUG',
  p_body_template text default '',
  p_default_priority text default null,
  p_default_severity text default null,
  p_default_component_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_archived boolean;
  v_role text;
  v_name text;
  v_body text;
  v_template_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(p_name), '');
  if v_name is null then
    raise exception 'VALIDATION: Template name is required' using errcode = '22023';
  end if;

  v_body := nullif(trim(p_body_template), '');
  if v_body is null then
    raise exception 'VALIDATION: Body template is required' using errcode = '22023';
  end if;

  select is_archived into v_archived
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.issue_templates (
    project_id,
    name,
    description,
    issue_type,
    body_template,
    default_priority,
    default_severity,
    default_component_id,
    created_by
  ) values (
    p_project_id,
    v_name,
    nullif(trim(p_description), ''),
    coalesce(p_issue_type, 'BUG'),
    v_body,
    p_default_priority,
    p_default_severity,
    p_default_component_id,
    v_user
  ) returning id into v_template_id;

  return v_template_id;
end;
$$;

revoke execute on function public.create_issue_template(uuid, text, text, text, text, text, text, uuid) from anon, public;
grant execute on function public.create_issue_template(uuid, text, text, text, text, text, text, uuid) to authenticated;

-- RPC: update_issue_template
create or replace function public.update_issue_template(
  p_template_id uuid,
  p_name text,
  p_description text default null,
  p_issue_type text default 'BUG',
  p_body_template text default '',
  p_default_priority text default null,
  p_default_severity text default null,
  p_default_component_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_template record;
  v_archived boolean;
  v_role text;
  v_name text;
  v_body text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(p_name), '');
  if v_name is null then
    raise exception 'VALIDATION: Template name is required' using errcode = '22023';
  end if;

  v_body := nullif(trim(p_body_template), '');
  if v_body is null then
    raise exception 'VALIDATION: Body template is required' using errcode = '22023';
  end if;

  select * into v_template
  from public.issue_templates
  where id = p_template_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select is_archived into v_archived
  from public.projects
  where id = v_template.project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_template.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  update public.issue_templates
  set name = v_name,
      description = nullif(trim(p_description), ''),
      issue_type = coalesce(p_issue_type, 'BUG'),
      body_template = v_body,
      default_priority = p_default_priority,
      default_severity = p_default_severity,
      default_component_id = p_default_component_id,
      updated_at = timezone('utc'::text, now())
  where id = p_template_id;
end;
$$;

revoke execute on function public.update_issue_template(uuid, text, text, text, text, text, text, uuid) from anon, public;
grant execute on function public.update_issue_template(uuid, text, text, text, text, text, text, uuid) to authenticated;

-- RPC: delete_issue_template
create or replace function public.delete_issue_template(
  p_template_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_template record;
  v_archived boolean;
  v_role text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_template
  from public.issue_templates
  where id = p_template_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select is_archived into v_archived
  from public.projects
  where id = v_template.project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_template.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.issue_templates
  where id = p_template_id;
end;
$$;

revoke execute on function public.delete_issue_template(uuid) from anon, public;
grant execute on function public.delete_issue_template(uuid) to authenticated;
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
-- Migration 028: Phase 19 - GitHub Integration & PR Linking
-- Tables, RLS, and RPCs for linking GitHub pull requests, commits, and repository integrations

create table if not exists public.issue_github_links (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  repo_name text not null check (char_length(trim(repo_name)) between 1 and 100),
  link_type text not null check (link_type in ('PULL_REQUEST', 'COMMIT', 'BRANCH')),
  number int,
  url text not null check (char_length(trim(url)) between 1 and 500),
  title text check (char_length(trim(title)) <= 300),
  status text default 'OPEN' check (status in ('OPEN', 'MERGED', 'CLOSED', 'DRAFT')),
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.issue_github_links is 'Linked GitHub pull requests, commits, and branches.';

create index if not exists idx_github_links_issue_id on public.issue_github_links(issue_id);

alter table public.issue_github_links enable row level security;

create policy "Project members can read github links"
  on public.issue_github_links
  for select
  to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = issue_github_links.issue_id
        and public.can_view_issue(i.id)
    )
  );

create table if not exists public.project_integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  provider text not null check (provider in ('GITHUB', 'GITLAB', 'SLACK', 'WEBHOOK')),
  repo_full_name text,
  auto_resolve_enabled boolean default true,
  config jsonb default '{}'::jsonb,
  is_enabled boolean default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (project_id, provider)
);

comment on table public.project_integrations is 'Third-party integrations configuration for projects.';

create index if not exists idx_project_integrations_project_id on public.project_integrations(project_id);

alter table public.project_integrations enable row level security;

create policy "Project members can read project integrations"
  on public.project_integrations
  for select
  to authenticated
  using (public.is_project_member(project_id));

-- Trigger for updated_at
create trigger project_integrations_set_updated_at
  before update on public.project_integrations
  for each row execute procedure public.set_updated_at();

-- RPC: add_github_link
create or replace function public.add_github_link(
  p_issue_id uuid,
  p_repo_name text,
  p_link_type text,
  p_url text,
  p_title text default null,
  p_status text default 'OPEN',
  p_number int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_issue record;
  v_archived boolean;
  v_role text;
  v_repo text;
  v_url text;
  v_link_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_repo := nullif(trim(p_repo_name), '');
  if v_repo is null then
    raise exception 'VALIDATION: Repository name is required' using errcode = '22023';
  end if;

  v_url := nullif(trim(p_url), '');
  if v_url is null then
    raise exception 'VALIDATION: URL is required' using errcode = '22023';
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

  insert into public.issue_github_links (
    issue_id, repo_name, link_type, number, url, title, status, created_by
  ) values (
    p_issue_id, v_repo, p_link_type, p_number, v_url, nullif(trim(p_title), ''), coalesce(p_status, 'OPEN'), v_user
  ) returning id into v_link_id;

  -- Add audit event
  insert into public.issue_events (
    issue_id, actor_id, event_type, field_name, new_value, metadata
  ) values (
    p_issue_id, v_user, 'GITHUB_LINKED', 'github_link', to_jsonb(v_url),
    jsonb_build_object('repo', v_repo, 'type', p_link_type, 'number', p_number, 'title', p_title)
  );

  return v_link_id;
end;
$$;

revoke execute on function public.add_github_link(uuid, text, text, text, text, text, int) from anon, public;
grant execute on function public.add_github_link(uuid, text, text, text, text, text, int) to authenticated;

-- RPC: remove_github_link
create or replace function public.remove_github_link(
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
  v_archived boolean;
  v_role text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select gl.*, i.project_id
  into v_link
  from public.issue_github_links gl
  join public.issues i on i.id = gl.issue_id
  where gl.id = p_link_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select is_archived into v_archived
  from public.projects
  where id = v_link.project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_link.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.issue_github_links
  where id = p_link_id;

  -- Add audit event
  insert into public.issue_events (
    issue_id, actor_id, event_type, field_name, old_value
  ) values (
    v_link.issue_id, v_user, 'GITHUB_UNLINKED', 'github_link', to_jsonb(v_link.url)
  );
end;
$$;

revoke execute on function public.remove_github_link(uuid) from anon, public;
grant execute on function public.remove_github_link(uuid) to authenticated;
-- Migration 029: Phase 20 - Custom Fields, Issue Custom Values & API Tokens
-- Tables, RLS, and RPCs for project-level custom fields and scoped API tokens

create table if not exists public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  field_type text not null check (field_type in ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'USER')),
  config jsonb default '{}'::jsonb,
  is_required boolean default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (project_id, name)
);

comment on table public.custom_fields is 'Project-scoped custom metadata fields.';

create index if not exists idx_custom_fields_project_id on public.custom_fields(project_id);

alter table public.custom_fields enable row level security;

create policy "Project members can read custom fields"
  on public.custom_fields
  for select
  to authenticated
  using (public.is_project_member(project_id));

create table if not exists public.issue_custom_values (
  issue_id uuid not null references public.issues (id) on delete cascade,
  custom_field_id uuid not null references public.custom_fields (id) on delete cascade,
  value jsonb not null,
  primary key (issue_id, custom_field_id)
);

comment on table public.issue_custom_values is 'Values for project custom fields attached to issues.';

create index if not exists idx_issue_custom_values_issue_id on public.issue_custom_values(issue_id);

alter table public.issue_custom_values enable row level security;

create policy "Users who can view issue can read custom values"
  on public.issue_custom_values
  for select
  to authenticated
  using (public.can_view_issue(issue_id));

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  token_hash text not null unique,
  scopes text[] not null default '{"read", "write"}'::text[],
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.api_tokens is 'Personal and organization API access tokens for public REST API.';

create index if not exists idx_api_tokens_user_id on public.api_tokens(user_id);
create index if not exists idx_api_tokens_token_hash on public.api_tokens(token_hash);

alter table public.api_tokens enable row level security;

create policy "Users can read own api tokens"
  on public.api_tokens
  for select
  to authenticated
  using (user_id = auth.uid());

-- RPC: create_custom_field
create or replace function public.create_custom_field(
  p_project_id uuid,
  p_name text,
  p_field_type text,
  p_config jsonb default '{}'::jsonb,
  p_is_required boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_archived boolean;
  v_role text;
  v_name text;
  v_field_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(p_name), '');
  if v_name is null then
    raise exception 'VALIDATION: Custom field name is required' using errcode = '22023';
  end if;

  select is_archived into v_archived
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.custom_fields (
    project_id, name, field_type, config, is_required
  ) values (
    p_project_id, v_name, p_field_type, coalesce(p_config, '{}'::jsonb), p_is_required
  ) returning id into v_field_id;

  return v_field_id;
end;
$$;

revoke execute on function public.create_custom_field(uuid, text, text, jsonb, boolean) from anon, public;
grant execute on function public.create_custom_field(uuid, text, text, jsonb, boolean) to authenticated;

-- RPC: delete_custom_field
create or replace function public.delete_custom_field(
  p_field_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_field record;
  v_archived boolean;
  v_role text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_field
  from public.custom_fields
  where id = p_field_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select is_archived into v_archived
  from public.projects
  where id = v_field.project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_field.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.custom_fields
  where id = p_field_id;
end;
$$;

revoke execute on function public.delete_custom_field(uuid) from anon, public;
grant execute on function public.delete_custom_field(uuid) to authenticated;

-- RPC: set_issue_custom_value
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

  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.issue_custom_values (issue_id, custom_field_id, value)
  values (p_issue_id, p_custom_field_id, p_value)
  on conflict (issue_id, custom_field_id)
  do update set value = excluded.value;
end;
$$;

revoke execute on function public.set_issue_custom_value(uuid, uuid, jsonb) from anon, public;
grant execute on function public.set_issue_custom_value(uuid, uuid, jsonb) to authenticated;

-- RPC: create_api_token
create or replace function public.create_api_token(
  p_organization_id uuid,
  p_name text,
  p_token_hash text,
  p_scopes text[] default '{"read", "write"}'::text[],
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_token_id uuid;
  v_name text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(p_name), '');
  if v_name is null then
    raise exception 'VALIDATION: Token name is required' using errcode = '22023';
  end if;

  if not public.is_org_member(p_organization_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.api_tokens (
    user_id, organization_id, name, token_hash, scopes, expires_at
  ) values (
    v_user, p_organization_id, v_name, p_token_hash, p_scopes, p_expires_at
  ) returning id into v_token_id;

  return v_token_id;
end;
$$;

revoke execute on function public.create_api_token(uuid, text, text, text[], timestamptz) from anon, public;
grant execute on function public.create_api_token(uuid, text, text, text[], timestamptz) to authenticated;

-- RPC: revoke_api_token
create or replace function public.revoke_api_token(
  p_token_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  delete from public.api_tokens
  where id = p_token_id and user_id = v_user;
end;
$$;

revoke execute on function public.revoke_api_token(uuid) from anon, public;
grant execute on function public.revoke_api_token(uuid) to authenticated;
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
-- Migration 031: API token authentication and private attachment storage hardening

-- Private bucket. Storage object policies below enforce issue-level access.
insert into storage.buckets (id, name, public, file_size_limit)
values ('issue-attachments', 'issue-attachments', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- Attachment storage paths must be issue-id prefixed.
create policy "Members can upload issue attachments"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'issue-attachments'
    and (storage.foldername(name))[1] is not null
    and public.can_comment_on_issue((storage.foldername(name))[1]::uuid)
  );

create policy "Issue viewers can download attachments"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'issue-attachments'
    and (storage.foldername(name))[1] is not null
    and public.can_view_issue((storage.foldername(name))[1]::uuid)
  );

create policy "Owners and maintainers can delete attachments"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'issue-attachments'
    and (
      owner_id = (select auth.uid()::text)
      or public.can_manage_project((select i.project_id from public.issues i where i.id = (storage.foldername(name))[1]::uuid))
    )
  );

-- Enforce storage path ownership at the metadata boundary.
create or replace function public.add_attachment(
  p_issue_id uuid,
  p_filename text,
  p_storage_path text,
  p_mime_type text default null,
  p_size_bytes bigint default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_role text;
  v_filename text;
  v_storage_path text;
  v_attachment_id uuid;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  v_filename := nullif(trim(p_filename), '');
  v_storage_path := nullif(trim(p_storage_path), '');
  if v_filename is null or char_length(v_filename) > 255 then
    raise exception 'VALIDATION: Filename is required and must be <= 255 characters' using errcode = '22023';
  end if;
  if v_storage_path is null or v_storage_path !~ ('^' || p_issue_id::text || '/[^/]+$') then
    raise exception 'VALIDATION: Storage path must be scoped to the issue' using errcode = '22023';
  end if;
  if p_size_bytes < 0 or p_size_bytes > 52428800 then
    raise exception 'VALIDATION: File size must be between 0 and 50MB' using errcode = '22023';
  end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  insert into public.attachments (issue_id, uploader_id, filename, storage_path, mime_type, size_bytes, created_at)
  values (p_issue_id, v_user, v_filename, v_storage_path, nullif(trim(p_mime_type), ''), p_size_bytes, v_now)
  returning id into v_attachment_id;
  update public.issues set updated_at = v_now where id = p_issue_id;
  insert into public.issue_events (issue_id, actor_id, event_type, field_name, new_value, metadata)
  values (p_issue_id, v_user, 'ATTACHMENT_ADDED', 'attachment', to_jsonb(v_filename), jsonb_build_object('attachment_id', v_attachment_id, 'filename', v_filename, 'mime_type', p_mime_type, 'size_bytes', p_size_bytes));
  return v_attachment_id;
end;
$$;

revoke execute on function public.add_attachment(uuid, text, text, text, bigint) from anon, public;
grant execute on function public.add_attachment(uuid, text, text, text, bigint) to authenticated;

-- Token lookup for API routes. Only a SHA-256 hash is accepted; plaintext tokens are never stored.
create or replace function public.authenticate_api_token(p_token_hash text)
returns table (token_id uuid, user_id uuid, organization_id uuid, scopes text[])
language sql
security definer
stable
set search_path = public
as $$
  select t.id, t.user_id, t.organization_id, t.scopes
  from public.api_tokens t
  where t.token_hash = p_token_hash
    and (t.expires_at is null or t.expires_at > timezone('utc'::text, now()))
$$;

revoke execute on function public.authenticate_api_token(text) from public;
grant execute on function public.authenticate_api_token(text) to anon, authenticated;

create or replace function public.touch_api_token(p_token_hash text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.api_tokens
  set last_used_at = timezone('utc'::text, now())
  where token_hash = p_token_hash
    and (expires_at is null or expires_at > timezone('utc'::text, now()));
$$;

revoke execute on function public.touch_api_token(text) from public;
grant execute on function public.touch_api_token(text) to anon, authenticated;

-- API mutation wrappers establish the token owner as the transaction-local auth subject,
-- then reuse the existing RPC authorization and audit logic.
create or replace function public.api_create_issue(p_token_hash text, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
  v_issue_number integer;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not ('write' = any(v_token.scopes)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  v_issue_number := public.create_issue(
    (p_payload->>'project_id')::uuid,
    p_payload->>'title', p_payload->>'type', p_payload->>'description',
    p_payload->>'priority', p_payload->>'severity', nullif(p_payload->>'component_id','')::uuid,
    nullif(p_payload->>'assignee_id','')::uuid, p_payload->>'environment',
    p_payload->>'steps_to_reproduce', p_payload->>'expected_behavior', p_payload->>'actual_behavior'
  );
  perform public.touch_api_token(p_token_hash);
  return v_issue_number;
end;
$$;

revoke execute on function public.api_create_issue(text, jsonb) from anon, public;
grant execute on function public.api_create_issue(text, jsonb) to authenticated;

create or replace function public.api_update_issue(p_token_hash text, p_issue_id uuid, p_updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not ('write' = any(v_token.scopes)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  perform public.update_issue_fields(p_issue_id, p_updates);
  perform public.touch_api_token(p_token_hash);
end;
$$;

revoke execute on function public.api_update_issue(text, uuid, jsonb) from anon, public;
grant execute on function public.api_update_issue(text, uuid, jsonb) to authenticated;
-- Migration 032: enforce restricted issue access on every issue-owned mutation

create or replace function public.enforce_issue_visibility_access()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_issue_id uuid;
  v_target_issue_id uuid;
  v_service_role boolean := coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
begin
  if v_service_role then
    return new;
  end if;
  if tg_table_name = 'issues' then
    v_issue_id := coalesce(new.id, old.id);
    if not public.can_view_issue(v_issue_id) then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  elsif tg_table_name = 'issue_links' then
    v_issue_id := coalesce(new.source_issue_id, old.source_issue_id);
    v_target_issue_id := coalesce(new.target_issue_id, old.target_issue_id);
    if not public.can_view_issue(v_issue_id) or not public.can_view_issue(v_target_issue_id) then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  else
    v_issue_id := coalesce(new.issue_id, old.issue_id);
    if not public.can_view_issue(v_issue_id) then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- These triggers protect privileged RPCs as well as any future write path.
drop trigger if exists enforce_issue_visibility_on_issues on public.issues;
create trigger enforce_issue_visibility_on_issues
before update on public.issues
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_issue_events on public.issue_events;
create trigger enforce_issue_visibility_on_issue_events
before insert on public.issue_events
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_issue_labels on public.issue_labels;
create trigger enforce_issue_visibility_on_issue_labels
before insert or update on public.issue_labels
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_issue_watchers on public.issue_watchers;
create trigger enforce_issue_visibility_on_issue_watchers
before insert or update on public.issue_watchers
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_issue_links on public.issue_links;
create trigger enforce_issue_visibility_on_issue_links
before insert or update on public.issue_links
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_comments on public.comments;
create trigger enforce_issue_visibility_on_comments
before insert or update on public.comments
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_attachments on public.attachments;
create trigger enforce_issue_visibility_on_attachments
before insert or update on public.attachments
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_github_links on public.issue_github_links;
create trigger enforce_issue_visibility_on_github_links
before insert or update on public.issue_github_links
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_custom_values on public.issue_custom_values;
create trigger enforce_issue_visibility_on_custom_values
before insert or update on public.issue_custom_values
for each row execute procedure public.enforce_issue_visibility_access();

-- Replace any prior policy versions with the restricted-aware definitions.
drop policy if exists "Project members can read the audit trail" on public.issue_events;
drop policy if exists "Project members and grantees can read issue events" on public.issue_events;
create policy "Project members and grantees can read issue events"
  on public.issue_events for select to authenticated
  using (public.can_view_issue(issue_id));

drop policy if exists "Project members can read issue watchers" on public.issue_watchers;
drop policy if exists "Project members and grantees can read issue watchers" on public.issue_watchers;
create policy "Project members and grantees can read issue watchers"
  on public.issue_watchers for select to authenticated
  using (public.can_view_issue(issue_id));

drop policy if exists "Project members can read issue labels" on public.issue_labels;
drop policy if exists "Project members and grantees can read issue labels" on public.issue_labels;
create policy "Project members and grantees can read issue labels"
  on public.issue_labels for select to authenticated
  using (public.can_view_issue(issue_id));

drop policy if exists "Project members can read issue links" on public.issue_links;
drop policy if exists "Project members and grantees can read issue links" on public.issue_links;
create policy "Project members and grantees can read issue links"
  on public.issue_links for select to authenticated
  using (public.can_view_issue(source_issue_id) and public.can_view_issue(target_issue_id));

-- Permit only safe token scopes and cap their number.
alter table public.api_tokens drop constraint if exists api_tokens_scopes_check;
alter table public.api_tokens add constraint api_tokens_scopes_check
  check (cardinality(scopes) between 1 and 2 and scopes <@ array['read', 'write']::text[]);
-- Migration 033: GitHub webhook ingestion and safe server-side link recording

create or replace function public.record_github_webhook(
  p_project_id uuid,
  p_issue_id uuid,
  p_repo_name text,
  p_link_type text,
  p_url text,
  p_title text default null,
  p_status text default 'OPEN',
  p_number integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link_id uuid;
begin
  -- This function is intentionally callable only by the server-side service role.
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id and not is_archived) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.issues where id = p_issue_id and project_id = p_project_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- The webhook has no authenticated TraceBox actor; audit actor_id remains null.
  insert into public.issue_github_links (issue_id, repo_name, link_type, number, url, title, status, created_by)
  values (p_issue_id, trim(p_repo_name), p_link_type, p_number, trim(p_url), nullif(trim(p_title), ''), coalesce(p_status, 'OPEN'), null)
  on conflict do nothing
  returning id into v_link_id;

  if v_link_id is not null then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, new_value, metadata)
    values (p_issue_id, null, 'GITHUB_LINKED', 'github_link', to_jsonb(trim(p_url)), jsonb_build_object('repo', trim(p_repo_name), 'type', p_link_type, 'number', p_number, 'source', 'github_webhook'));
  end if;
  return v_link_id;
end;
$$;

revoke execute on function public.record_github_webhook(uuid, uuid, text, text, text, text, text, integer) from anon, authenticated, public;
grant execute on function public.record_github_webhook(uuid, uuid, text, text, text, text, text, integer) to service_role;
-- Migration 034: final security, storage, integrity, and index hardening

-- Candidate search must not disclose restricted issue titles or IDs.
create or replace function public.find_duplicate_candidates(p_project_id uuid, p_title text, p_limit integer default 5)
returns table (issue_id uuid, issue_number bigint, title text, similarity double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_title is null or char_length(v_title) < 3 then raise exception 'VALIDATION: Title must be at least 3 characters' using errcode = '22023'; end if;
  return query
    select i.id, i.issue_number, i.title, similarity(i.title, v_title)
    from public.issues i
    where i.project_id = p_project_id
      and public.can_view_issue(i.id)
      and i.title % v_title
      and similarity(i.title, v_title) > 0.2
    order by similarity(i.title, v_title) desc
    limit v_limit;
end;
$$;

-- Restricted access grants are only meaningful for restricted issues and same-project members.
create or replace function public.grant_issue_access(p_issue_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_issue record; v_archived boolean; v_role text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select id, project_id, reporter_id, visibility into v_issue from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_issue.project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if v_issue.visibility <> 'RESTRICTED' then raise exception 'VALIDATION: Access grants require restricted visibility' using errcode = '22023'; end if;
  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') and v_issue.reporter_id <> v_user then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if not exists (select 1 from public.project_members pm where pm.project_id = v_issue.project_id and pm.user_id = p_user_id) then raise exception 'VALIDATION: Grantee must be a project member' using errcode = '22023'; end if;
  insert into public.issue_access(issue_id, user_id, granted_by) values (p_issue_id, p_user_id, v_user) on conflict do nothing;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, new_value) values (p_issue_id, v_user, 'ACCESS_GRANTED', 'issue_access', to_jsonb(p_user_id::text));
end; $$;

create or replace function public.revoke_issue_access(p_issue_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_issue record; v_archived boolean; v_role text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id, reporter_id into v_issue from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_issue.project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') and v_issue.reporter_id <> v_user then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.issue_access where issue_id = p_issue_id and user_id = p_user_id;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value) values (p_issue_id, v_user, 'ACCESS_REVOKED', 'issue_access', to_jsonb(p_user_id::text));
end; $$;

create or replace function public.set_issue_visibility(p_issue_id uuid, p_visibility text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_issue record; v_archived boolean; v_role text; v_visibility text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_visibility := upper(trim(coalesce(p_visibility, 'PROJECT')));
  if v_visibility not in ('PUBLIC', 'PROJECT', 'RESTRICTED') then raise exception 'VALIDATION: Invalid visibility' using errcode = '22023'; end if;
  select id, project_id, visibility, reporter_id into v_issue from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_issue.project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') and v_issue.reporter_id <> v_user then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.issues set visibility = v_visibility, updated_at = timezone('utc'::text, now()) where id = p_issue_id;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value) values (p_issue_id, v_user, 'VISIBILITY_CHANGED', 'visibility', to_jsonb(v_issue.visibility), to_jsonb(v_visibility));
end; $$;

revoke execute on function public.grant_issue_access(uuid, uuid), public.revoke_issue_access(uuid, uuid), public.set_issue_visibility(uuid, text) from anon, public;
grant execute on function public.grant_issue_access(uuid, uuid), public.revoke_issue_access(uuid, uuid), public.set_issue_visibility(uuid, text) to authenticated;

-- Storage policies must enforce issue visibility, membership, and active projects.
drop policy if exists "Members can upload issue attachments" on storage.objects;
create policy "Members can upload issue attachments" on storage.objects for insert to authenticated
with check (
  bucket_id = 'issue-attachments'
  and (storage.foldername(name))[1] is not null
  and public.can_view_issue(((storage.foldername(name))[1])::uuid)
  and public.can_comment_on_issue(((storage.foldername(name))[1])::uuid)
);
drop policy if exists "Owners and maintainers can delete attachments" on storage.objects;
create policy "Owners and maintainers can delete attachments" on storage.objects for delete to authenticated
using (
  bucket_id = 'issue-attachments'
  and public.can_view_issue(((storage.foldername(name))[1])::uuid)
  and exists (select 1 from public.issues i join public.projects p on p.id = i.project_id where i.id = ((storage.foldername(name))[1])::uuid and not p.is_archived)
  and (owner_id = (select auth.uid()::text) or public.can_manage_project((select i.project_id from public.issues i where i.id = ((storage.foldername(name))[1])::uuid)))
);

-- Supporting indexes for foreign-key deletes and webhook lookups.
create index if not exists idx_components_default_assignee_id on public.components(default_assignee_id);
create index if not exists idx_workflow_transitions_from_state_id on public.workflow_transitions(from_state_id);
create index if not exists idx_workflow_transitions_to_state_id on public.workflow_transitions(to_state_id);
create index if not exists idx_issue_templates_default_component_id on public.issue_templates(default_component_id);
create index if not exists idx_issue_access_granted_by on public.issue_access(granted_by);
create index if not exists idx_issue_github_links_created_by on public.issue_github_links(created_by);
create index if not exists idx_project_integrations_lookup on public.project_integrations(provider, repo_full_name, is_enabled);
create index if not exists idx_issue_custom_values_field_id on public.issue_custom_values(custom_field_id);
-- Migration 035: API wrapper correctness, integration management, and metadata integrity

-- Correct API create argument order and bind token to its organization.
create or replace function public.api_create_issue(p_token_hash text, p_payload jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_token record; v_org uuid; v_project_org uuid; v_issue_number integer;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not ('write' = any(v_token.scopes)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_org := nullif(p_payload->>'project_id', '')::uuid;
  select organization_id into v_project_org from public.projects where id = v_org and not is_archived;
  if v_project_org is null or v_project_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  v_issue_number := public.create_issue(
    v_org,
    p_payload->>'title',
    coalesce(p_payload->>'type', 'BUG'),
    p_payload->>'description',
    coalesce(p_payload->>'priority', 'P2'),
    coalesce(p_payload->>'severity', 'MAJOR'),
    nullif(p_payload->>'component_id', '')::uuid,
    nullif(p_payload->>'assignee_id', '')::uuid,
    p_payload->>'environment',
    p_payload->>'steps_to_reproduce',
    p_payload->>'expected_behavior',
    p_payload->>'actual_behavior'
  );
  perform public.touch_api_token(p_token_hash);
  return v_issue_number;
end; $$;

create or replace function public.api_update_issue(p_token_hash text, p_issue_id uuid, p_updates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_token record; v_project_org uuid;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not ('write' = any(v_token.scopes)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select p.organization_id into v_project_org from public.issues i join public.projects p on p.id = i.project_id where i.id = p_issue_id and not p.is_archived;
  if v_project_org is null or v_project_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  perform public.update_issue_fields(p_issue_id, p_updates);
  perform public.touch_api_token(p_token_hash);
end; $$;

revoke execute on function public.api_create_issue(text, jsonb), public.api_update_issue(text, uuid, jsonb) from anon, public;
grant execute on function public.api_create_issue(text, jsonb), public.api_update_issue(text, uuid, jsonb) to authenticated, service_role;

-- Prevent cross-project default components in templates.
create or replace function public.validate_issue_template_component()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.default_component_id is not null and not exists (
    select 1 from public.components c where c.id = new.default_component_id and c.project_id = new.project_id
  ) then
    raise exception 'VALIDATION: Template component must belong to the template project' using errcode = '22023';
  end if;
  return new;
end; $$;
drop trigger if exists issue_template_component_project on public.issue_templates;
create trigger issue_template_component_project before insert or update on public.issue_templates for each row execute procedure public.validate_issue_template_component();

-- Make GitHub webhook retries idempotent for the same issue/link URL.
create unique index if not exists issue_github_links_natural_idx
  on public.issue_github_links(issue_id, repo_name, link_type, (coalesce(number, -1)), url);

-- Authenticated project managers can configure GitHub repository integrations.
create or replace function public.upsert_github_integration(p_project_id uuid, p_repo_full_name text, p_auto_resolve_enabled boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_archived boolean; v_role text; v_id uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.project_integrations(provider, project_id, repo_full_name, auto_resolve_enabled, is_enabled)
  values ('GITHUB', p_project_id, trim(p_repo_full_name), coalesce(p_auto_resolve_enabled, true), true)
  on conflict (project_id, provider) do update set repo_full_name = excluded.repo_full_name, auto_resolve_enabled = excluded.auto_resolve_enabled, is_enabled = true, updated_at = timezone('utc'::text, now())
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.remove_github_integration(p_project_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_archived boolean;
begin
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.project_integrations where project_id = p_project_id and provider = 'GITHUB';
end; $$;
revoke execute on function public.upsert_github_integration(uuid, text, boolean), public.remove_github_integration(uuid) from anon, public;
grant execute on function public.upsert_github_integration(uuid, text, boolean), public.remove_github_integration(uuid) to authenticated;
-- Migration 036: assignment/status/mention notification coverage

create or replace function public.on_issue_updated_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_watcher record; v_actor uuid := auth.uid(); v_type text; v_data jsonb;
begin
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform public.dispatch_issue_notification(new.assignee_id, v_actor, new.id, 'ASSIGNED', jsonb_build_object('issue_number', new.issue_number, 'title', new.title));
  end if;
  if new.status_id is distinct from old.status_id then
    for v_watcher in select user_id from public.issue_watchers where issue_id = new.id and user_id <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid) loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.id, 'STATUS_CHANGED', jsonb_build_object('issue_number', new.issue_number, 'title', new.title));
    end loop;
  end if;
  return new;
end; $$;

drop trigger if exists trg_issue_updated_notifications on public.issues;
create trigger trg_issue_updated_notifications after update of assignee_id, status_id on public.issues for each row execute procedure public.on_issue_updated_notifications();

create or replace function public.on_comment_mentions_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_match text[]; v_profile record; v_issue record; v_actor uuid := auth.uid();
begin
  select issue_number, title into v_issue from public.issues where id = new.issue_id;
  for v_match in select regexp_matches(new.body, '@([A-Za-z0-9_.-]+)', 'g') loop
    select p.id into v_profile from public.profiles p where lower(p.display_name) = lower(v_match[1]) limit 1;
    if found then
      perform public.dispatch_issue_notification(v_profile.id, v_actor, new.issue_id, 'MENTION', jsonb_build_object('issue_number', v_issue.issue_number, 'title', v_issue.title, 'excerpt', left(new.body, 140)));
    end if;
  end loop;
  return new;
end; $$;

drop trigger if exists trg_comment_mentions_notifications on public.comments;
create trigger trg_comment_mentions_notifications after insert on public.comments for each row execute procedure public.on_comment_mentions_notifications();
-- Migration 037: prevent restricted issue watcher/mention notification leaks

create or replace function public.toggle_watch_issue(p_issue_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_project_id uuid; v_watching boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select exists(select 1 from public.issue_watchers where issue_id = p_issue_id and user_id = v_user) into v_watching;
  if v_watching then delete from public.issue_watchers where issue_id = p_issue_id and user_id = v_user; return false; end if;
  insert into public.issue_watchers(issue_id, user_id) values (p_issue_id, v_user) on conflict do nothing;
  return true;
end; $$;

create or replace function public.watch_issue(p_issue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.issue_watchers(issue_id, user_id) values (p_issue_id, v_user) on conflict do nothing;
end; $$;

create or replace function public.unwatch_issue(p_issue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.issue_watchers where issue_id = p_issue_id and user_id = v_user;
end; $$;

revoke execute on function public.toggle_watch_issue(uuid), public.watch_issue(uuid), public.unwatch_issue(uuid) from anon, public;
grant execute on function public.toggle_watch_issue(uuid), public.watch_issue(uuid), public.unwatch_issue(uuid) to authenticated;

-- Replace mention notifications with access-aware recipient checks.
create or replace function public.on_comment_mentions_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_match text[]; v_profile record; v_issue record; v_actor uuid := auth.uid();
begin
  select i.issue_number, i.title, i.visibility, i.reporter_id, i.assignee_id, i.project_id into v_issue from public.issues i where i.id = new.issue_id;
  for v_match in select regexp_matches(new.body, '@([A-Za-z0-9_.-]+)', 'g') loop
    select p.id into v_profile from public.profiles p where lower(p.display_name) = lower(v_match[1]) limit 1;
    if found and (v_issue.visibility <> 'RESTRICTED' or v_profile.id = v_issue.reporter_id or v_profile.id = v_issue.assignee_id or exists(select 1 from public.issue_access ia where ia.issue_id = new.issue_id and ia.user_id = v_profile.id) or exists(select 1 from public.project_members pm where pm.project_id = v_issue.project_id and pm.user_id = v_profile.id and pm.role = 'MAINTAINER')) then
      perform public.dispatch_issue_notification(v_profile.id, v_actor, new.issue_id, 'MENTION', jsonb_build_object('issue_number', v_issue.issue_number, 'title', v_issue.title, 'excerpt', left(new.body, 140)));
    end if;
  end loop;
  return new;
end; $$;
-- Migration 038: final archived-project and token invariant hardening

create or replace function public.toggle_watch_issue(p_issue_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_project_id uuid; v_archived boolean; v_watching boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select exists(select 1 from public.issue_watchers where issue_id = p_issue_id and user_id = v_user) into v_watching;
  if v_watching then delete from public.issue_watchers where issue_id = p_issue_id and user_id = v_user; return false; end if;
  insert into public.issue_watchers(issue_id, user_id) values (p_issue_id, v_user) on conflict do nothing;
  return true;
end; $$;

create or replace function public.watch_issue(p_issue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_project_id uuid; v_archived boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.issue_watchers(issue_id, user_id) values (p_issue_id, v_user) on conflict do nothing;
end; $$;

create or replace function public.unwatch_issue(p_issue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_project_id uuid; v_archived boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.issue_watchers where issue_id = p_issue_id and user_id = v_user;
end; $$;

revoke execute on function public.toggle_watch_issue(uuid), public.watch_issue(uuid), public.unwatch_issue(uuid) from anon, public;
grant execute on function public.toggle_watch_issue(uuid), public.watch_issue(uuid), public.unwatch_issue(uuid) to authenticated;

alter table public.api_tokens drop constraint if exists api_tokens_token_hash_check;
alter table public.api_tokens add constraint api_tokens_token_hash_check
  check (token_hash ~ '^[0-9a-f]{64}$');
-- Migration 039: production-validation fixes for API, GitHub, links, and custom fields

-- Correct the positional call into create_issue. The previous wrapper passed
-- priority and severity into component_id and priority respectively.
create or replace function public.api_create_issue(p_token_hash text, p_payload jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_token record; v_project_id uuid; v_project_org uuid; v_issue_number integer;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not (('write' = any(v_token.scopes)) or ('issues:write' = any(v_token.scopes))) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  v_project_id := nullif(p_payload->>'project_id', '')::uuid;
  select organization_id into v_project_org from public.projects where id = v_project_id and not is_archived;
  if v_project_org is null or v_project_org <> v_token.organization_id then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  v_issue_number := public.create_issue(
    v_project_id,
    p_payload->>'title',
    coalesce(p_payload->>'type', 'BUG'),
    p_payload->>'description',
    nullif(p_payload->>'component_id', '')::uuid,
    coalesce(p_payload->>'priority', 'P2'),
    coalesce(p_payload->>'severity', 'MAJOR'),
    nullif(p_payload->>'assignee_id', '')::uuid,
    p_payload->>'environment',
    p_payload->>'steps_to_reproduce',
    p_payload->>'expected_behavior',
    p_payload->>'actual_behavior'
  );
  perform public.touch_api_token(p_token_hash);
  return v_issue_number;
end; $$;

create or replace function public.api_update_issue(p_token_hash text, p_issue_id uuid, p_updates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_token record; v_project_org uuid;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not (('write' = any(v_token.scopes)) or ('issues:write' = any(v_token.scopes))) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select p.organization_id into v_project_org from public.issues i join public.projects p on p.id = i.project_id where i.id = p_issue_id and not p.is_archived;
  if v_project_org is null or v_project_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  perform public.update_issue_fields(p_issue_id, p_updates);
  perform public.touch_api_token(p_token_hash);
end; $$;

-- API comment wrapper keeps token impersonation and comment audit behavior in SQL.
create or replace function public.api_add_comment(p_token_hash text, p_issue_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_token record; v_project_org uuid; v_comment_id uuid;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not (('write' = any(v_token.scopes)) or ('comments:write' = any(v_token.scopes))) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select p.organization_id into v_project_org from public.issues i join public.projects p on p.id = i.project_id where i.id = p_issue_id and not p.is_archived;
  if v_project_org is null or v_project_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  v_comment_id := public.add_comment(p_issue_id, p_body);
  perform public.touch_api_token(p_token_hash);
  return v_comment_id;
end; $$;

revoke execute on function public.api_add_comment(text, uuid, text) from anon, public;
grant execute on function public.api_add_comment(text, uuid, text) to authenticated, service_role;

-- Support both legacy broad scopes and the documented resource scopes.
alter table public.api_tokens drop constraint if exists api_tokens_scopes_check;
alter table public.api_tokens add constraint api_tokens_scopes_check check (
  cardinality(scopes) between 1 and 8
  and scopes <@ array['read', 'write', 'projects:read', 'issues:read', 'issues:write', 'comments:write', 'milestones:read', 'search:read']::text[]
);

-- Store canonical repository names for reliable webhook matching.
create or replace function public.upsert_github_integration(p_project_id uuid, p_repo_full_name text, p_auto_resolve_enabled boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_archived boolean; v_role text; v_id uuid; v_repo text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_repo := lower(trim(coalesce(p_repo_full_name, '')));
  if v_repo !~ '^[^/[:space:]]+/[^/[:space:]]+$' then raise exception 'VALIDATION: Use owner/repository format' using errcode = '22023'; end if;
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.project_integrations(provider, project_id, repo_full_name, auto_resolve_enabled, is_enabled)
  values ('GITHUB', p_project_id, v_repo, coalesce(p_auto_resolve_enabled, true), true)
  on conflict (project_id, provider) do update set repo_full_name = excluded.repo_full_name, auto_resolve_enabled = excluded.auto_resolve_enabled, is_enabled = true, updated_at = timezone('utc'::text, now())
  returning id into v_id;
  return v_id;
end; $$;

-- Upsert webhook metadata so OPEN links become MERGED/CLOSED instead of staying stale.
create or replace function public.record_github_webhook(
  p_project_id uuid,
  p_issue_id uuid,
  p_repo_name text,
  p_link_type text,
  p_url text,
  p_title text default null,
  p_status text default 'OPEN',
  p_number integer default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_link_id uuid; v_old_status text; v_repo text := lower(trim(p_repo_name));
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_link_type not in ('PULL_REQUEST', 'COMMIT', 'BRANCH') or upper(coalesce(p_status, 'OPEN')) not in ('OPEN', 'MERGED', 'CLOSED', 'DRAFT') then raise exception 'VALIDATION' using errcode = '22023'; end if;
  if not exists (select 1 from public.projects where id = p_project_id and not is_archived) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.issues where id = p_issue_id and project_id = p_project_id) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select status into v_old_status from public.issue_github_links
  where issue_id = p_issue_id and lower(repo_name) = v_repo and link_type = p_link_type and coalesce(number, -1) = coalesce(p_number, -1) and url = trim(p_url)
  limit 1;
  insert into public.issue_github_links(issue_id, repo_name, link_type, number, url, title, status, created_by)
  values (p_issue_id, v_repo, p_link_type, p_number, trim(p_url), nullif(trim(p_title), ''), upper(coalesce(p_status, 'OPEN')), null)
  on conflict (issue_id, repo_name, link_type, (coalesce(number, -1)), url)
  do update set title = excluded.title, status = excluded.status
  returning id into v_link_id;
  if v_old_status is null then
    insert into public.issue_events(issue_id, actor_id, event_type, field_name, new_value, metadata)
    values (p_issue_id, null, 'GITHUB_LINKED', 'github_link', to_jsonb(trim(p_url)), jsonb_build_object('repo', v_repo, 'type', p_link_type, 'number', p_number, 'status', upper(coalesce(p_status, 'OPEN')), 'source', 'github_webhook'));
  elsif v_old_status is distinct from upper(coalesce(p_status, 'OPEN')) then
    insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
    values (p_issue_id, null, 'GITHUB_UPDATED', 'github_status', to_jsonb(v_old_status), to_jsonb(upper(coalesce(p_status, 'OPEN'))), jsonb_build_object('repo', v_repo, 'number', p_number, 'url', trim(p_url), 'source', 'github_webhook'));
  end if;
  return v_link_id;
end; $$;

-- Service-role-only resolution used when a merged PR contains a closing keyword.
create or replace function public.resolve_issue_from_github(p_project_id uuid, p_issue_id uuid, p_repo_name text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_issue record; v_state_id uuid; v_now timestamptz := timezone('utc'::text, now());
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.project_integrations pi
    where pi.project_id = p_project_id and pi.provider = 'GITHUB' and pi.is_enabled and pi.auto_resolve_enabled and lower(pi.repo_full_name) = lower(trim(p_repo_name))
  ) then return false; end if;
  select * into v_issue from public.issues where id = p_issue_id and project_id = p_project_id for update;
  if not found or v_issue.resolution is not null then return false; end if;
  select id into v_state_id from public.workflow_states where project_id = p_project_id and category = 'RESOLVED' order by position limit 1;
  if v_state_id is null or v_state_id = v_issue.status_id then return false; end if;
  update public.issues set status_id = v_state_id, resolution = 'FIXED', resolved_at = v_now, closed_at = null, updated_at = v_now where id = p_issue_id;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (p_issue_id, null, 'STATUS_CHANGED', 'status_id', to_jsonb(v_issue.status_id::text), to_jsonb(v_state_id::text), jsonb_build_object('old_state_id', v_issue.status_id, 'new_state_id', v_state_id, 'new_category', 'RESOLVED', 'resolution', 'FIXED', 'source', 'github_webhook'));
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (p_issue_id, null, 'RESOLUTION_CHANGED', 'resolution', to_jsonb(v_issue.resolution), to_jsonb('FIXED'::text), jsonb_build_object('source', 'github_webhook'));
  return true;
end; $$;

revoke execute on function public.resolve_issue_from_github(uuid, uuid, text) from anon, authenticated, public;
grant execute on function public.resolve_issue_from_github(uuid, uuid, text) to service_role;

-- Issue links are general issue edits and require Developer/Maintainer access.
create or replace function public.add_issue_link(p_source_issue_id uuid, p_target_issue_id uuid, p_relationship text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_project_id uuid; v_archived boolean; v_link_id uuid; v_role text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_source_issue_id = p_target_issue_id then raise exception 'VALIDATION: Cannot link issue to itself' using errcode = '22023'; end if;
  if p_relationship not in ('BLOCKS', 'DEPENDS_ON', 'DUPLICATE_OF', 'RELATES_TO', 'CAUSED_BY', 'REGRESSION_OF') then raise exception 'VALIDATION: Invalid relationship' using errcode = '22023'; end if;
  select i.project_id into v_project_id from public.issues i where i.id = p_source_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') or not public.can_view_issue(p_source_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if not exists (select 1 from public.issues i where i.id = p_target_issue_id and i.project_id = v_project_id and public.can_view_issue(i.id)) then raise exception 'VALIDATION: Target issue must be visible in the same project' using errcode = '22023'; end if;
  insert into public.issue_links(source_issue_id, target_issue_id, relationship, created_by) values (p_source_issue_id, p_target_issue_id, p_relationship, v_user) returning id into v_link_id;
  insert into public.issue_events(issue_id, actor_id, event_type, metadata) values (p_source_issue_id, v_user, 'ISSUE_LINKED', jsonb_build_object('target_id', p_target_issue_id, 'relationship', p_relationship));
  if p_relationship = 'DUPLICATE_OF' then
    perform public.transition_issue(p_source_issue_id, (select ws.id from public.workflow_states ws where ws.project_id = v_project_id and ws.category = 'RESOLVED' order by position limit 1), 'DUPLICATE');
  end if;
  return v_link_id;
end; $$;

-- Validate custom-field configuration and values at the database boundary.
create or replace function public.create_custom_field(p_project_id uuid, p_name text, p_field_type text, p_config jsonb default '{}'::jsonb, p_is_required boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_archived boolean; v_role text; v_name text; v_field_id uuid; v_config jsonb := coalesce(p_config, '{}'::jsonb);
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_name := nullif(trim(p_name), '');
  if v_name is null or char_length(v_name) > 80 then raise exception 'VALIDATION: Custom field name must be 1-80 characters' using errcode = '22023'; end if;
  if p_field_type not in ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'USER') then raise exception 'VALIDATION: Invalid custom field type' using errcode = '22023'; end if;
  if p_field_type in ('SINGLE_SELECT', 'MULTI_SELECT') and (jsonb_typeof(v_config->'options') <> 'array' or jsonb_array_length(v_config->'options') = 0) then raise exception 'VALIDATION: Select fields require options' using errcode = '22023'; end if;
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.custom_fields(project_id, name, field_type, config, is_required) values (p_project_id, v_name, p_field_type, v_config, coalesce(p_is_required, false)) returning id into v_field_id;
  return v_field_id;
end; $$;

create or replace function public.set_issue_custom_value(p_issue_id uuid, p_custom_field_id uuid, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_issue record; v_archived boolean; v_role text; v_field record; v_item jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_issue from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_issue.project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') or not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select * into v_field from public.custom_fields where id = p_custom_field_id and project_id = v_issue.project_id;
  if not found then raise exception 'VALIDATION: Custom field does not belong to this project' using errcode = '23503'; end if;
  if p_value is null or jsonb_typeof(p_value) = 'null' or p_value = '""'::jsonb then
    if v_field.is_required then raise exception 'VALIDATION: Required custom field cannot be empty' using errcode = '22023'; end if;
    delete from public.issue_custom_values where issue_id = p_issue_id and custom_field_id = p_custom_field_id;
    return;
  end if;
  if (v_field.field_type in ('TEXT', 'DATE', 'SINGLE_SELECT', 'USER') and jsonb_typeof(p_value) <> 'string')
    or (v_field.field_type = 'NUMBER' and jsonb_typeof(p_value) <> 'number')
    or (v_field.field_type = 'BOOLEAN' and jsonb_typeof(p_value) <> 'boolean')
    or (v_field.field_type = 'MULTI_SELECT' and jsonb_typeof(p_value) <> 'array') then raise exception 'VALIDATION: Custom field value has the wrong type' using errcode = '22023'; end if;
  if v_field.field_type = 'DATE' then perform trim(both '"' from p_value::text)::date; end if;
  if v_field.field_type = 'USER' and not exists (select 1 from public.project_members pm where pm.project_id = v_issue.project_id and pm.user_id = trim(both '"' from p_value::text)::uuid) then raise exception 'VALIDATION: User must be a project member' using errcode = '22023'; end if;
  if v_field.field_type = 'SINGLE_SELECT' and not (v_field.config->'options' @> jsonb_build_array(trim(both '"' from p_value::text))) then raise exception 'VALIDATION: Invalid select option' using errcode = '22023'; end if;
  if v_field.field_type = 'MULTI_SELECT' then
    for v_item in select value from jsonb_array_elements(p_value) loop
      if jsonb_typeof(v_item) <> 'string' or not (v_field.config->'options' @> jsonb_build_array(trim(both '"' from v_item::text))) then raise exception 'VALIDATION: Invalid multi-select option' using errcode = '22023'; end if;
    end loop;
  end if;
  insert into public.issue_custom_values(issue_id, custom_field_id, value) values (p_issue_id, p_custom_field_id, p_value)
  on conflict (issue_id, custom_field_id) do update set value = excluded.value;
end; $$;

-- Owners can toggle whether a saved view is visible to the project.
create or replace function public.update_saved_view_sharing(p_view_id uuid, p_is_shared boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_count integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  update public.saved_views set is_shared = coalesce(p_is_shared, false) where id = p_view_id and created_by = v_user;
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end; $$;
revoke execute on function public.update_saved_view_sharing(uuid, boolean) from anon, public;
grant execute on function public.update_saved_view_sharing(uuid, boolean) to authenticated;

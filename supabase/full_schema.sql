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
-- Migration 040: GitHub App installations, repository bindings, artifacts, and webhook inbox.
-- The legacy project_integrations and issue_github_links rows remain supported while
-- new GitHub App connections use stable GitHub numeric IDs.

create table if not exists public.github_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  github_installation_id bigint not null unique,
  github_account_id bigint not null,
  github_account_login text not null check (char_length(trim(github_account_login)) between 1 and 120),
  github_account_type text not null default 'User' check (github_account_type in ('User', 'Organization')),
  repository_selection text not null default 'selected' check (repository_selection in ('all', 'selected')),
  permissions jsonb not null default '{}'::jsonb,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED', 'PENDING', 'NEEDS_PERMISSION_UPDATE')),
  installed_by uuid references auth.users (id) on delete set null,
  suspended_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (organization_id, github_installation_id)
);

comment on table public.github_installations is 'Verified GitHub App installations owned by TraceBox organizations.';

create index if not exists github_installations_organization_idx on public.github_installations(organization_id);
create index if not exists github_installations_status_idx on public.github_installations(status);

create table if not exists public.github_repositories (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.github_installations (id) on delete cascade,
  github_repository_id bigint not null unique,
  owner_login text not null,
  name text not null,
  full_name text not null,
  private boolean not null default false,
  archived boolean not null default false,
  default_branch text,
  html_url text not null,
  is_accessible boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (installation_id, full_name)
);

comment on table public.github_repositories is 'Repositories currently visible to a verified GitHub App installation.';

create index if not exists github_repositories_installation_idx on public.github_repositories(installation_id);
create index if not exists github_repositories_full_name_idx on public.github_repositories(lower(full_name));

create table if not exists public.project_github_repositories (
  project_id uuid not null references public.projects (id) on delete cascade,
  github_repository_id uuid not null references public.github_repositories (id) on delete cascade,
  is_primary boolean not null default false,
  auto_resolve_enabled boolean not null default true,
  target_branches text[] not null default array['main']::text[],
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  primary key (project_id, github_repository_id),
  check (cardinality(target_branches) between 1 and 20)
);

comment on table public.project_github_repositories is 'One or more verified GitHub repositories bound to a TraceBox project.';

create index if not exists project_github_repositories_repository_idx on public.project_github_repositories(github_repository_id);
create unique index if not exists project_github_repositories_primary_idx
  on public.project_github_repositories(project_id)
  where is_primary;

create table if not exists public.github_artifacts (
  id uuid primary key default gen_random_uuid(),
  github_repository_id uuid not null references public.github_repositories (id) on delete cascade,
  artifact_type text not null check (artifact_type in ('PULL_REQUEST', 'COMMIT')),
  external_key text not null check (char_length(trim(external_key)) between 1 and 200),
  github_id bigint,
  github_node_id text,
  number integer,
  sha text,
  title text,
  html_url text not null,
  state text,
  draft boolean not null default false,
  merged boolean not null default false,
  author_login text,
  head_sha text,
  base_branch text,
  github_created_at timestamptz,
  github_updated_at timestamptz,
  last_synced_at timestamptz not null default timezone('utc'::text, now()),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (github_repository_id, artifact_type, external_key)
);

comment on table public.github_artifacts is 'Normalized GitHub pull requests and commits shared by issue links.';

create index if not exists github_artifacts_repository_idx on public.github_artifacts(github_repository_id);
create index if not exists github_artifacts_sha_idx on public.github_artifacts(sha) where sha is not null;

alter table public.issue_github_links add column if not exists github_artifact_id uuid references public.github_artifacts (id) on delete set null;
alter table public.issue_github_links add column if not exists relationship text not null default 'REFERENCES';
alter table public.issue_github_links add column if not exists source text not null default 'MANUAL';
alter table public.issue_github_links drop constraint if exists issue_github_links_github_url_check;
alter table public.issue_github_links add constraint issue_github_links_github_url_check check (url ~* '^https://github[.]com/') not valid;
alter table public.issue_github_links drop constraint if exists issue_github_links_relationship_check;
alter table public.issue_github_links add constraint issue_github_links_relationship_check check (relationship in ('FIXES', 'REFERENCES', 'IMPLEMENTS'));
alter table public.issue_github_links drop constraint if exists issue_github_links_source_check;
alter table public.issue_github_links add constraint issue_github_links_source_check check (source in ('MANUAL', 'AUTO_PARSED', 'SYNC'));

create index if not exists issue_github_links_artifact_idx on public.issue_github_links(github_artifact_id);
create unique index if not exists issue_github_links_artifact_natural_idx
  on public.issue_github_links(issue_id, github_artifact_id, relationship)
  where github_artifact_id is not null;

create table if not exists public.github_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_id text not null unique check (char_length(trim(delivery_id)) between 1 and 200),
  event_name text not null,
  action text,
  github_installation_id bigint,
  github_repository_id bigint,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error text,
  received_at timestamptz not null default timezone('utc'::text, now()),
  processed_at timestamptz
);

comment on table public.github_webhook_deliveries is 'Durable, idempotent inbox for GitHub App webhook deliveries.';

create index if not exists github_webhook_deliveries_status_idx on public.github_webhook_deliveries(status, received_at);
create index if not exists github_webhook_deliveries_installation_idx on public.github_webhook_deliveries(github_installation_id);

alter table public.github_installations enable row level security;
alter table public.github_repositories enable row level security;
alter table public.project_github_repositories enable row level security;
alter table public.github_artifacts enable row level security;
alter table public.github_webhook_deliveries enable row level security;

create policy "Organization members can read GitHub installations"
  on public.github_installations for select to authenticated
  using (public.is_org_member(organization_id));

create policy "Organization members can read GitHub repositories"
  on public.github_repositories for select to authenticated
  using (exists (
    select 1 from public.github_installations gi
    where gi.id = github_repositories.installation_id
      and public.is_org_member(gi.organization_id)
  ));

create policy "Project members can read GitHub repository bindings"
  on public.project_github_repositories for select to authenticated
  using (public.is_project_member(project_id));

create policy "Project members can read GitHub artifacts"
  on public.github_artifacts for select to authenticated
  using (exists (
    select 1
    from public.project_github_repositories pgr
    where pgr.github_repository_id = github_artifacts.github_repository_id
      and public.is_project_member(pgr.project_id)
  ));

create or replace function public.upsert_github_installation(
  p_organization_id uuid,
  p_github_installation_id bigint,
  p_github_account_id bigint,
  p_github_account_login text,
  p_github_account_type text default 'User',
  p_repository_selection text default 'selected',
  p_permissions jsonb default '{}'::jsonb,
  p_status text default 'ACTIVE',
  p_installed_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.github_installations;
  v_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_github_installation_id is null or p_github_account_id is null or nullif(trim(p_github_account_login), '') is null then
    raise exception 'VALIDATION: GitHub installation identity is required' using errcode = '22023';
  end if;
  if p_status not in ('ACTIVE', 'SUSPENDED', 'REVOKED', 'PENDING', 'NEEDS_PERMISSION_UPDATE') then
    raise exception 'VALIDATION: Invalid GitHub installation status' using errcode = '22023';
  end if;

  select * into v_existing
  from public.github_installations
  where github_installation_id = p_github_installation_id
  for update;
  if found and v_existing.organization_id <> p_organization_id then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.github_installations (
    organization_id, github_installation_id, github_account_id, github_account_login,
    github_account_type, repository_selection, permissions, status, installed_by,
    suspended_at, last_verified_at
  ) values (
    p_organization_id, p_github_installation_id, p_github_account_id, trim(p_github_account_login),
    coalesce(p_github_account_type, 'User'), coalesce(p_repository_selection, 'selected'),
    coalesce(p_permissions, '{}'::jsonb), p_status, p_installed_by,
    case when p_status = 'SUSPENDED' then timezone('utc'::text, now()) else null end,
    timezone('utc'::text, now())
  )
  on conflict (github_installation_id) do update set
    github_account_id = excluded.github_account_id,
    github_account_login = excluded.github_account_login,
    github_account_type = excluded.github_account_type,
    repository_selection = excluded.repository_selection,
    permissions = excluded.permissions,
    status = excluded.status,
    installed_by = coalesce(excluded.installed_by, public.github_installations.installed_by),
    suspended_at = case when excluded.status = 'SUSPENDED' then coalesce(public.github_installations.suspended_at, timezone('utc'::text, now())) else null end,
    last_verified_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.upsert_github_repository(
  p_installation_id uuid,
  p_github_repository_id bigint,
  p_owner_login text,
  p_name text,
  p_full_name text,
  p_private boolean default false,
  p_archived boolean default false,
  p_default_branch text default null,
  p_html_url text default null,
  p_is_accessible boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.github_installations where id = p_installation_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_github_repository_id is null or nullif(trim(p_full_name), '') is null or nullif(trim(p_html_url), '') is null then
    raise exception 'VALIDATION: GitHub repository identity is required' using errcode = '22023';
  end if;
  insert into public.github_repositories (
    installation_id, github_repository_id, owner_login, name, full_name, private,
    archived, default_branch, html_url, is_accessible, last_synced_at
  ) values (
    p_installation_id, p_github_repository_id, trim(p_owner_login), trim(p_name), lower(trim(p_full_name)),
    coalesce(p_private, false), coalesce(p_archived, false), nullif(trim(p_default_branch), ''),
    trim(p_html_url), coalesce(p_is_accessible, true), timezone('utc'::text, now())
  )
  on conflict (github_repository_id) do update set
    installation_id = excluded.installation_id,
    owner_login = excluded.owner_login,
    name = excluded.name,
    full_name = excluded.full_name,
    private = excluded.private,
    archived = excluded.archived,
    default_branch = excluded.default_branch,
    html_url = excluded.html_url,
    is_accessible = excluded.is_accessible,
    last_synced_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_github_installation_status(
  p_github_installation_id bigint,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_status not in ('ACTIVE', 'SUSPENDED', 'REVOKED', 'PENDING', 'NEEDS_PERMISSION_UPDATE') then
    raise exception 'VALIDATION: Invalid GitHub installation status' using errcode = '22023';
  end if;
  update public.github_installations
  set status = p_status,
      suspended_at = case when p_status = 'SUSPENDED' then coalesce(suspended_at, timezone('utc'::text, now())) else null end,
      last_verified_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  where github_installation_id = p_github_installation_id;
  if p_status in ('SUSPENDED', 'REVOKED') then
    update public.github_repositories gr
    set is_accessible = false, updated_at = timezone('utc'::text, now())
    where gr.installation_id = (select id from public.github_installations where github_installation_id = p_github_installation_id);
  end if;
end;
$$;

create or replace function public.set_github_repository_access(
  p_github_repository_id bigint,
  p_is_accessible boolean,
  p_archived boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.github_repositories
  set is_accessible = p_is_accessible,
      archived = coalesce(p_archived, archived),
      updated_at = timezone('utc'::text, now())
  where github_repository_id = p_github_repository_id;
end;
$$;

create or replace function public.bind_github_repository(
  p_project_id uuid,
  p_github_repository_id uuid,
  p_is_primary boolean default false,
  p_auto_resolve_enabled boolean default true,
  p_target_branches text[] default array['main']::text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project record;
  v_role text;
  v_org uuid;
  v_repo text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select id, organization_id, is_archived into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_project.is_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if coalesce(cardinality(p_target_branches), 0) = 0 then raise exception 'VALIDATION: At least one target branch is required' using errcode = '22023'; end if;

  select gi.organization_id, gr.full_name into v_org, v_repo
  from public.github_repositories gr
  join public.github_installations gi on gi.id = gr.installation_id
  where gr.id = p_github_repository_id and gr.is_accessible and not gr.archived and gi.status = 'ACTIVE';
  if not found or v_org <> v_project.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  if coalesce(p_is_primary, false) then
    update public.project_github_repositories set is_primary = false, updated_at = timezone('utc'::text, now()) where project_id = p_project_id;
  end if;
  insert into public.project_github_repositories (project_id, github_repository_id, is_primary, auto_resolve_enabled, target_branches, created_by)
  values (p_project_id, p_github_repository_id, coalesce(p_is_primary, false), coalesce(p_auto_resolve_enabled, true), p_target_branches, v_user)
  on conflict (project_id, github_repository_id) do update set
    is_primary = excluded.is_primary,
    auto_resolve_enabled = excluded.auto_resolve_enabled,
    target_branches = excluded.target_branches,
    updated_at = timezone('utc'::text, now());

  -- Keep the original single-repository row compatible with older deployments and links.
  if coalesce(p_is_primary, false) then
    insert into public.project_integrations (provider, project_id, repo_full_name, auto_resolve_enabled, is_enabled)
    values ('GITHUB', p_project_id, v_repo, coalesce(p_auto_resolve_enabled, true), true)
    on conflict (project_id, provider) do update set repo_full_name = excluded.repo_full_name, auto_resolve_enabled = excluded.auto_resolve_enabled, is_enabled = true, updated_at = timezone('utc'::text, now());
  end if;
end;
$$;

create or replace function public.unbind_github_repository(
  p_project_id uuid,
  p_github_repository_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_role text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.project_github_repositories where project_id = p_project_id and github_repository_id = p_github_repository_id;
  if not exists (select 1 from public.project_github_repositories where project_id = p_project_id) then
    update public.project_integrations set is_enabled = false, updated_at = timezone('utc'::text, now()) where project_id = p_project_id and provider = 'GITHUB';
  end if;
end;
$$;

create or replace function public.record_github_webhook_delivery(
  p_delivery_id text,
  p_event_name text,
  p_action text default null,
  p_github_installation_id bigint default null,
  p_github_repository_id bigint default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.github_webhook_deliveries as delivery (delivery_id, event_name, action, github_installation_id, github_repository_id, payload)
  values (trim(p_delivery_id), trim(p_event_name), nullif(trim(p_action), ''), p_github_installation_id, p_github_repository_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (delivery_id) do update
    set status = 'RECEIVED', error = null, processed_at = null
    where delivery.status = 'FAILED'
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.mark_github_webhook_delivery(
  p_delivery_id text,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_status not in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED') then raise exception 'VALIDATION: Invalid webhook delivery status' using errcode = '22023'; end if;
  update public.github_webhook_deliveries
  set status = p_status,
      error = nullif(trim(p_error), ''),
      attempt_count = attempt_count + 1,
      processed_at = case when p_status in ('PROCESSED', 'FAILED', 'IGNORED') then timezone('utc'::text, now()) else processed_at end
  where delivery_id = trim(p_delivery_id);
end;
$$;

create or replace function public.upsert_github_artifact(
  p_github_repository_id uuid,
  p_artifact_type text,
  p_external_key text,
  p_github_id bigint default null,
  p_github_node_id text default null,
  p_number integer default null,
  p_sha text default null,
  p_title text default null,
  p_html_url text default null,
  p_state text default null,
  p_draft boolean default false,
  p_merged boolean default false,
  p_author_login text default null,
  p_head_sha text default null,
  p_base_branch text default null,
  p_github_created_at timestamptz default null,
  p_github_updated_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_artifact_type not in ('PULL_REQUEST', 'COMMIT') or nullif(trim(p_external_key), '') is null or nullif(trim(p_html_url), '') is null then raise exception 'VALIDATION: Invalid GitHub artifact' using errcode = '22023'; end if;
  if not exists (select 1 from public.github_repositories where id = p_github_repository_id) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.github_artifacts (
    github_repository_id, artifact_type, external_key, github_id, github_node_id, number, sha,
    title, html_url, state, draft, merged, author_login, head_sha, base_branch,
    github_created_at, github_updated_at, last_synced_at
  ) values (
    p_github_repository_id, p_artifact_type, trim(p_external_key), p_github_id, nullif(trim(p_github_node_id), ''), p_number,
    nullif(trim(p_sha), ''), nullif(trim(p_title), ''), trim(p_html_url), nullif(trim(p_state), ''), coalesce(p_draft, false), coalesce(p_merged, false),
    nullif(trim(p_author_login), ''), nullif(trim(p_head_sha), ''), nullif(trim(p_base_branch), ''), p_github_created_at, p_github_updated_at, timezone('utc'::text, now())
  )
  on conflict (github_repository_id, artifact_type, external_key) do update set
    github_id = excluded.github_id,
    github_node_id = excluded.github_node_id,
    number = excluded.number,
    sha = excluded.sha,
    title = excluded.title,
    html_url = excluded.html_url,
    state = excluded.state,
    draft = excluded.draft,
    merged = excluded.merged,
    author_login = excluded.author_login,
    head_sha = excluded.head_sha,
    base_branch = excluded.base_branch,
    github_created_at = excluded.github_created_at,
    github_updated_at = excluded.github_updated_at,
    last_synced_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.link_github_artifact(
  p_issue_id uuid,
  p_github_artifact_id uuid,
  p_relationship text default 'REFERENCES',
  p_source text default 'AUTO_PARSED'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_artifact record;
  v_link_id uuid;
  v_status text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_relationship not in ('FIXES', 'REFERENCES', 'IMPLEMENTS') or p_source not in ('MANUAL', 'AUTO_PARSED', 'SYNC') then raise exception 'VALIDATION: Invalid GitHub link metadata' using errcode = '22023'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  select ga.*, gr.full_name into v_artifact
  from public.github_artifacts ga
  join public.github_repositories gr on gr.id = ga.github_repository_id
  where ga.id = p_github_artifact_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.project_github_repositories pgr
    where pgr.project_id = v_project_id and pgr.github_repository_id = v_artifact.github_repository_id
  ) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_status := case when v_artifact.merged then 'MERGED' when upper(coalesce(v_artifact.state, 'OPEN')) = 'CLOSED' then 'CLOSED' when v_artifact.draft then 'DRAFT' else 'OPEN' end;

  select id into v_link_id from public.issue_github_links
  where issue_id = p_issue_id and github_artifact_id = p_github_artifact_id and relationship = p_relationship;
  if v_link_id is null then
    insert into public.issue_github_links (issue_id, repo_name, link_type, number, url, title, status, created_by, github_artifact_id, relationship, source)
    values (p_issue_id, v_artifact.full_name, v_artifact.artifact_type, v_artifact.number, v_artifact.html_url, v_artifact.title, v_status, null, p_github_artifact_id, p_relationship, p_source)
    returning id into v_link_id;
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, new_value, metadata)
    values (p_issue_id, null, 'GITHUB_LINKED', 'github_link', to_jsonb(v_artifact.html_url), jsonb_build_object('artifact_id', p_github_artifact_id, 'relationship', p_relationship, 'source', p_source));
  else
    update public.issue_github_links set repo_name = v_artifact.full_name, number = v_artifact.number, url = v_artifact.html_url, title = v_artifact.title, status = v_status, source = p_source where id = v_link_id;
  end if;
  return v_link_id;
end;
$$;

-- Branch-aware service-role resolution used by GitHub App webhook processing.
create or replace function public.resolve_issue_from_github(
  p_project_id uuid,
  p_issue_id uuid,
  p_github_repository_id uuid,
  p_target_branch text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue record;
  v_state_id uuid;
  v_auto boolean;
  v_branches text[];
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select auto_resolve_enabled, target_branches into v_auto, v_branches
  from public.project_github_repositories
  where project_id = p_project_id and github_repository_id = p_github_repository_id;
  if not found or not v_auto or not exists (
    select 1 from unnest(v_branches) as configured_branch
    where p_target_branch = configured_branch
       or (position('*' in configured_branch) > 0 and p_target_branch like replace(configured_branch, '*', '%'))
  ) then return false; end if;
  select * into v_issue from public.issues where id = p_issue_id and project_id = p_project_id for update;
  if not found or v_issue.resolution is not null then return false; end if;
  select id into v_state_id from public.workflow_states where project_id = p_project_id and category = 'RESOLVED' order by position limit 1;
  if v_state_id is null or v_state_id = v_issue.status_id then return false; end if;
  update public.issues set status_id = v_state_id, resolution = 'FIXED', resolved_at = timezone('utc'::text, now()), closed_at = null, updated_at = timezone('utc'::text, now()) where id = p_issue_id;
  insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (p_issue_id, null, 'STATUS_CHANGED', 'status_id', to_jsonb(v_issue.status_id::text), to_jsonb(v_state_id::text), jsonb_build_object('source', 'github_webhook', 'target_branch', p_target_branch, 'resolution', 'FIXED'));
  insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (p_issue_id, null, 'RESOLUTION_CHANGED', 'resolution', to_jsonb(v_issue.resolution), to_jsonb('FIXED'::text), jsonb_build_object('source', 'github_webhook', 'target_branch', p_target_branch));
  return true;
end;
$$;

revoke execute on function public.upsert_github_installation(uuid, bigint, bigint, text, text, text, jsonb, text, uuid), public.upsert_github_repository(uuid, bigint, text, text, text, boolean, boolean, text, text, boolean), public.set_github_installation_status(bigint, text), public.set_github_repository_access(bigint, boolean, boolean), public.record_github_webhook_delivery(text, text, text, bigint, bigint, jsonb), public.mark_github_webhook_delivery(text, text, text), public.upsert_github_artifact(uuid, text, text, bigint, text, integer, text, text, text, text, boolean, boolean, text, text, text, timestamptz, timestamptz), public.link_github_artifact(uuid, uuid, text, text), public.resolve_issue_from_github(uuid, uuid, uuid, text)
from anon, authenticated, public;
grant execute on function public.upsert_github_installation(uuid, bigint, bigint, text, text, text, jsonb, text, uuid), public.upsert_github_repository(uuid, bigint, text, text, text, boolean, boolean, text, text, boolean), public.set_github_installation_status(bigint, text), public.set_github_repository_access(bigint, boolean, boolean), public.record_github_webhook_delivery(text, text, text, bigint, bigint, jsonb), public.mark_github_webhook_delivery(text, text, text), public.upsert_github_artifact(uuid, text, text, bigint, text, integer, text, text, text, text, boolean, boolean, text, text, text, timestamptz, timestamptz), public.link_github_artifact(uuid, uuid, text, text), public.resolve_issue_from_github(uuid, uuid, uuid, text)
to service_role;

revoke execute on function public.bind_github_repository(uuid, uuid, boolean, boolean, text[]), public.unbind_github_repository(uuid, uuid) from anon, public;
grant execute on function public.bind_github_repository(uuid, uuid, boolean, boolean, text[]), public.unbind_github_repository(uuid, uuid) to authenticated;

-- Token-authenticated wrappers for verified GitHub link automation.
create or replace function public.api_add_github_link(
  p_token_hash text,
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
declare v_token record; v_org uuid; v_link_id uuid;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not (('write' = any(v_token.scopes)) or ('github_links:write' = any(v_token.scopes))) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select p.organization_id into v_org from public.issues i join public.projects p on p.id = i.project_id where i.id = p_issue_id and not p.is_archived;
  if v_org is null or v_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  v_link_id := public.add_github_link(p_issue_id, p_repo_name, p_link_type, p_url, p_title, p_status, p_number);
  perform public.touch_api_token(p_token_hash);
  return v_link_id;
end;
$$;

create or replace function public.api_remove_github_link(p_token_hash text, p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_token record; v_org uuid;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not (('write' = any(v_token.scopes)) or ('github_links:write' = any(v_token.scopes))) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select p.organization_id into v_org from public.issue_github_links gl join public.issues i on i.id = gl.issue_id join public.projects p on p.id = i.project_id where gl.id = p_link_id and not p.is_archived;
  if v_org is null or v_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  perform public.remove_github_link(p_link_id);
  perform public.touch_api_token(p_token_hash);
end;
$$;

alter table public.api_tokens drop constraint if exists api_tokens_scopes_check;
alter table public.api_tokens add constraint api_tokens_scopes_check check (
  cardinality(scopes) between 1 and 11
  and scopes <@ array['read', 'write', 'projects:read', 'issues:read', 'issues:write', 'comments:write', 'milestones:read', 'search:read', 'integrations:read', 'github_links:read', 'github_links:write']::text[]
);

revoke execute on function public.api_add_github_link(text, uuid, text, text, text, text, text, integer), public.api_remove_github_link(text, uuid) from anon, authenticated, public;
grant execute on function public.api_add_github_link(text, uuid, text, text, text, text, text, integer), public.api_remove_github_link(text, uuid) to service_role;
-- Migration 041: accept both current and legacy PostgREST service-role context.
-- Modern PostgREST exposes JWT claims through request.jwt.claims, while older
-- deployments exposed one GUC per claim. Opaque Supabase secret keys can rely
-- on PostgREST's selected role instead of a JWT claim.

create or replace function public.is_service_role_request()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(nullif(current_setting('request.jwt.claim.role', true), '') = 'service_role', false)
    or coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role', false)
    or coalesce(nullif(current_setting('role', true), '') = 'service_role', false);
$$;

comment on function public.is_service_role_request() is
  'Returns true for service-role PostgREST requests across legacy JWT, JSON claims, and opaque secret-key authentication.';

-- Keep existing function bodies and grants intact while replacing the obsolete
-- single-GUC check in every active service-only GitHub function and in the
-- issue-owned mutation trigger they invoke.
do $migration$
declare
  v_signature text;
  v_function regprocedure;
  v_definition text;
  v_rewritten text;
begin
  foreach v_signature in array array[
    'public.enforce_issue_visibility_access()',
    'public.record_github_webhook(uuid,uuid,text,text,text,text,text,integer)',
    'public.resolve_issue_from_github(uuid,uuid,text)',
    'public.upsert_github_installation(uuid,bigint,bigint,text,text,text,jsonb,text,uuid)',
    'public.upsert_github_repository(uuid,bigint,text,text,text,boolean,boolean,text,text,boolean)',
    'public.set_github_installation_status(bigint,text)',
    'public.set_github_repository_access(bigint,boolean,boolean)',
    'public.record_github_webhook_delivery(text,text,text,bigint,bigint,jsonb)',
    'public.mark_github_webhook_delivery(text,text,text)',
    'public.upsert_github_artifact(uuid,text,text,bigint,text,integer,text,text,text,text,boolean,boolean,text,text,text,timestamptz,timestamptz)',
    'public.link_github_artifact(uuid,uuid,text,text)',
    'public.resolve_issue_from_github(uuid,uuid,uuid,text)'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'Required function is missing: %', v_signature;
    end if;

    v_definition := pg_get_functiondef(v_function);
    v_rewritten := replace(
      replace(
        v_definition,
        'coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role''',
        'not public.is_service_role_request()'
      ),
      'coalesce(current_setting(''request.jwt.claim.role'', true), '''') = ''service_role''',
      'public.is_service_role_request()'
    );

    if v_rewritten = v_definition then
      raise exception 'Legacy service-role check was not found in: %', v_signature;
    end if;

    execute v_rewritten;
  end loop;
end;
$migration$;

-- The predicate reveals no data and must remain callable from invoker-security
-- triggers. Privileged mutations remain protected by the existing RPC grants.
revoke execute on function public.is_service_role_request() from public;
grant execute on function public.is_service_role_request() to anon, authenticated, service_role;
-- GitHub reliability and PR experience improvements.
-- Keep GitHub credentials and installation tokens outside the database.

alter table public.github_artifacts
  add column if not exists head_branch text,
  add column if not exists merge_commit_sha text,
  add column if not exists closed_at timestamptz,
  add column if not exists merged_at timestamptz;

create table if not exists public.github_pr_check_summaries (
  github_artifact_id uuid primary key references public.github_artifacts (id) on delete cascade,
  state text not null default 'UNKNOWN' check (state in ('SUCCESS', 'FAILURE', 'PENDING', 'NEUTRAL', 'NONE', 'UNKNOWN')),
  total_count integer not null default 0 check (total_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  successful_count integer not null default 0 check (successful_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  pending_count integer not null default 0 check (pending_count >= 0),
  checks jsonb not null default '[]'::jsonb,
  error text,
  last_synced_at timestamptz not null default timezone('utc'::text, now()),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.github_pr_check_summaries is 'Read-only summaries of GitHub checks for normalized pull request artifacts.';

alter table public.github_pr_check_summaries enable row level security;
drop policy if exists "Project members can read GitHub PR checks" on public.github_pr_check_summaries;
create policy "Project members can read GitHub PR checks"
  on public.github_pr_check_summaries for select to authenticated
  using (exists (
    select 1
    from public.github_artifacts ga
    join public.project_github_repositories pgr on pgr.github_repository_id = ga.github_repository_id
    where ga.id = github_pr_check_summaries.github_artifact_id
      and public.is_project_member(pgr.project_id)
  ));

alter table public.github_webhook_deliveries
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists processing_started_at timestamptz,
  add column if not exists payload_cleared_at timestamptz;

create index if not exists github_webhook_deliveries_replay_idx
  on public.github_webhook_deliveries(status, next_retry_at, received_at);

-- The previous version incremented attempt_count for every PROCESSING/terminal
-- update. Attempts now mean actual claims, exactly once per processing lease.
drop function if exists public.mark_github_webhook_delivery(text, text, text);
create function public.mark_github_webhook_delivery(
  p_delivery_id text,
  p_status text,
  p_error text default null,
  p_retry_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_status not in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED') then
    raise exception 'VALIDATION: Invalid webhook delivery status' using errcode = '22023';
  end if;
  update public.github_webhook_deliveries
  set status = p_status,
      error = nullif(trim(p_error), ''),
      next_retry_at = case when p_status = 'FAILED' then p_retry_at else null end,
      processing_started_at = case when p_status = 'PROCESSING' then coalesce(processing_started_at, timezone('utc'::text, now())) else null end,
      processed_at = case when p_status in ('PROCESSED', 'FAILED', 'IGNORED') then timezone('utc'::text, now()) else processed_at end
  where delivery_id = trim(p_delivery_id);
end;
$$;

create function public.claim_github_webhook_delivery(
  p_delivery_id text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_rows integer;
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  -- A delivery is terminal after the bounded retry budget. Stale PROCESSING
  -- rows are finalized here so they cannot remain stranded forever.
  update public.github_webhook_deliveries
  set status = 'FAILED',
      error = 'Processing failed after the maximum retry attempts.',
      next_retry_at = null,
      processed_at = timezone('utc'::text, now()),
      processing_started_at = null
  where delivery_id = trim(p_delivery_id)
    and status = 'PROCESSING'
    and attempt_count >= 8
    and processing_started_at is not null
    and processing_started_at < timezone('utc'::text, now()) - make_interval(secs => greatest(p_lease_seconds, 30));
  update public.github_webhook_deliveries
  set status = 'PROCESSING',
      attempt_count = attempt_count + 1,
      last_attempt_at = timezone('utc'::text, now()),
      processing_started_at = timezone('utc'::text, now()),
      error = null,
      processed_at = null
  where delivery_id = trim(p_delivery_id)
    and (
      (status in ('RECEIVED', 'FAILED') and attempt_count < 8 and (next_retry_at is null or next_retry_at <= timezone('utc'::text, now())))
      or (status = 'PROCESSING' and attempt_count < 8 and processing_started_at is not null and processing_started_at < timezone('utc'::text, now()) - make_interval(secs => greatest(p_lease_seconds, 30)))
    );
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- Re-delivered failed events are eligible immediately, but retain their attempt count.
create or replace function public.record_github_webhook_delivery(
  p_delivery_id text,
  p_event_name text,
  p_action text default null,
  p_github_installation_id bigint default null,
  p_github_repository_id bigint default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  insert into public.github_webhook_deliveries as delivery (delivery_id, event_name, action, github_installation_id, github_repository_id, payload, next_retry_at)
  values (trim(p_delivery_id), trim(p_event_name), nullif(trim(p_action), ''), p_github_installation_id, p_github_repository_id, coalesce(p_payload, '{}'::jsonb), null)
  on conflict (delivery_id) do update
    set status = 'RECEIVED',
        event_name = excluded.event_name,
        action = excluded.action,
        github_installation_id = excluded.github_installation_id,
        github_repository_id = excluded.github_repository_id,
        payload = excluded.payload,
        error = null,
        next_retry_at = null,
        processing_started_at = null,
        processed_at = null
    where delivery.status = 'FAILED'
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.upsert_github_artifact(uuid, text, text, bigint, text, integer, text, text, text, text, boolean, boolean, text, text, text, timestamptz, timestamptz);
create function public.upsert_github_artifact(
  p_github_repository_id uuid,
  p_artifact_type text,
  p_external_key text,
  p_github_id bigint default null,
  p_github_node_id text default null,
  p_number integer default null,
  p_sha text default null,
  p_title text default null,
  p_html_url text default null,
  p_state text default null,
  p_draft boolean default false,
  p_merged boolean default false,
  p_author_login text default null,
  p_head_sha text default null,
  p_base_branch text default null,
  p_github_created_at timestamptz default null,
  p_github_updated_at timestamptz default null,
  p_head_branch text default null,
  p_merge_commit_sha text default null,
  p_closed_at timestamptz default null,
  p_merged_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_artifact_type not in ('PULL_REQUEST', 'COMMIT') or nullif(trim(p_external_key), '') is null or nullif(trim(p_html_url), '') is null then
    raise exception 'VALIDATION: Invalid GitHub artifact' using errcode = '22023';
  end if;
  if not exists (select 1 from public.github_repositories where id = p_github_repository_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.github_artifacts (
    github_repository_id, artifact_type, external_key, github_id, github_node_id, number, sha,
    title, html_url, state, draft, merged, author_login, head_sha, base_branch, head_branch,
    merge_commit_sha, closed_at, merged_at, github_created_at, github_updated_at, last_synced_at
  ) values (
    p_github_repository_id, p_artifact_type, trim(p_external_key), p_github_id, nullif(trim(p_github_node_id), ''), p_number,
    nullif(trim(p_sha), ''), nullif(trim(p_title), ''), trim(p_html_url), nullif(trim(p_state), ''), coalesce(p_draft, false), coalesce(p_merged, false),
    nullif(trim(p_author_login), ''), nullif(trim(p_head_sha), ''), nullif(trim(p_base_branch), ''), nullif(trim(p_head_branch), ''),
    nullif(trim(p_merge_commit_sha), ''), p_closed_at, p_merged_at, p_github_created_at, p_github_updated_at, timezone('utc'::text, now())
  )
  on conflict (github_repository_id, artifact_type, external_key) do update set
    github_id = excluded.github_id,
    github_node_id = excluded.github_node_id,
    number = excluded.number,
    sha = excluded.sha,
    title = excluded.title,
    html_url = excluded.html_url,
    state = excluded.state,
    draft = excluded.draft,
    merged = excluded.merged,
    author_login = excluded.author_login,
    head_sha = excluded.head_sha,
    base_branch = excluded.base_branch,
    head_branch = excluded.head_branch,
    merge_commit_sha = excluded.merge_commit_sha,
    closed_at = excluded.closed_at,
    merged_at = excluded.merged_at,
    github_created_at = excluded.github_created_at,
    github_updated_at = excluded.github_updated_at,
    last_synced_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.upsert_github_pr_check_summary(
  p_github_artifact_id uuid,
  p_state text,
  p_total_count integer,
  p_completed_count integer,
  p_successful_count integer,
  p_failed_count integer,
  p_pending_count integer,
  p_checks jsonb default '[]'::jsonb,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_state not in ('SUCCESS', 'FAILURE', 'PENDING', 'NEUTRAL', 'NONE', 'UNKNOWN') then
    raise exception 'VALIDATION: Invalid GitHub check state' using errcode = '22023';
  end if;
  insert into public.github_pr_check_summaries (github_artifact_id, state, total_count, completed_count, successful_count, failed_count, pending_count, checks, error, last_synced_at, updated_at)
  values (p_github_artifact_id, p_state, greatest(coalesce(p_total_count, 0), 0), greatest(coalesce(p_completed_count, 0), 0), greatest(coalesce(p_successful_count, 0), 0), greatest(coalesce(p_failed_count, 0), 0), greatest(coalesce(p_pending_count, 0), 0), coalesce(p_checks, '[]'::jsonb), nullif(trim(p_error), ''), timezone('utc'::text, now()), timezone('utc'::text, now()))
  on conflict (github_artifact_id) do update set
    state = excluded.state,
    total_count = excluded.total_count,
    completed_count = excluded.completed_count,
    successful_count = excluded.successful_count,
    failed_count = excluded.failed_count,
    pending_count = excluded.pending_count,
    checks = excluded.checks,
    error = excluded.error,
    last_synced_at = excluded.last_synced_at,
    updated_at = excluded.updated_at;
end;
$$;

-- Reconcile only automatic rows for one artifact. Manual links always win and are never removed.
create or replace function public.reconcile_auto_github_links(
  p_project_id uuid,
  p_github_artifact_id uuid,
  p_desired_links jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artifact record;
  v_desired jsonb;
  v_issue_id uuid;
  v_relationship text;
  v_existing record;
  v_count integer := 0;
  v_stale record;
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select ga.*, gr.full_name into v_artifact
  from public.github_artifacts ga
  join public.github_repositories gr on gr.id = ga.github_repository_id
  where ga.id = p_github_artifact_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.project_github_repositories where project_id = p_project_id and github_repository_id = v_artifact.github_repository_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  for v_stale in
    select gl.id, gl.issue_id, gl.relationship
    from public.issue_github_links gl
    join public.issues i on i.id = gl.issue_id
    where gl.github_artifact_id = p_github_artifact_id
      and gl.source = 'AUTO_PARSED'
      and i.project_id = p_project_id
      and not exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(p_desired_links, '[]'::jsonb)) = 'array' then coalesce(p_desired_links, '[]'::jsonb) else '[]'::jsonb end) desired
        where (desired->>'issue_id') = gl.issue_id::text
      )
  loop
    delete from public.issue_github_links where id = v_stale.id;
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, metadata)
    values (v_stale.issue_id, null, 'GITHUB_LINK_REMOVED', 'github_link', to_jsonb(v_artifact.html_url), jsonb_build_object('artifact_id', p_github_artifact_id, 'relationship', v_stale.relationship, 'source', 'AUTO_PARSED'));
    v_count := v_count + 1;
  end loop;

  for v_desired in
    select value from jsonb_array_elements(case when jsonb_typeof(coalesce(p_desired_links, '[]'::jsonb)) = 'array' then coalesce(p_desired_links, '[]'::jsonb) else '[]'::jsonb end)
  loop
    begin v_issue_id := (v_desired->>'issue_id')::uuid; exception when invalid_text_representation then continue; end;
    v_relationship := upper(coalesce(v_desired->>'relationship', 'REFERENCES'));
    if v_relationship not in ('FIXES', 'REFERENCES', 'IMPLEMENTS') then continue; end if;
    if not exists (select 1 from public.issues where id = v_issue_id and project_id = p_project_id) then continue; end if;

    -- A manual relationship is authoritative. Remove a duplicate automatic row if one exists.
    if exists (select 1 from public.issue_github_links where issue_id = v_issue_id and github_artifact_id = p_github_artifact_id and source = 'MANUAL' and relationship = v_relationship) then
      delete from public.issue_github_links where issue_id = v_issue_id and github_artifact_id = p_github_artifact_id and source = 'AUTO_PARSED';
      continue;
    end if;

    select id, relationship into v_existing
    from public.issue_github_links
    where issue_id = v_issue_id and github_artifact_id = p_github_artifact_id and source = 'AUTO_PARSED'
    for update;
    if found then
      update public.issue_github_links set relationship = v_relationship, repo_name = v_artifact.full_name, number = v_artifact.number, url = v_artifact.html_url, title = v_artifact.title, status = case when v_artifact.merged then 'MERGED' when upper(coalesce(v_artifact.state, 'OPEN')) = 'CLOSED' then 'CLOSED' when v_artifact.draft then 'DRAFT' else 'OPEN' end where id = v_existing.id;
      if v_existing.relationship <> v_relationship then
        insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
        values (v_issue_id, null, 'GITHUB_LINK_UPDATED', 'relationship', to_jsonb(v_existing.relationship), to_jsonb(v_relationship), jsonb_build_object('artifact_id', p_github_artifact_id, 'source', 'AUTO_PARSED'));
        v_count := v_count + 1;
      end if;
    else
      insert into public.issue_github_links (issue_id, repo_name, link_type, number, url, title, status, created_by, github_artifact_id, relationship, source)
      values (v_issue_id, v_artifact.full_name, v_artifact.artifact_type, v_artifact.number, v_artifact.html_url, v_artifact.title, case when v_artifact.merged then 'MERGED' when upper(coalesce(v_artifact.state, 'OPEN')) = 'CLOSED' then 'CLOSED' when v_artifact.draft then 'DRAFT' else 'OPEN' end, null, p_github_artifact_id, v_relationship, 'AUTO_PARSED');
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, new_value, metadata)
      values (v_issue_id, null, 'GITHUB_LINKED', 'github_link', to_jsonb(v_artifact.html_url), jsonb_build_object('artifact_id', p_github_artifact_id, 'relationship', v_relationship, 'source', 'AUTO_PARSED'));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Binding management belongs to Maintainers. The first bound repository is primary;
-- later repositories do not silently replace it.
create or replace function public.bind_github_repository(
  p_project_id uuid,
  p_github_repository_id uuid,
  p_is_primary boolean default false,
  p_auto_resolve_enabled boolean default true,
  p_target_branches text[] default array['main']::text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_project record; v_role text; v_org uuid; v_repo text; v_primary boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select id, organization_id, is_archived into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_project.is_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if coalesce(cardinality(p_target_branches), 0) = 0 then raise exception 'VALIDATION: At least one target branch is required' using errcode = '22023'; end if;
  select gi.organization_id, gr.full_name into v_org, v_repo
  from public.github_repositories gr join public.github_installations gi on gi.id = gr.installation_id
  where gr.id = p_github_repository_id and gr.is_accessible and not gr.archived and gi.status = 'ACTIVE';
  if not found or v_org <> v_project.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_primary := coalesce(p_is_primary, false) or not exists (select 1 from public.project_github_repositories where project_id = p_project_id and is_primary);
  if v_primary then update public.project_github_repositories set is_primary = false, updated_at = timezone('utc'::text, now()) where project_id = p_project_id; end if;
  insert into public.project_github_repositories as existing (project_id, github_repository_id, is_primary, auto_resolve_enabled, target_branches, created_by)
  values (p_project_id, p_github_repository_id, v_primary, coalesce(p_auto_resolve_enabled, true), p_target_branches, v_user)
  on conflict (project_id, github_repository_id) do update set
    is_primary = case when v_primary then true else existing.is_primary end,
    auto_resolve_enabled = excluded.auto_resolve_enabled,
    target_branches = excluded.target_branches,
    updated_at = timezone('utc'::text, now());
  if v_primary then
    insert into public.project_integrations (provider, project_id, repo_full_name, auto_resolve_enabled, is_enabled)
    values ('GITHUB', p_project_id, v_repo, coalesce(p_auto_resolve_enabled, true), true)
    on conflict (project_id, provider) do update set repo_full_name = excluded.repo_full_name, auto_resolve_enabled = excluded.auto_resolve_enabled, is_enabled = true, updated_at = timezone('utc'::text, now());
  end if;
end;
$$;

create or replace function public.set_github_primary_repository(p_project_id uuid, p_github_repository_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_repo text;
begin
  v_role := public.project_role(p_project_id);
  if v_role <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform 1 from public.projects where id = p_project_id and not is_archived for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select gr.full_name into v_repo from public.project_github_repositories pgr join public.github_repositories gr on gr.id = pgr.github_repository_id join public.github_installations gi on gi.id = gr.installation_id where pgr.project_id = p_project_id and pgr.github_repository_id = p_github_repository_id and gr.is_accessible and not gr.archived and gi.status = 'ACTIVE';
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.project_github_repositories set is_primary = false, updated_at = timezone('utc'::text, now()) where project_id = p_project_id;
  update public.project_github_repositories set is_primary = true, updated_at = timezone('utc'::text, now()) where project_id = p_project_id and github_repository_id = p_github_repository_id;
  insert into public.project_integrations (provider, project_id, repo_full_name, is_enabled)
  values ('GITHUB', p_project_id, v_repo, true)
  on conflict (project_id, provider) do update set repo_full_name = excluded.repo_full_name, is_enabled = true, updated_at = timezone('utc'::text, now());
end;
$$;

create or replace function public.unbind_github_repository(p_project_id uuid, p_github_repository_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_new_primary uuid; v_repo text;
begin
  v_role := public.project_role(p_project_id);
  if v_role <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.project_github_repositories where project_id = p_project_id and github_repository_id = p_github_repository_id;
  if not exists (select 1 from public.project_github_repositories where project_id = p_project_id and is_primary) then
    select github_repository_id into v_new_primary from public.project_github_repositories where project_id = p_project_id order by created_at limit 1;
    if v_new_primary is not null then
      update public.project_github_repositories set is_primary = true, updated_at = timezone('utc'::text, now()) where project_id = p_project_id and github_repository_id = v_new_primary;
      select gr.full_name into v_repo from public.github_repositories gr where gr.id = v_new_primary;
      update public.project_integrations set repo_full_name = v_repo, is_enabled = true, updated_at = timezone('utc'::text, now()) where project_id = p_project_id and provider = 'GITHUB';
    else
      update public.project_integrations set is_enabled = false, updated_at = timezone('utc'::text, now()) where project_id = p_project_id and provider = 'GITHUB';
    end if;
  end if;
end;
$$;

create or replace function public.cleanup_github_webhook_payloads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if not public.is_service_role_request() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.github_webhook_deliveries
  set payload = '{}'::jsonb, payload_cleared_at = timezone('utc'::text, now())
  where payload <> '{}'::jsonb
    and ((status in ('PROCESSED', 'IGNORED') and received_at < timezone('utc'::text, now()) - interval '7 days')
      or (status = 'FAILED' and attempt_count >= 8 and next_retry_at is null and received_at < timezone('utc'::text, now()) - interval '30 days'));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.claim_github_webhook_delivery(text, integer), public.upsert_github_pr_check_summary(uuid, text, integer, integer, integer, integer, integer, jsonb, text), public.reconcile_auto_github_links(uuid, uuid, jsonb), public.set_github_primary_repository(uuid, uuid), public.cleanup_github_webhook_payloads() from anon, authenticated, public;
grant execute on function public.claim_github_webhook_delivery(text, integer), public.upsert_github_pr_check_summary(uuid, text, integer, integer, integer, integer, integer, jsonb, text), public.reconcile_auto_github_links(uuid, uuid, jsonb), public.set_github_primary_repository(uuid, uuid), public.cleanup_github_webhook_payloads() to service_role;
revoke execute on function public.bind_github_repository(uuid, uuid, boolean, boolean, text[]), public.unbind_github_repository(uuid, uuid) from anon, public;
grant execute on function public.bind_github_repository(uuid, uuid, boolean, boolean, text[]), public.unbind_github_repository(uuid, uuid) to authenticated;
revoke execute on function public.mark_github_webhook_delivery(text, text, text, timestamptz), public.upsert_github_artifact(uuid, text, text, bigint, text, integer, text, text, text, text, boolean, boolean, text, text, text, timestamptz, timestamptz, text, text, timestamptz, timestamptz) from anon, authenticated, public;
grant execute on function public.mark_github_webhook_delivery(text, text, text, timestamptz), public.upsert_github_artifact(uuid, text, text, bigint, text, integer, text, text, text, text, boolean, boolean, text, text, text, timestamptz, timestamptz, text, text, timestamptz, timestamptz) to service_role;
-- GitHub review fixes for service-role compatibility, bounded retries, and
-- authoritative repository/link state.

-- Migration 042 is already present in some hosted databases. Rewrite its
-- service-only guards there as well as in fresh installs where 042 already
-- uses the compatibility helper.
do $migration$
declare
  v_signature text;
  v_function regprocedure;
  v_definition text;
  v_rewritten text;
begin
  foreach v_signature in array array[
    'public.record_github_webhook_delivery(text,text,text,bigint,bigint,jsonb)',
    'public.mark_github_webhook_delivery(text,text,text,timestamptz)',
    'public.claim_github_webhook_delivery(text,integer)',
    'public.upsert_github_artifact(uuid,text,text,bigint,text,integer,text,text,text,text,boolean,boolean,text,text,text,timestamptz,timestamptz,text,text,timestamptz,timestamptz)',
    'public.upsert_github_pr_check_summary(uuid,text,integer,integer,integer,integer,integer,jsonb,text)',
    'public.reconcile_auto_github_links(uuid,uuid,jsonb)',
    'public.cleanup_github_webhook_payloads()'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'Required function is missing: %', v_signature;
    end if;
    v_definition := pg_get_functiondef(v_function);
    if position('is_service_role_request' in v_definition) > 0 then
      continue;
    end if;
    v_rewritten := replace(
      v_definition,
      'coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role''',
      'not public.is_service_role_request()'
    );
    if v_rewritten = v_definition then
      raise exception 'Legacy service-role check was not found in: %', v_signature;
    end if;
    execute v_rewritten;
  end loop;
end;
$migration$;

-- Do not create an automatic duplicate when a manual relationship for the
-- same issue/artifact is authoritative, regardless of its relationship type.
do $migration$
declare
  v_function regprocedure := to_regprocedure('public.reconcile_auto_github_links(uuid,uuid,jsonb)');
  v_definition text;
  v_rewritten text;
begin
  if v_function is null then
    raise exception 'Required function is missing: reconcile_auto_github_links';
  end if;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := replace(
    v_definition,
    'delete from public.issue_github_links where issue_id = v_issue_id and github_artifact_id = p_github_artifact_id and source = ''AUTO_PARSED'' and relationship = v_relationship;',
    'delete from public.issue_github_links where issue_id = v_issue_id and github_artifact_id = p_github_artifact_id and source = ''AUTO_PARSED'';'
  );
  if v_rewritten <> v_definition then execute v_rewritten; end if;
end;
$migration$;

-- An installation that needs a permission update must not become the primary
-- repository while its installation token is unusable.
create or replace function public.set_github_primary_repository(p_project_id uuid, p_github_repository_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_repo text;
begin
  v_role := public.project_role(p_project_id);
  if v_role <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform 1 from public.projects where id = p_project_id and not is_archived for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select gr.full_name into v_repo
  from public.project_github_repositories pgr
  join public.github_repositories gr on gr.id = pgr.github_repository_id
  join public.github_installations gi on gi.id = gr.installation_id
  where pgr.project_id = p_project_id
    and pgr.github_repository_id = p_github_repository_id
    and gr.is_accessible
    and not gr.archived
    and gi.status = 'ACTIVE';
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.project_github_repositories set is_primary = false, updated_at = timezone('utc'::text, now()) where project_id = p_project_id;
  update public.project_github_repositories set is_primary = true, updated_at = timezone('utc'::text, now()) where project_id = p_project_id and github_repository_id = p_github_repository_id;
  insert into public.project_integrations (provider, project_id, repo_full_name, is_enabled)
  values ('GITHUB', p_project_id, v_repo, true)
  on conflict (project_id, provider) do update set repo_full_name = excluded.repo_full_name, is_enabled = true, updated_at = timezone('utc'::text, now());
end;
$$;

-- Failed deliveries stop being retryable after the bounded attempt budget.
create or replace function public.mark_github_webhook_delivery(
  p_delivery_id text,
  p_status text,
  p_error text default null,
  p_retry_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_status not in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED') then
    raise exception 'VALIDATION: Invalid webhook delivery status' using errcode = '22023';
  end if;
  update public.github_webhook_deliveries
  set status = p_status,
      error = nullif(trim(p_error), ''),
      next_retry_at = case when p_status = 'FAILED' then p_retry_at else null end,
      processing_started_at = case when p_status = 'PROCESSING' then coalesce(processing_started_at, timezone('utc'::text, now())) else null end,
      processed_at = case when p_status in ('PROCESSED', 'FAILED', 'IGNORED') then timezone('utc'::text, now()) else processed_at end
  where delivery_id = trim(p_delivery_id);
end;
$$;

create or replace function public.claim_github_webhook_delivery(
  p_delivery_id text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_rows integer;
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.github_webhook_deliveries
  set status = 'FAILED',
      error = 'Processing failed after the maximum retry attempts.',
      next_retry_at = null,
      processed_at = timezone('utc'::text, now()),
      processing_started_at = null
  where delivery_id = trim(p_delivery_id)
    and status = 'PROCESSING'
    and attempt_count >= 8
    and processing_started_at is not null
    and processing_started_at < timezone('utc'::text, now()) - make_interval(secs => greatest(p_lease_seconds, 30));
  update public.github_webhook_deliveries
  set status = 'PROCESSING',
      attempt_count = attempt_count + 1,
      last_attempt_at = timezone('utc'::text, now()),
      processing_started_at = timezone('utc'::text, now()),
      error = null,
      processed_at = null
  where delivery_id = trim(p_delivery_id)
    and (
      (status in ('RECEIVED', 'FAILED') and attempt_count < 8 and (next_retry_at is null or next_retry_at <= timezone('utc'::text, now())))
      or (status = 'PROCESSING' and attempt_count < 8 and processing_started_at is not null and processing_started_at < timezone('utc'::text, now()) - make_interval(secs => greatest(p_lease_seconds, 30)))
    );
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function public.mark_github_webhook_delivery(text, text, text, timestamptz) to service_role;
grant execute on function public.claim_github_webhook_delivery(text, integer) to service_role;
-- Phase 1: keep browser and REST issue updates on one validated contract.
-- Body fields are nullable so clients can clear optional text. Every changed
-- field retains the existing per-field audit and updated_at trigger behavior.

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
  v_new_uuid uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'object' or p_updates = '{}'::jsonb then
    raise exception 'VALIDATION: An update object with at least one supported field is required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_updates) as keys(update_key)
    where update_key not in (
      'title', 'description', 'environment', 'steps_to_reproduce',
      'expected_behavior', 'actual_behavior', 'priority', 'severity',
      'type', 'assignee_id', 'component_id'
    )
  ) then
    raise exception 'VALIDATION: Unsupported issue update field' using errcode = '22023';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock project first, then issue, matching the other issue mutation paths.
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  select * into v_old from public.issues where id = p_issue_id for update;

  if p_updates ? 'title' then
    if jsonb_typeof(p_updates->'title') <> 'string' then
      raise exception 'VALIDATION: Title must be text' using errcode = '22023';
    end if;
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

  if p_updates ? 'description' then
    if jsonb_typeof(p_updates->'description') not in ('string', 'null') then
      raise exception 'VALIDATION: Description must be text or null' using errcode = '22023';
    end if;
    v_new_value := nullif(trim(p_updates->>'description'), '');
    if v_new_value is not null and char_length(v_new_value) > 10000 then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.description then
      update public.issues set description = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'DESCRIPTION_CHANGED', 'description', to_jsonb(v_old.description), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'environment' then
    if jsonb_typeof(p_updates->'environment') not in ('string', 'null') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    v_new_value := nullif(trim(p_updates->>'environment'), '');
    if v_new_value is not null and char_length(v_new_value) > 2000 then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.environment then
      update public.issues set environment = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ENVIRONMENT_CHANGED', 'environment', to_jsonb(v_old.environment), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'steps_to_reproduce' then
    if jsonb_typeof(p_updates->'steps_to_reproduce') not in ('string', 'null') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    v_new_value := nullif(trim(p_updates->>'steps_to_reproduce'), '');
    if v_new_value is not null and char_length(v_new_value) > 5000 then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.steps_to_reproduce then
      update public.issues set steps_to_reproduce = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'STEPS_TO_REPRODUCE_CHANGED', 'steps_to_reproduce', to_jsonb(v_old.steps_to_reproduce), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'expected_behavior' then
    if jsonb_typeof(p_updates->'expected_behavior') not in ('string', 'null') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    v_new_value := nullif(trim(p_updates->>'expected_behavior'), '');
    if v_new_value is not null and char_length(v_new_value) > 5000 then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.expected_behavior then
      update public.issues set expected_behavior = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'EXPECTED_BEHAVIOR_CHANGED', 'expected_behavior', to_jsonb(v_old.expected_behavior), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'actual_behavior' then
    if jsonb_typeof(p_updates->'actual_behavior') not in ('string', 'null') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    v_new_value := nullif(trim(p_updates->>'actual_behavior'), '');
    if v_new_value is not null and char_length(v_new_value) > 5000 then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.actual_behavior then
      update public.issues set actual_behavior = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ACTUAL_BEHAVIOR_CHANGED', 'actual_behavior', to_jsonb(v_old.actual_behavior), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'priority' then
    if jsonb_typeof(p_updates->'priority') <> 'string' then raise exception 'VALIDATION: Priority must be text' using errcode = '22023'; end if;
    v_new_value := p_updates->>'priority';
    if v_new_value not in ('P0', 'P1', 'P2', 'P3', 'P4') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.priority then
      update public.issues set priority = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'PRIORITY_CHANGED', 'priority', to_jsonb(v_old.priority), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'severity' then
    if jsonb_typeof(p_updates->'severity') <> 'string' then raise exception 'VALIDATION: Severity must be text' using errcode = '22023'; end if;
    v_new_value := p_updates->>'severity';
    if v_new_value not in ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.severity then
      update public.issues set severity = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'SEVERITY_CHANGED', 'severity', to_jsonb(v_old.severity), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'type' then
    if jsonb_typeof(p_updates->'type') <> 'string' then raise exception 'VALIDATION: Type must be text' using errcode = '22023'; end if;
    v_new_value := p_updates->>'type';
    if v_new_value not in ('BUG', 'ENHANCEMENT', 'TASK', 'SECURITY', 'PERFORMANCE', 'REGRESSION') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.type then
      update public.issues set type = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TYPE_CHANGED', 'type', to_jsonb(v_old.type), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'component_id' then
    if jsonb_typeof(p_updates->'component_id') not in ('string', 'null') then raise exception 'VALIDATION: Component must be a UUID or null' using errcode = '22023'; end if;
    v_new_value := nullif(p_updates->>'component_id', '');
    v_new_uuid := null;
    if v_new_value is not null then
      begin v_new_uuid := v_new_value::uuid; exception when invalid_text_representation then raise exception 'VALIDATION: Component must be a UUID or null' using errcode = '22023'; end;
    end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.component_id::text, '') then
      if v_new_uuid is not null and not exists (select 1 from public.components c where c.id = v_new_uuid and c.project_id = v_project_id and not c.is_archived) then
        raise exception 'INVALID_COMPONENT' using errcode = '23503';
      end if;
      update public.issues set component_id = v_new_uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'COMPONENT_CHANGED', 'component_id', case when v_old.component_id is null then to_jsonb(null::text) else to_jsonb(v_old.component_id::text) end, to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'assignee_id' then
    if jsonb_typeof(p_updates->'assignee_id') not in ('string', 'null') then raise exception 'VALIDATION: Assignee must be a UUID or null' using errcode = '22023'; end if;
    v_new_value := nullif(p_updates->>'assignee_id', '');
    v_new_uuid := null;
    if v_new_value is not null then
      begin v_new_uuid := v_new_value::uuid; exception when invalid_text_representation then raise exception 'VALIDATION: Assignee must be a UUID or null' using errcode = '22023'; end;
    end if;
    if v_new_value is not null and not (
      exists (select 1 from public.project_members m where m.user_id = v_new_uuid and m.project_id = v_project_id)
      or exists (
        select 1 from public.projects p join public.organizations o on o.id = p.organization_id
        left join public.organization_members om on om.organization_id = o.id and om.user_id = v_new_uuid
        where p.id = v_project_id and (o.owner_id = v_new_uuid or om.role in ('OWNER', 'ADMIN'))
      )
    ) then raise exception 'INVALID_ASSIGNEE' using errcode = '23503'; end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.assignee_id::text, '') then
      update public.issues set assignee_id = v_new_uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ASSIGNEE_CHANGED', 'assignee_id', case when v_old.assignee_id is null then to_jsonb(null::text) else to_jsonb(v_old.assignee_id::text) end, to_jsonb(v_new_value));
    end if;
  end if;
end;
$$;

revoke execute on function public.update_issue_fields(uuid, jsonb) from anon, public;
grant execute on function public.update_issue_fields(uuid, jsonb) to authenticated;
-- Phase 2: workspace membership, invitations, project access, and ownership.
-- Membership rows remain RPC-only. Invitation secrets are returned once to the
-- caller and persisted only as SHA-256 digests.

create extension if not exists pgcrypto;

create table if not exists public.membership_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid references public.projects (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  event_type text not null check (event_type in (
    'INVITATION_CREATED', 'INVITATION_REVOKED', 'INVITATION_ACCEPTED',
    'ORGANIZATION_ROLE_CHANGED', 'PROJECT_MEMBER_ADDED',
    'PROJECT_ROLE_CHANGED', 'PROJECT_MEMBER_REMOVED',
    'ORGANIZATION_MEMBER_REMOVED', 'OWNERSHIP_TRANSFERRED'
  )),
  old_role text,
  new_role text,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists membership_events_org_created_idx
  on public.membership_events (organization_id, created_at desc);
create index if not exists membership_events_project_created_idx
  on public.membership_events (project_id, created_at desc);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid references public.projects (id) on delete set null,
  email text not null check (email = lower(trim(email)) and char_length(email) between 3 and 320),
  organization_role text not null default 'MEMBER' check (organization_role in ('ADMIN', 'MEMBER', 'VIEWER')),
  project_role text check (project_role is null or project_role in ('MAINTAINER', 'DEVELOPER', 'REPORTER', 'VIEWER')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default (timezone('utc'::text, now()) + interval '7 days'),
  invited_by uuid not null references auth.users (id) on delete restrict,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  check (accepted_at is null or accepted_by is not null),
  check (accepted_at is null or revoked_at is null)
);

create index if not exists workspace_invitations_org_idx
  on public.workspace_invitations (organization_id, created_at desc);
create index if not exists workspace_invitations_email_idx
  on public.workspace_invitations (email, expires_at)
  where accepted_at is null and revoked_at is null;
create unique index if not exists workspace_invitations_one_pending_idx
  on public.workspace_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

comment on table public.membership_events is 'Immutable workspace and project membership audit history.';
comment on table public.workspace_invitations is 'Hashed, expiring workspace invitations; raw tokens are never stored.';

alter table public.membership_events enable row level security;
alter table public.workspace_invitations enable row level security;

-- Project access is explicit for ordinary workspace members. Organization
-- owners/admins retain workspace-wide access; existing implicit memberships are
-- backfilled before the helper changes so no one unexpectedly loses access.
insert into public.project_members (project_id, user_id, role)
select p.id, m.user_id, case when m.role = 'VIEWER' then 'VIEWER' else 'REPORTER' end
from public.projects p
join public.organization_members m on m.organization_id = p.organization_id
where m.role not in ('OWNER', 'ADMIN')
  and not exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = m.user_id);

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
    where p.id = p_project_id and public.is_org_admin(p.organization_id)
  );
$$;
revoke execute on function public.is_project_member(uuid) from anon, public;
grant execute on function public.is_project_member(uuid) to authenticated;

drop policy if exists "Org members can read their projects" on public.projects;
create policy "Assigned members can read their projects"
  on public.projects for select to authenticated
  using (public.is_project_member(id));

create or replace function public.can_view_issue(p_issue_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_issue record; v_role text;
begin
  if v_user is null then return false; end if;
  select i.id, i.project_id, i.reporter_id, i.assignee_id, coalesce(i.visibility, 'PROJECT') as visibility into v_issue
    from public.issues i where i.id = p_issue_id;
  if not found or not public.is_project_member(v_issue.project_id) then return false; end if;
  v_role := public.project_role(v_issue.project_id);
  if v_role = 'MAINTAINER' or public.can_manage_project(v_issue.project_id) then return true; end if;
  if v_issue.visibility in ('PROJECT', 'PUBLIC') then return true; end if;
  return v_issue.reporter_id = v_user or v_issue.assignee_id = v_user
    or exists (select 1 from public.issue_access ia where ia.issue_id = p_issue_id and ia.user_id = v_user);
end;
$$;
revoke execute on function public.can_view_issue(uuid) from anon, public;
grant execute on function public.can_view_issue(uuid) to authenticated;

create or replace function public.prevent_membership_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'IMMUTABLE_AUDIT' using errcode = '42501';
end;
$$;

drop trigger if exists membership_events_immutable on public.membership_events;
create trigger membership_events_immutable
before update or delete on public.membership_events
for each row execute procedure public.prevent_membership_history_mutation();

-- The browser can read history/invitations only through RLS; all writes are
-- performed by the security-definer functions below.
create policy "Organization members can read membership history"
  on public.membership_events for select to authenticated
  using (public.is_org_member(organization_id));

create policy "Organization admins can read invitations"
  on public.workspace_invitations for select to authenticated
  using (public.is_org_admin(organization_id));

revoke insert, update, delete on public.organization_members from anon, authenticated, public;
revoke insert, update, delete on public.project_members from anon, authenticated, public;
revoke insert, update, delete on public.membership_events from anon, authenticated, public;
revoke insert, update, delete on public.workspace_invitations from anon, authenticated, public;

create or replace function public.organization_role(p_organization_id uuid, p_user_id uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when o.owner_id = p_user_id then 'OWNER' else m.role end
  from public.organizations o
  left join public.organization_members m
    on m.organization_id = o.id and m.user_id = p_user_id
  where o.id = p_organization_id
    and (o.owner_id = p_user_id or m.user_id is not null)
  limit 1;
$$;

create or replace function public.membership_role_rank(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role
    when 'OWNER' then 4 when 'ADMIN' then 3 when 'MAINTAINER' then 4
    when 'MEMBER' then 2 when 'DEVELOPER' then 3 when 'REPORTER' then 2
    when 'VIEWER' then 1 else 0 end;
$$;

revoke execute on function public.organization_role(uuid, uuid), public.membership_role_rank(text) from anon, public;
revoke execute on function public.organization_role(uuid, uuid) from authenticated;
grant execute on function public.membership_role_rank(text) to authenticated;

create or replace function public.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_organization_role text default 'MEMBER',
  p_project_id uuid default null,
  p_project_role text default null
)
returns table (id uuid, email text, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_id uuid;
  v_expires timestamptz;
  v_old_invitation uuid;
  v_project_archived boolean;
  v_actor_project_role text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_actor_role := public.organization_role(p_organization_id, v_actor);
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'VALIDATION: Invalid email address' using errcode = '22023';
  end if;
  if p_organization_role is null or p_organization_role not in ('ADMIN', 'MEMBER', 'VIEWER')
     or public.membership_role_rank(p_organization_role) > public.membership_role_rank(v_actor_role) then
    raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501';
  end if;
  if p_project_id is not null then
    select p.is_archived into v_project_archived from public.projects p
      where p.id = p_project_id and p.organization_id = p_organization_id for update;
    if not found then
      raise exception 'INVALID_PROJECT' using errcode = '23503';
    end if;
    if v_project_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
    select role into v_actor_project_role from public.project_members where project_id = p_project_id and user_id = v_actor;
    if coalesce(v_actor_role, '') not in ('OWNER', 'ADMIN') and coalesce(v_actor_project_role, '') <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
    if coalesce(v_actor_role, '') not in ('OWNER', 'ADMIN') and p_organization_role <> 'MEMBER' then raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501'; end if;
    if p_project_role is null then raise exception 'VALIDATION: Project role is required' using errcode = '22023'; end if;
    if p_project_role is null or p_project_role not in ('MAINTAINER', 'DEVELOPER', 'REPORTER', 'VIEWER')
       or public.membership_role_rank(p_project_role) > public.membership_role_rank(case when v_actor_role in ('OWNER','ADMIN') then 'MAINTAINER' else v_actor_project_role end) then
      raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501';
    end if;
  elsif p_project_role is not null then
    raise exception 'VALIDATION: Project requires a project role' using errcode = '22023';
  elsif coalesce(v_actor_role, '') not in ('OWNER', 'ADMIN') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  for v_old_invitation in
    select id from public.workspace_invitations
    where organization_id = p_organization_id and email = v_email
      and accepted_at is null and revoked_at is null
    for update
  loop
    update public.workspace_invitations set revoked_at = timezone('utc'::text, now()) where id = v_old_invitation;
    insert into public.membership_events (organization_id, actor_id, event_type, metadata)
    values (p_organization_id, v_actor, 'INVITATION_REVOKED', jsonb_build_object('invitation_id', v_old_invitation, 'reason', 'superseded'));
  end loop;

  insert into public.workspace_invitations (organization_id, project_id, email, organization_role, project_role, token_hash, invited_by)
  values (p_organization_id, p_project_id, v_email, p_organization_role, p_project_role, encode(digest(v_token, 'sha256'), 'hex'), v_actor)
  returning workspace_invitations.id, workspace_invitations.expires_at into v_id, v_expires;

  insert into public.membership_events (organization_id, project_id, actor_id, event_type, new_role, metadata)
  values (p_organization_id, p_project_id, v_actor, 'INVITATION_CREATED', coalesce(p_project_role, p_organization_role), jsonb_build_object('invitation_id', v_id, 'email', v_email));
  return query select v_id, v_email, v_token, v_expires;
end;
$$;

create or replace function public.list_organization_invitations(p_organization_id uuid)
returns table (id uuid, email text, organization_role text, project_id uuid, project_role text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.email, i.organization_role, i.project_id, i.project_role, i.expires_at, i.accepted_at, i.revoked_at, i.created_at
  from public.workspace_invitations i
  where i.organization_id = p_organization_id and public.is_org_admin(p_organization_id)
  order by i.created_at desc;
$$;

create or replace function public.list_project_invitations(p_project_id uuid)
returns table (id uuid, email text, organization_role text, project_id uuid, project_role text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.email, i.organization_role, i.project_id, i.project_role, i.expires_at, i.accepted_at, i.revoked_at, i.created_at
  from public.workspace_invitations i
  join public.projects p on p.id = i.project_id
  where i.project_id = p_project_id
    and (public.is_org_admin(p.organization_id) or exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id and pm.user_id = auth.uid() and pm.role = 'MAINTAINER'
    ))
  order by i.created_at desc;
$$;

create or replace function public.revoke_organization_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_org uuid; v_project uuid; v_actor_project_role text;
begin
  select organization_id, project_id into v_org, v_project from public.workspace_invitations where id = p_invitation_id for update;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_project is not null then select role into v_actor_project_role from public.project_members where project_id = v_project and user_id = v_actor; end if;
  if coalesce(public.organization_role(v_org, v_actor), '') not in ('OWNER','ADMIN') and coalesce(v_actor_project_role, '') <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.workspace_invitations set revoked_at = timezone('utc'::text, now()) where id = p_invitation_id and accepted_at is null and revoked_at is null;
  if found then
    insert into public.membership_events (organization_id, project_id, actor_id, event_type, metadata)
    values (v_org, v_project, v_actor, 'INVITATION_REVOKED', jsonb_build_object('invitation_id', p_invitation_id));
  end if;
end;
$$;

create or replace function public.accept_organization_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid(); v_email text; v_inv public.workspace_invitations%rowtype;
  v_old_org_role text; v_old_project_role text; v_project_archived boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select email into v_email from auth.users where id = v_actor;
  select * into v_inv from public.workspace_invitations where token_hash = encode(digest(trim(coalesce(p_token, '')), 'sha256'), 'hex') for update;
  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_inv.revoked_at is not null then raise exception 'INVITATION_REVOKED' using errcode = '42501'; end if;
  if v_inv.accepted_at is not null then raise exception 'INVITATION_USED' using errcode = '42501'; end if;
  if v_inv.expires_at <= timezone('utc'::text, now()) then raise exception 'INVITATION_EXPIRED' using errcode = '42501'; end if;
  if lower(coalesce(v_email, '')) <> v_inv.email then raise exception 'INVITATION_WRONG_ACCOUNT' using errcode = '42501'; end if;
  if v_inv.project_id is not null then
    select is_archived into v_project_archived from public.projects where id = v_inv.project_id for update;
    if not found then raise exception 'INVALID_PROJECT' using errcode = '23503'; end if;
    if v_project_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  end if;

  select role into v_old_org_role from public.organization_members
    where organization_id = v_inv.organization_id and user_id = v_actor for update;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_inv.organization_id, v_actor, v_inv.organization_role)
    on conflict (organization_id, user_id) do update set role =
    case when public.membership_role_rank(excluded.role) > public.membership_role_rank(organization_members.role)
      then excluded.role else organization_members.role end;
  if v_inv.project_id is not null then
    select role into v_old_project_role from public.project_members
      where project_id = v_inv.project_id and user_id = v_actor for update;
    insert into public.project_members (project_id, user_id, role)
    values (v_inv.project_id, v_actor, v_inv.project_role)
    on conflict (project_id, user_id) do update set role =
      case when public.membership_role_rank(excluded.role) > public.membership_role_rank(project_members.role)
        then excluded.role else project_members.role end;
  end if;
  update public.workspace_invitations set accepted_by = v_actor, accepted_at = timezone('utc'::text, now()) where id = v_inv.id;
  if v_old_org_role is not null and public.membership_role_rank(v_inv.organization_role) > public.membership_role_rank(v_old_org_role) then
    insert into public.membership_events (organization_id, actor_id, target_user_id, event_type, old_role, new_role, metadata)
    values (v_inv.organization_id, v_actor, v_actor, 'ORGANIZATION_ROLE_CHANGED', v_old_org_role, v_inv.organization_role, jsonb_build_object('invitation_id', v_inv.id, 'reason', 'accepted'));
  end if;
  if v_inv.project_id is not null and v_old_project_role is not null and public.membership_role_rank(v_inv.project_role) > public.membership_role_rank(v_old_project_role) then
    insert into public.membership_events (organization_id, project_id, actor_id, target_user_id, event_type, old_role, new_role, metadata)
    values (v_inv.organization_id, v_inv.project_id, v_actor, v_actor, 'PROJECT_ROLE_CHANGED', v_old_project_role, v_inv.project_role, jsonb_build_object('invitation_id', v_inv.id, 'reason', 'accepted'));
  end if;
  insert into public.membership_events (organization_id, project_id, actor_id, target_user_id, event_type, new_role, metadata)
  values (v_inv.organization_id, v_inv.project_id, v_actor, v_actor, 'INVITATION_ACCEPTED', coalesce(v_inv.project_role, v_inv.organization_role), jsonb_build_object('invitation_id', v_inv.id));
  return v_inv.organization_id;
end;
$$;

create or replace function public.add_project_member(p_project_id uuid, p_user_id uuid, p_role text default 'DEVELOPER')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_org uuid; v_archived boolean; v_actor_org_role text; v_actor_project_role text; v_old_role text;
begin
  select organization_id, is_archived into v_org, v_archived from public.projects where id = p_project_id for update;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if v_org is null or not exists (select 1 from public.organization_members where organization_id = v_org and user_id = p_user_id) then raise exception 'INVALID_MEMBER' using errcode = '42501'; end if;
  v_actor_org_role := public.organization_role(v_org, v_actor);
  select role into v_actor_project_role from public.project_members where project_id = p_project_id and user_id = v_actor;
  if coalesce(v_actor_org_role, '') not in ('OWNER','ADMIN') and coalesce(v_actor_project_role, '') <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('MAINTAINER','DEVELOPER','REPORTER','VIEWER') or public.membership_role_rank(p_role) > public.membership_role_rank(case when v_actor_org_role in ('OWNER','ADMIN') then 'MAINTAINER' else v_actor_project_role end) then raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501'; end if;
  select role into v_old_role from public.project_members where project_id = p_project_id and user_id = p_user_id for update;
  if v_old_role is not null and v_old_role = p_role then return; end if;
  insert into public.project_members (project_id, user_id, role) values (p_project_id, p_user_id, p_role)
  on conflict (project_id, user_id) do update set role = excluded.role;
  insert into public.membership_events (organization_id, project_id, actor_id, target_user_id, event_type, old_role, new_role)
  values (v_org, p_project_id, v_actor, p_user_id, case when v_old_role is null then 'PROJECT_MEMBER_ADDED' else 'PROJECT_ROLE_CHANGED' end, v_old_role, p_role);
end;
$$;

create or replace function public.update_organization_member_role(p_organization_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_actor_role text; v_old text;
begin
  v_actor_role := public.organization_role(p_organization_id, v_actor);
  if coalesce(v_actor_role, '') not in ('OWNER','ADMIN') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('ADMIN','MEMBER','VIEWER') or public.membership_role_rank(p_role) > public.membership_role_rank(v_actor_role) then raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501'; end if;
  select role into v_old from public.organization_members where organization_id = p_organization_id and user_id = p_user_id for update;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_user_id = (select owner_id from public.organizations where id = p_organization_id) then raise exception 'OWNER_TRANSFER_REQUIRED' using errcode = '42501'; end if;
  update public.organization_members set role = p_role where organization_id = p_organization_id and user_id = p_user_id;
  insert into public.membership_events (organization_id, actor_id, target_user_id, event_type, old_role, new_role) values (p_organization_id, v_actor, p_user_id, 'ORGANIZATION_ROLE_CHANGED', v_old, p_role);
end;
$$;

create or replace function public.update_project_member_role(p_project_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_org uuid; v_archived boolean; v_actor_org_role text; v_actor_project_role text; v_old text;
begin
  select organization_id, is_archived into v_org, v_archived from public.projects where id = p_project_id for update;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_actor_org_role := public.organization_role(v_org, v_actor);
  select role into v_actor_project_role from public.project_members where project_id = p_project_id and user_id = v_actor;
  if coalesce(v_actor_org_role, '') not in ('OWNER','ADMIN') and coalesce(v_actor_project_role, '') <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('MAINTAINER','DEVELOPER','REPORTER','VIEWER') or public.membership_role_rank(p_role) > public.membership_role_rank(case when v_actor_org_role in ('OWNER','ADMIN') then 'MAINTAINER' else v_actor_project_role end) then raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501'; end if;
  select role into v_old from public.project_members where project_id = p_project_id and user_id = p_user_id for update;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  update public.project_members set role = p_role where project_id = p_project_id and user_id = p_user_id;
  insert into public.membership_events (organization_id, project_id, actor_id, target_user_id, event_type, old_role, new_role) values (v_org, p_project_id, v_actor, p_user_id, 'PROJECT_ROLE_CHANGED', v_old, p_role);
end;
$$;

create or replace function public.remove_project_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_org uuid; v_archived boolean; v_actor_org_role text; v_actor_project_role text; v_old text;
begin
  select organization_id, is_archived into v_org, v_archived from public.projects where id = p_project_id for update;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_actor_org_role := public.organization_role(v_org, v_actor);
  select role into v_actor_project_role from public.project_members where project_id = p_project_id and user_id = v_actor;
  if coalesce(v_actor_org_role, '') not in ('OWNER','ADMIN') and coalesce(v_actor_project_role, '') <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select role into v_old from public.project_members where project_id = p_project_id and user_id = p_user_id for update;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  delete from public.issue_access ia using public.issues i
    where ia.issue_id = i.id and i.project_id = p_project_id and ia.user_id = p_user_id;
  delete from public.issue_watchers iw using public.issues i
    where iw.issue_id = i.id and i.project_id = p_project_id and iw.user_id = p_user_id;
  delete from public.notifications n using public.issues i
    where n.issue_id = i.id and i.project_id = p_project_id and n.user_id = p_user_id;
  delete from public.project_members where project_id = p_project_id and user_id = p_user_id;
  insert into public.membership_events (organization_id, project_id, actor_id, target_user_id, event_type, old_role) values (v_org, p_project_id, v_actor, p_user_id, 'PROJECT_MEMBER_REMOVED', v_old);
end;
$$;

create or replace function public.remove_organization_member(p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_actor_role text; v_old text; v_owner uuid;
begin
  select owner_id into v_owner from public.organizations where id = p_organization_id for update;
  v_actor_role := public.organization_role(p_organization_id, v_actor);
  if coalesce(v_actor_role, '') not in ('OWNER','ADMIN') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_user_id = v_owner then raise exception 'LAST_OWNER' using errcode = '42501'; end if;
  select role into v_old from public.organization_members where organization_id = p_organization_id and user_id = p_user_id for update;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  delete from public.issue_access ia using public.issues i, public.projects p
  where ia.issue_id = i.id and i.project_id = p.id and p.organization_id = p_organization_id and ia.user_id = p_user_id;
  delete from public.issue_watchers iw using public.issues i, public.projects p
  where iw.issue_id = i.id and i.project_id = p.id and p.organization_id = p_organization_id and iw.user_id = p_user_id;
  delete from public.notifications n using public.issues i, public.projects p
  where n.issue_id = i.id and i.project_id = p.id and p.organization_id = p_organization_id and n.user_id = p_user_id;
  delete from public.api_tokens where organization_id = p_organization_id and user_id = p_user_id;
  delete from public.project_members pm using public.projects p where pm.project_id = p.id and p.organization_id = p_organization_id and pm.user_id = p_user_id;
  delete from public.organization_members where organization_id = p_organization_id and user_id = p_user_id;
  insert into public.membership_events (organization_id, actor_id, target_user_id, event_type, old_role) values (p_organization_id, v_actor, p_user_id, 'ORGANIZATION_MEMBER_REMOVED', v_old);
end;
$$;

create or replace function public.transfer_organization_ownership(p_organization_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_old_owner uuid;
begin
  select owner_id into v_old_owner from public.organizations where id = p_organization_id for update;
  if v_old_owner is null or v_actor <> v_old_owner then raise exception 'OWNER_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.organization_members where organization_id = p_organization_id and user_id = p_new_owner_id) then raise exception 'INVALID_MEMBER' using errcode = '42501'; end if;
  if p_new_owner_id = v_old_owner then return; end if;
  update public.organizations set owner_id = p_new_owner_id where id = p_organization_id;
  update public.organization_members set role = 'ADMIN' where organization_id = p_organization_id and user_id = v_old_owner;
  update public.organization_members set role = 'OWNER' where organization_id = p_organization_id and user_id = p_new_owner_id;
  insert into public.membership_events (organization_id, actor_id, target_user_id, event_type, old_role, new_role) values (p_organization_id, v_actor, p_new_owner_id, 'OWNERSHIP_TRANSFERRED', 'OWNER', 'OWNER');
end;
$$;

revoke execute on function public.create_organization_invitation(uuid,text,text,uuid,text), public.list_organization_invitations(uuid), public.list_project_invitations(uuid), public.revoke_organization_invitation(uuid), public.accept_organization_invitation(text), public.add_project_member(uuid,uuid,text), public.update_organization_member_role(uuid,uuid,text), public.update_project_member_role(uuid,uuid,text), public.remove_project_member(uuid,uuid), public.remove_organization_member(uuid,uuid), public.transfer_organization_ownership(uuid,uuid) from anon, public;
grant execute on function public.create_organization_invitation(uuid,text,text,uuid,text), public.list_organization_invitations(uuid), public.list_project_invitations(uuid), public.revoke_organization_invitation(uuid), public.accept_organization_invitation(text), public.add_project_member(uuid,uuid,text), public.update_organization_member_role(uuid,uuid,text), public.update_project_member_role(uuid,uuid,text), public.remove_project_member(uuid,uuid), public.remove_organization_member(uuid,uuid), public.transfer_organization_ownership(uuid,uuid) to authenticated;
-- Phase 2 completion: enforce the organization/project relationship at the
-- table boundary as defense in depth for invitation and membership history.

create or replace function public.enforce_membership_project_organization()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.organization_id = new.organization_id
  ) then
    raise exception 'INVALID_PROJECT_ORGANIZATION' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists membership_events_project_organization_guard on public.membership_events;
create trigger membership_events_project_organization_guard
before insert or update of organization_id, project_id on public.membership_events
for each row execute procedure public.enforce_membership_project_organization();

drop trigger if exists workspace_invitations_project_organization_guard on public.workspace_invitations;
create trigger workspace_invitations_project_organization_guard
before insert or update of organization_id, project_id on public.workspace_invitations
for each row execute procedure public.enforce_membership_project_organization();

revoke execute on function public.enforce_membership_project_organization() from public, anon, authenticated;
-- Phase 4/5: complete issue mutation contracts.
--
-- The two-argument update_issue_fields contract remains available to existing
-- clients.  The checked overload is used by the editor so an active edit can
-- never silently overwrite a newer server version.

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
  v_key text;
  v_new_text text;
  v_old_text text;
  v_new_uuid uuid;
  v_old_json jsonb;
  v_new_json jsonb;
  v_event text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'object' or p_updates = '{}'::jsonb then
    raise exception 'VALIDATION: An update object with at least one supported field is required' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_updates) keys(update_key) where update_key not in (
    'title', 'description', 'environment', 'steps_to_reproduce', 'expected_behavior',
    'actual_behavior', 'priority', 'severity', 'type', 'assignee_id', 'component_id'
  )) then raise exception 'VALIDATION: Unsupported issue update field' using errcode = '22023'; end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  select i.* into v_old from public.issues i where i.id = p_issue_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') and v_old.reporter_id <> v_user then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  for v_key in select jsonb_object_keys(p_updates) loop
    v_new_text := nullif(trim(p_updates->>v_key), '');
    v_new_uuid := null;
    v_old_text := null;
    v_event := case v_key
      when 'title' then 'TITLE_CHANGED'
      when 'description' then 'DESCRIPTION_CHANGED'
      when 'environment' then 'ENVIRONMENT_CHANGED'
      when 'steps_to_reproduce' then 'STEPS_TO_REPRODUCE_CHANGED'
      when 'expected_behavior' then 'EXPECTED_BEHAVIOR_CHANGED'
      when 'actual_behavior' then 'ACTUAL_BEHAVIOR_CHANGED'
      when 'priority' then 'PRIORITY_CHANGED'
      when 'severity' then 'SEVERITY_CHANGED'
      when 'type' then 'TYPE_CHANGED'
      when 'component_id' then 'COMPONENT_CHANGED'
      when 'assignee_id' then 'ASSIGNEE_CHANGED'
    end;

    if v_key = 'title' then
      if jsonb_typeof(p_updates->v_key) <> 'string' or v_new_text is null or char_length(v_new_text) > 200 then raise exception 'VALIDATION: Title is required and must be at most 200 characters' using errcode = '22023'; end if;
      v_old_text := v_old.title;
    elsif v_key in ('description', 'environment', 'steps_to_reproduce', 'expected_behavior', 'actual_behavior') then
      if jsonb_typeof(p_updates->v_key) not in ('string', 'null') then raise exception 'VALIDATION: Body fields must be text or null' using errcode = '22023'; end if;
      if v_new_text is not null and char_length(v_new_text) > (case v_key when 'description' then 10000 when 'environment' then 2000 else 5000 end) then raise exception 'VALIDATION: Body field is too long' using errcode = '22023'; end if;
      v_old_text := case v_key when 'description' then v_old.description when 'environment' then v_old.environment when 'steps_to_reproduce' then v_old.steps_to_reproduce when 'expected_behavior' then v_old.expected_behavior when 'actual_behavior' then v_old.actual_behavior end;
    elsif v_key = 'priority' then
      if jsonb_typeof(p_updates->v_key) <> 'string' or v_new_text not in ('P0','P1','P2','P3','P4') then raise exception 'VALIDATION: Invalid priority' using errcode = '22023'; end if;
      v_old_text := v_old.priority;
    elsif v_key = 'severity' then
      if jsonb_typeof(p_updates->v_key) <> 'string' or v_new_text not in ('BLOCKER','CRITICAL','MAJOR','MINOR','TRIVIAL') then raise exception 'VALIDATION: Invalid severity' using errcode = '22023'; end if;
      v_old_text := v_old.severity;
    elsif v_key = 'type' then
      if jsonb_typeof(p_updates->v_key) <> 'string' or v_new_text not in ('BUG','ENHANCEMENT','TASK','SECURITY','PERFORMANCE','REGRESSION') then raise exception 'VALIDATION: Invalid issue type' using errcode = '22023'; end if;
      v_old_text := v_old.type;
    elsif v_key in ('component_id', 'assignee_id') then
      if jsonb_typeof(p_updates->v_key) not in ('string', 'null') then raise exception 'VALIDATION: User and component values must be UUIDs or null' using errcode = '22023'; end if;
      if v_new_text is not null then begin v_new_uuid := v_new_text::uuid; exception when invalid_text_representation then raise exception 'VALIDATION: Invalid UUID' using errcode = '22023'; end; end if;
      v_old_text := case v_key when 'component_id' then v_old.component_id::text when 'assignee_id' then v_old.assignee_id::text end;
      if v_key = 'component_id' and v_new_uuid is not null and not exists (select 1 from public.components c where c.id = v_new_uuid and c.project_id = v_project_id and not c.is_archived) then raise exception 'INVALID_COMPONENT' using errcode = '23503'; end if;
      if v_key = 'assignee_id' and v_new_uuid is not null and not (
        exists (select 1 from public.project_members m where m.project_id = v_project_id and m.user_id = v_new_uuid)
        or exists (select 1 from public.projects p join public.organizations o on o.id = p.organization_id left join public.organization_members om on om.organization_id = o.id and om.user_id = v_new_uuid where p.id = v_project_id and (o.owner_id = v_new_uuid or om.role in ('OWNER','ADMIN')))
      ) then raise exception 'INVALID_ASSIGNEE' using errcode = '23503'; end if;
    end if;

    v_old_json := to_jsonb(v_old_text);
    v_new_json := to_jsonb(v_new_text);
    if v_old_text is distinct from v_new_text then
      if v_key in ('component_id', 'assignee_id') then
        execute format('update public.issues set %I = $1 where id = $2', v_key) using v_new_uuid, p_issue_id;
      else
        execute format('update public.issues set %I = $1 where id = $2', v_key) using v_new_text, p_issue_id;
      end if;
      insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, v_event, v_key, v_old_json, v_new_json);
    end if;
  end loop;
end;
$$;

create or replace function public.update_issue_fields(
  p_issue_id uuid,
  p_updates jsonb,
  p_expected_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_current timestamptz; v_project_id uuid; v_archived boolean;
begin
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  select updated_at into v_current from public.issues where id = p_issue_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_expected_updated_at is not null and v_current <> p_expected_updated_at then
    raise exception 'CONFLICT: Issue changed since it was loaded' using errcode = '40001';
  end if;
  perform public.update_issue_fields(p_issue_id, p_updates);
end;
$$;

revoke execute on function public.update_issue_fields(uuid, jsonb), public.update_issue_fields(uuid, jsonb, timestamptz) from anon, public;
grant execute on function public.update_issue_fields(uuid, jsonb), public.update_issue_fields(uuid, jsonb, timestamptz) to authenticated;

-- Atomic browser/API creation contract.  Defaults, restricted grants, and
-- required custom values are committed with the issue or rolled back together.
create or replace function public.create_issue_complete(p_project_id uuid, p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid(); v_role text; v_archived boolean; v_number bigint; v_issue_id uuid;
  v_template record; v_field record; v_value jsonb; v_visibility text;
  v_template_body text; v_template_type text; v_template_priority text; v_template_severity text; v_template_component text;
  v_title text; v_description text; v_type text; v_priority text; v_severity text;
  v_component uuid; v_assignee uuid; v_json jsonb; v_initial_state uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('REPORTER','DEVELOPER','MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;

  if nullif(trim(p_payload->>'template_id'), '') is not null then
    select * into v_template from public.issue_templates t where t.id = (p_payload->>'template_id')::uuid and t.project_id = p_project_id;
    if not found then raise exception 'INVALID_TEMPLATE' using errcode = '23503'; end if;
    v_template_body := v_template.body_template;
    v_template_type := v_template.issue_type;
    v_template_priority := v_template.default_priority;
    v_template_severity := v_template.default_severity;
    v_template_component := v_template.default_component_id::text;
  end if;
  v_title := nullif(trim(coalesce(p_payload->>'title', '')), '');
  v_description := coalesce(nullif(trim(coalesce(p_payload->>'description', '')), ''), nullif(trim(coalesce(v_template_body, '')), ''));
  v_type := coalesce(nullif(p_payload->>'type',''), v_template_type, 'BUG');
  v_priority := coalesce(nullif(p_payload->>'priority',''), v_template_priority, 'P2');
  v_severity := coalesce(nullif(p_payload->>'severity',''), v_template_severity, 'MAJOR');
  if v_title is null or char_length(v_title) > 200 or v_description is null or char_length(v_description) > 10000 then raise exception 'VALIDATION: Title and description are required' using errcode = '22023'; end if;
  if v_type not in ('BUG','ENHANCEMENT','TASK','SECURITY','PERFORMANCE','REGRESSION') or v_priority not in ('P0','P1','P2','P3','P4') or v_severity not in ('BLOCKER','CRITICAL','MAJOR','MINOR','TRIVIAL') then raise exception 'VALIDATION: Invalid issue classification' using errcode = '22023'; end if;
  v_component := coalesce(nullif(p_payload->>'component_id', ''), v_template_component)::uuid;
  v_assignee := nullif(p_payload->>'assignee_id', '')::uuid;
  v_visibility := upper(coalesce(nullif(p_payload->>'visibility',''), 'PROJECT'));
  if v_visibility not in ('PROJECT','RESTRICTED') then raise exception 'VALIDATION: Invalid visibility' using errcode = '22023'; end if;
  if v_component is not null and not exists (select 1 from public.components c where c.id = v_component and c.project_id = p_project_id and not c.is_archived) then raise exception 'INVALID_COMPONENT' using errcode = '23503'; end if;
  if v_assignee is not null and not (
    exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = v_assignee)
    or exists (select 1 from public.projects p join public.organizations o on o.id = p.organization_id left join public.organization_members om on om.organization_id = o.id and om.user_id = v_assignee where p.id = p_project_id and (o.owner_id = v_assignee or om.role in ('OWNER','ADMIN')))
  ) then raise exception 'INVALID_ASSIGNEE' using errcode = '23503'; end if;
  -- Creation triggers read this transaction-local marker so restricted issues
  -- never emit a pre-grant notification as a project-visible issue.
  perform set_config('tracebox.issue_visibility', v_visibility, true);
  v_json := jsonb_build_object('title', v_title, 'type', v_type, 'description', v_description, 'component_id', v_component, 'priority', v_priority, 'severity', v_severity, 'assignee_id', v_assignee, 'environment', nullif(p_payload->>'environment',''), 'steps_to_reproduce', nullif(p_payload->>'steps_to_reproduce',''), 'expected_behavior', nullif(p_payload->>'expected_behavior',''), 'actual_behavior', nullif(p_payload->>'actual_behavior',''));
  select next_issue_number into v_number from public.projects where id = p_project_id for update;
  update public.projects set next_issue_number = v_number + 1 where id = p_project_id;
  select s.id into v_initial_state from public.workflow_states s where s.project_id = p_project_id order by s.is_initial desc, s.position limit 1;
  if v_initial_state is null then raise exception 'VALIDATION: Project has no initial workflow state' using errcode = '22023'; end if;
  insert into public.issues (
    project_id, issue_number, title, description, type, status_id, priority,
    severity, reporter_id, assignee_id, component_id, environment,
    steps_to_reproduce, expected_behavior, actual_behavior, visibility
  ) values (
    p_project_id, v_number, v_title, v_description, v_type, v_initial_state,
    v_priority, v_severity, v_user, v_assignee, v_component,
    nullif(trim(p_payload->>'environment'), ''), nullif(trim(p_payload->>'steps_to_reproduce'), ''),
    nullif(trim(p_payload->>'expected_behavior'), ''), nullif(trim(p_payload->>'actual_behavior'), ''), v_visibility
  ) returning id into v_issue_id;
  insert into public.issue_events(issue_id, actor_id, event_type, metadata)
  values (v_issue_id, v_user, 'ISSUE_CREATED', jsonb_build_object('title', v_title, 'type', v_type, 'priority', v_priority, 'severity', v_severity));

  if v_visibility = 'RESTRICTED' then
    if jsonb_typeof(p_payload->'access_user_ids') = 'array' then
      for v_json in select value from jsonb_array_elements(p_payload->'access_user_ids') loop
        if not exists (select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = (v_json #>> '{}')::uuid) and not exists (select 1 from public.organizations o join public.projects p on p.organization_id = o.id left join public.organization_members om on om.organization_id = o.id and om.user_id = (v_json #>> '{}')::uuid where p.id = p_project_id and (o.owner_id = (v_json #>> '{}')::uuid or om.role in ('OWNER','ADMIN'))) then raise exception 'INVALID_ACCESS_GRANT' using errcode = '23503'; end if;
        insert into public.issue_access(issue_id, user_id, granted_by) values (v_issue_id, (v_json #>> '{}')::uuid, v_user) on conflict do nothing;
      end loop;
    end if;
  end if;

  if jsonb_typeof(p_payload->'custom_values') = 'object' then
    for v_field in select * from public.custom_fields where project_id = p_project_id loop
      v_value := p_payload->'custom_values' -> v_field.id::text;
      if v_field.is_required and (v_value is null or v_value = 'null'::jsonb or v_value = '""'::jsonb or v_value = '[]'::jsonb) then raise exception 'VALIDATION: Required custom field is missing' using errcode = '22023'; end if;
      if v_value is not null and v_value <> 'null'::jsonb then
        if v_field.field_type in ('TEXT','SINGLE_SELECT','USER','DATE') and jsonb_typeof(v_value) <> 'string' then raise exception 'VALIDATION: Custom field must be text' using errcode = '22023'; end if;
        if v_field.field_type = 'NUMBER' and jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') ~ '^-?[0-9]+(\\.[0-9]+)?$' then v_value := to_jsonb((v_value #>> '{}')::numeric); end if;
        if v_field.field_type = 'NUMBER' and jsonb_typeof(v_value) <> 'number' then raise exception 'VALIDATION: Custom field must be numeric' using errcode = '22023'; end if;
        if v_field.field_type = 'BOOLEAN' and jsonb_typeof(v_value) = 'string' and lower(v_value #>> '{}') in ('true','false') then v_value := to_jsonb((v_value #>> '{}')::boolean); end if;
        if v_field.field_type = 'BOOLEAN' and jsonb_typeof(v_value) <> 'boolean' then raise exception 'VALIDATION: Custom field must be boolean' using errcode = '22023'; end if;
        if v_field.field_type = 'MULTI_SELECT' and jsonb_typeof(v_value) <> 'array' then raise exception 'VALIDATION: Custom field must be a list' using errcode = '22023'; end if;
        if v_field.field_type = 'SINGLE_SELECT' and jsonb_typeof(v_field.config->'options') = 'array' and not exists (select 1 from jsonb_array_elements_text(v_field.config->'options') as opts(option_value) where opts.option_value = v_value #>> '{}') then raise exception 'VALIDATION: Invalid custom field option' using errcode = '22023'; end if;
      end if;
      if v_value is not null and v_value <> 'null'::jsonb then insert into public.issue_custom_values(issue_id, custom_field_id, value) values (v_issue_id, v_field.id, v_value); end if;
    end loop;
  elsif exists (select 1 from public.custom_fields where project_id = p_project_id and is_required) then
    raise exception 'VALIDATION: Required custom field is missing' using errcode = '22023';
  end if;
  return v_number;
end;
$$;

revoke execute on function public.create_issue_complete(uuid, jsonb) from anon, public;
grant execute on function public.create_issue_complete(uuid, jsonb) to authenticated;

-- Keep the public REST create path on the same atomic contract as the browser.
create or replace function public.api_create_issue(p_token_hash text, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_token record; v_project_id uuid; v_org uuid; v_number bigint;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not (('write' = any(v_token.scopes)) or ('issues:write' = any(v_token.scopes))) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_project_id := nullif(p_payload->>'project_id', '')::uuid;
  select organization_id into v_org from public.projects where id = v_project_id and not is_archived;
  if v_org is null or v_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  v_number := public.create_issue_complete(v_project_id, p_payload);
  perform public.touch_api_token(p_token_hash);
  return v_number::integer;
end;
$$;
revoke execute on function public.api_create_issue(text, jsonb) from anon, public;
grant execute on function public.api_create_issue(text, jsonb) to authenticated, service_role;

-- The issue-created trigger still auto-watches the reporter and assignee, but
-- suppresses the initial assignee notification while a restricted issue is
-- being created. Subsequent notifications are guarded by issue visibility.
create or replace function public.on_issue_created_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.issue_watchers(issue_id, user_id) values (new.id, new.reporter_id) on conflict do nothing;
  if new.assignee_id is not null then
    insert into public.issue_watchers(issue_id, user_id) values (new.id, new.assignee_id) on conflict do nothing;
    if coalesce(current_setting('tracebox.issue_visibility', true), 'PROJECT') <> 'RESTRICTED' then
      perform public.dispatch_issue_notification(new.assignee_id, new.reporter_id, new.id, 'ASSIGNED', jsonb_build_object('title', new.title, 'issue_number', new.issue_number));
    end if;
  end if;
  return new;
end;
$$;
-- Phase 6: complete in-app notification delivery, preferences, and inbox paging.
-- Notifications intentionally remain in-app only. There is no email provider or
-- email delivery contract in this repository.

-- Keep notification rows safe after a recipient loses access to a restricted issue.
drop policy if exists "Users can read their own notifications" on public.notifications;
create policy "Users can read visible notifications"
  on public.notifications for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (issue_id is null or public.can_view_issue(issue_id))
  );

drop policy if exists "Users can update their own notifications" on public.notifications;
create policy "Users can update visible notifications"
  on public.notifications for update to authenticated
  using (
    (select auth.uid()) = user_id
    and (issue_id is null or public.can_view_issue(issue_id))
  )
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own notifications" on public.notifications;
create policy "Users can delete visible notifications"
  on public.notifications for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and (issue_id is null or public.can_view_issue(issue_id))
  );

-- Notification categories are deliberately in-app only. The extra categories
-- cover every retained preference-aware event in the product contract.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type in (
    'ASSIGNED', 'MENTION', 'COMMENT', 'STATUS_CHANGED',
    'ISSUE_LINKED', 'LABEL_CHANGED', 'PLANNING_CHANGED',
    'MILESTONE_CHANGED', 'WATCHED_ISSUE_UPDATED'
  )
);

alter table public.notification_preferences
  add column if not exists issue_links boolean not null default true,
  add column if not exists labels boolean not null default true,
  add column if not exists planning boolean not null default true,
  add column if not exists milestones boolean not null default true;

-- Preference mutations go through update_notification_preferences so callers
-- cannot write a partial or cross-user row through the Data API.
drop policy if exists "Users can update their notification preferences" on public.notification_preferences;
drop policy if exists "Users can insert their notification preferences" on public.notification_preferences;

create index if not exists notifications_user_cursor_idx
  on public.notifications (user_id, created_at desc, id desc);

-- A recipient may only receive a notification when they could currently view
-- the issue. Restricted issue payloads are reduced to a generic marker so a
-- later access revocation cannot expose title, body, project key, or excerpts.
create or replace function public.notification_recipient_can_view_issue(
  p_recipient_id uuid,
  p_issue_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_issue record;
begin
  if p_recipient_id is null or p_issue_id is null then
    return false;
  end if;

  select i.id, i.project_id, i.reporter_id, i.assignee_id,
         coalesce(i.visibility, 'PROJECT') as visibility,
         p.organization_id
    into v_issue
    from public.issues i
    join public.projects p on p.id = i.project_id
   where i.id = p_issue_id;
  if not found then
    return false;
  end if;

  if v_issue.visibility in ('PUBLIC', 'PROJECT') then
    return exists (
      select 1 from public.project_members pm
       where pm.project_id = v_issue.project_id and pm.user_id = p_recipient_id
    ) or exists (
      select 1 from public.organization_members om
       where om.organization_id = v_issue.organization_id
         and om.user_id = p_recipient_id
         and om.role in ('OWNER', 'ADMIN')
    );
  end if;

  return v_issue.reporter_id = p_recipient_id
      or v_issue.assignee_id = p_recipient_id
      or exists (
        select 1 from public.issue_access ia
         where ia.issue_id = p_issue_id and ia.user_id = p_recipient_id
      )
      or exists (
        select 1
          from public.project_members pm
         where pm.project_id = v_issue.project_id
           and pm.user_id = p_recipient_id
           and pm.role = 'MAINTAINER'
      )
      or exists (
        select 1 from public.organization_members om
         where om.organization_id = v_issue.organization_id
           and om.user_id = p_recipient_id
           and om.role in ('OWNER', 'ADMIN')
      );
end;
$$;

revoke execute on function public.notification_recipient_can_view_issue(uuid, uuid) from public, anon, authenticated;

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
  v_issue record;
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_enabled boolean := true;
begin
  if auth.uid() is null or p_recipient_id is null or p_recipient_id = p_actor_id then
    return;
  end if;
  if p_type not in (
    'ASSIGNED', 'MENTION', 'COMMENT', 'STATUS_CHANGED',
    'ISSUE_LINKED', 'LABEL_CHANGED', 'PLANNING_CHANGED',
    'MILESTONE_CHANGED', 'WATCHED_ISSUE_UPDATED'
  ) then
    raise exception 'VALIDATION: Invalid notification type' using errcode = '22023';
  end if;

  if p_issue_id is not null then
    if not public.notification_recipient_can_view_issue(p_recipient_id, p_issue_id) then
      return;
    end if;
    select visibility into v_issue from public.issues where id = p_issue_id;
    if v_issue.visibility = 'RESTRICTED' then
      v_data := jsonb_build_object('restricted', true);
    end if;
  end if;

  select * into v_pref
    from public.notification_preferences
   where user_id = p_recipient_id;
  if found then
    v_enabled := case p_type
      when 'MENTION' then v_pref.mentions
      when 'ASSIGNED' then v_pref.assignments
      when 'COMMENT' then v_pref.comments
      when 'STATUS_CHANGED' then v_pref.status_changes
      when 'WATCHED_ISSUE_UPDATED' then v_pref.watch_updates
      when 'ISSUE_LINKED' then v_pref.issue_links
      when 'LABEL_CHANGED' then v_pref.labels
      when 'PLANNING_CHANGED' then v_pref.planning
      when 'MILESTONE_CHANGED' then v_pref.milestones
      else true
    end;
  end if;

  if v_enabled then
    -- A single event is never inserted twice for the same recipient by a
    -- dispatcher call. Trigger-level callers de-duplicate their recipients.
    insert into public.notifications (user_id, actor_id, issue_id, type, data)
    values (p_recipient_id, nullif(p_actor_id, p_recipient_id), p_issue_id, p_type, v_data);
  end if;
end;
$$;

revoke execute on function public.dispatch_issue_notification(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

revoke execute on function public.on_issue_updated_notifications() from public, anon, authenticated;

-- Exact unread count and cursor-paged history. The RPC applies visibility to
-- stale restricted rows, which also keeps realtime and the inbox consistent.
create or replace function public.get_unread_notifications_count()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return (
    select count(*)::integer
      from public.notifications n
     where n.user_id = v_user
       and n.read_at is null
       and (n.issue_id is null or public.can_view_issue(n.issue_id))
  );
end;
$$;

create or replace function public.list_notifications(
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_unread_only boolean default false,
  p_limit integer default 25
)
returns table (
  id uuid,
  issue_id uuid,
  type text,
  data jsonb,
  actor_id uuid,
  actor_name text,
  issue_number bigint,
  project_key text,
  issue_title text,
  read_at timestamptz,
  created_at timestamptz,
  next_cursor_created_at timestamptz,
  next_cursor_id uuid,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  return query
  with visible as (
    select n.id, n.issue_id, n.type,
           case when coalesce(i.visibility, 'PROJECT') = 'RESTRICTED'
                then jsonb_build_object('restricted', true)
                else n.data end as safe_data,
           n.actor_id, ap.display_name as actor_name,
           i.issue_number, p.key as project_key, i.title as issue_title,
           n.read_at, n.created_at,
           row_number() over (order by n.created_at desc, n.id desc) as rn
      from public.notifications n
      left join public.profiles ap on ap.id = n.actor_id
      left join public.issues i on i.id = n.issue_id
      left join public.projects p on p.id = i.project_id
     where n.user_id = v_user
       and (p_unread_only is not true or n.read_at is null)
       and (n.issue_id is null or public.can_view_issue(n.issue_id))
       and (p_cursor_created_at is null or (n.created_at, n.id) < (p_cursor_created_at, p_cursor_id))
  ), page as (
    select * from visible where rn <= v_limit + 1
  ), boundary as (
    select created_at as boundary_created_at, id as boundary_id
      from page where rn = v_limit
  ), more as (
    select exists (select 1 from page where rn = v_limit + 1) as has_more
  )
  select v.id, v.issue_id, v.type, v.safe_data, v.actor_id, v.actor_name,
         v.issue_number, v.project_key, v.issue_title, v.read_at, v.created_at,
         b.boundary_created_at, b.boundary_id, m.has_more
    from page v cross join more m left join boundary b on true
   where v.rn <= v_limit
   order by v.created_at desc, v.id desc;
end;
$$;

-- Preferences are personal and written atomically through this RPC. No email
-- columns are exposed: delivery is explicitly in-app only.
create or replace function public.get_notification_preferences()
returns table (
  user_id uuid,
  mentions boolean,
  assignments boolean,
  comments boolean,
  status_changes boolean,
  watch_updates boolean,
  issue_links boolean,
  labels boolean,
  planning boolean,
  milestones boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return query
    select v_user, coalesce(p.mentions, true), coalesce(p.assignments, true),
           coalesce(p.comments, true), coalesce(p.status_changes, true),
           coalesce(p.watch_updates, true), coalesce(p.issue_links, true),
           coalesce(p.labels, true), coalesce(p.planning, true),
           coalesce(p.milestones, true), p.updated_at
      from (select 1) seed
      left join public.notification_preferences p on p.user_id = v_user;
end;
$$;

create or replace function public.update_notification_preferences(
  p_mentions boolean,
  p_assignments boolean,
  p_comments boolean,
  p_status_changes boolean,
  p_watch_updates boolean,
  p_issue_links boolean,
  p_labels boolean,
  p_planning boolean,
  p_milestones boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  insert into public.notification_preferences (
    user_id, mentions, assignments, comments, status_changes, watch_updates,
    issue_links, labels, planning, milestones, updated_at
  ) values (
    v_user, coalesce(p_mentions, true), coalesce(p_assignments, true),
    coalesce(p_comments, true), coalesce(p_status_changes, true),
    coalesce(p_watch_updates, true), coalesce(p_issue_links, true),
    coalesce(p_labels, true), coalesce(p_planning, true),
    coalesce(p_milestones, true), timezone('utc'::text, now())
  ) on conflict (user_id) do update set
    mentions = excluded.mentions, assignments = excluded.assignments,
    comments = excluded.comments, status_changes = excluded.status_changes,
    watch_updates = excluded.watch_updates, issue_links = excluded.issue_links,
    labels = excluded.labels, planning = excluded.planning,
    milestones = excluded.milestones, updated_at = excluded.updated_at;
end;
$$;

revoke execute on function public.get_unread_notifications_count(), public.list_notifications(timestamptz, uuid, boolean, integer), public.get_notification_preferences(), public.update_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.get_unread_notifications_count(), public.list_notifications(timestamptz, uuid, boolean, integer), public.get_notification_preferences(), public.update_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- Rebuild issue lifecycle delivery in one trigger to avoid duplicate watcher
-- rows when assignment/status/planning fields change together.
create or replace function public.on_issue_updated_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watcher record;
  v_actor uuid := auth.uid();
  v_issue_data jsonb := jsonb_build_object('issue_number', new.issue_number, 'title', new.title);
  v_specific boolean := false;
begin
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform public.dispatch_issue_notification(new.assignee_id, v_actor, new.id, 'ASSIGNED', v_issue_data);
    v_specific := true;
  end if;
  if new.status_id is distinct from old.status_id then
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = new.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.id, 'STATUS_CHANGED', v_issue_data);
    end loop;
    v_specific := true;
  end if;
  if new.affected_version_id is distinct from old.affected_version_id
     or new.target_milestone_id is distinct from old.target_milestone_id then
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = new.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.id, 'PLANNING_CHANGED', v_issue_data);
    end loop;
    v_specific := true;
  end if;
  if new.target_milestone_id is distinct from old.target_milestone_id then
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = new.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.id, 'MILESTONE_CHANGED', v_issue_data);
    end loop;
  end if;

  -- Generic watched updates cover edits outside the specialized categories.
  if not v_specific and (
    new.title is distinct from old.title or new.description is distinct from old.description
    or new.priority is distinct from old.priority or new.severity is distinct from old.severity
    or new.type is distinct from old.type or new.component_id is distinct from old.component_id
  ) then
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = new.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.id, 'WATCHED_ISSUE_UPDATED', v_issue_data);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_issue_updated_notifications on public.issues;
create trigger trg_issue_updated_notifications
after update on public.issues
for each row execute procedure public.on_issue_updated_notifications();

-- Link events notify watchers of both visible endpoints, with one recipient per
-- link event. A restricted endpoint is filtered by the dispatcher.
create or replace function public.on_issue_link_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watcher record;
  v_actor uuid := auth.uid();
  v_issue_id uuid;
  v_target_id uuid;
  v_relationship text;
begin
  if tg_op = 'DELETE' then
    v_issue_id := old.source_issue_id;
    v_target_id := old.target_issue_id;
    v_relationship := old.relationship;
  else
    v_issue_id := new.source_issue_id;
    v_target_id := new.target_issue_id;
    v_relationship := new.relationship;
  end if;
  for v_watcher in
    select distinct iw.user_id
      from public.issue_watchers iw
     where iw.issue_id in (v_issue_id, v_target_id)
  loop
    perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, v_issue_id, 'ISSUE_LINKED',
      jsonb_build_object('relationship', v_relationship));
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.on_issue_link_notification() from public, anon, authenticated;

drop trigger if exists trg_issue_link_notification on public.issue_links;
create trigger trg_issue_link_notification
after insert or delete on public.issue_links
for each row execute procedure public.on_issue_link_notification();

-- Labels are changed by set_issue_labels, which replaces a set in one RPC. The
-- RPC below emits one event after the replacement, avoiding delete/insert pairs.
drop trigger if exists trg_issue_labels_insert_notification on public.issue_labels;
drop trigger if exists trg_issue_labels_delete_notification on public.issue_labels;

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
  v_watcher record;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') or not public.can_view_issue(p_issue_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform 1 from public.issues where id = p_issue_id for update;
  delete from public.issue_labels where issue_id = p_issue_id;
  if p_label_ids is not null then
    foreach v_label_id in array p_label_ids loop
      if exists (select 1 from public.labels l where l.id = v_label_id and l.project_id = v_project_id) then
        insert into public.issue_labels (issue_id, label_id) values (p_issue_id, v_label_id) on conflict do nothing;
      end if;
    end loop;
  end if;
  update public.issues set updated_at = timezone('utc'::text, now()) where id = p_issue_id;
  for v_watcher in select distinct user_id from public.issue_watchers where issue_id = p_issue_id loop
    perform public.dispatch_issue_notification(v_watcher.user_id, v_user, p_issue_id, 'LABEL_CHANGED', null);
  end loop;
end;
$$;
revoke execute on function public.set_issue_labels(uuid, uuid[]) from public, anon;
grant execute on function public.set_issue_labels(uuid, uuid[]) to authenticated;

-- Mention matching is case-insensitive but de-duplicated, and every recipient
-- still passes the restricted-access check in dispatch_issue_notification.
create or replace function public.on_comment_mentions_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match text[];
  v_profile record;
  v_issue record;
  v_actor uuid := auth.uid();
begin
  select i.issue_number, i.title into v_issue from public.issues i where i.id = new.issue_id;
  for v_match in select distinct regexp_matches(new.body, '@([A-Za-z0-9_.-]+)', 'gi') loop
    select p.id into v_profile from public.profiles p
     where lower(p.display_name) = lower(v_match[1]) limit 1;
    if found then
      perform public.dispatch_issue_notification(v_profile.id, v_actor, new.issue_id, 'MENTION',
        jsonb_build_object('issue_number', v_issue.issue_number, 'title', v_issue.title, 'excerpt', left(new.body, 140)));
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_comment_mentions_notifications on public.comments;
create trigger trg_comment_mentions_notifications
after insert or update of body on public.comments
for each row execute procedure public.on_comment_mentions_notifications();

-- Comments and comment edits both notify existing watchers. The actor is
-- auto-watched once, and the dispatcher suppresses self-notifications.
create or replace function public.on_comment_changed_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watcher record;
  v_issue record;
  v_actor uuid := auth.uid();
begin
  select i.issue_number, i.title into v_issue from public.issues i where i.id = new.issue_id;
  if not found then return new; end if;
  insert into public.issue_watchers (issue_id, user_id)
  values (new.issue_id, new.author_id)
  on conflict (issue_id, user_id) do nothing;
  for v_watcher in select distinct user_id from public.issue_watchers where issue_id = new.issue_id loop
    perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.issue_id, 'COMMENT',
      jsonb_build_object('excerpt', left(new.body, 140), 'issue_number', v_issue.issue_number, 'title', v_issue.title));
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_comment_created_notifications on public.comments;
create trigger trg_comment_changed_notifications
after insert or update of body on public.comments
for each row execute procedure public.on_comment_changed_notifications();

create or replace function public.on_milestone_changed_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue record;
  v_watcher record;
  v_actor uuid := auth.uid();
  v_milestone_id uuid;
begin
  if tg_op = 'DELETE' then v_milestone_id := old.id; else v_milestone_id := new.id; end if;
  for v_issue in select id, issue_number, title from public.issues where target_milestone_id = v_milestone_id loop
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = v_issue.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, v_issue.id, 'MILESTONE_CHANGED',
        jsonb_build_object('issue_number', v_issue.issue_number, 'title', v_issue.title));
    end loop;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_milestone_changed_notifications on public.milestones;
create trigger trg_milestone_changed_notifications
after insert or update or delete on public.milestones
for each row execute procedure public.on_milestone_changed_notifications();

create or replace function public.on_version_changed_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue record;
  v_watcher record;
  v_actor uuid := auth.uid();
  v_version_id uuid;
begin
  if tg_op = 'DELETE' then v_version_id := old.id; else v_version_id := new.id; end if;
  for v_issue in select id, issue_number, title from public.issues where affected_version_id = v_version_id loop
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = v_issue.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, v_issue.id, 'PLANNING_CHANGED',
        jsonb_build_object('issue_number', v_issue.issue_number, 'title', v_issue.title));
    end loop;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_version_changed_notifications on public.versions;
create trigger trg_version_changed_notifications
after insert or update or delete on public.versions
for each row execute procedure public.on_version_changed_notifications();

revoke execute on function public.on_comment_mentions_notifications() from public, anon, authenticated;
revoke execute on function public.on_comment_changed_notifications() from public, anon, authenticated;
revoke execute on function public.on_milestone_changed_notifications() from public, anon, authenticated;
revoke execute on function public.on_version_changed_notifications() from public, anon, authenticated;
-- Phase 7 completion: RPC-only project metadata/lifecycle management and
-- atomic workflow graph publishing. Project keys are intentionally immutable.

alter table public.workflow_transitions
  add column if not exists requires_resolution boolean not null default false;

update public.workflow_transitions wt
set requires_resolution = true
from public.workflow_states target
where target.id = wt.to_state_id
  and target.category in ('RESOLVED', 'CLOSED');

create unique index if not exists workflow_states_one_initial_per_project_idx
  on public.workflow_states (project_id)
  where is_initial;

create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event_type text not null check (event_type in ('PROJECT_UPDATED', 'PROJECT_ARCHIVED', 'PROJECT_RESTORED', 'WORKFLOW_PUBLISHED')),
  old_value jsonb,
  new_value jsonb,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.project_events is 'Immutable audit history for project configuration and workflow publication.';

create index if not exists project_events_project_created_idx
  on public.project_events (project_id, created_at desc);

alter table public.project_events enable row level security;

revoke all on table public.project_events from anon, authenticated;
grant select on table public.project_events to authenticated;
revoke insert, update, delete on public.workflow_states, public.workflow_transitions from anon, authenticated, public;

create or replace function public.prevent_project_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'IMMUTABLE_AUDIT' using errcode = '42501';
end;
$$;

drop trigger if exists project_events_immutable on public.project_events;
create trigger project_events_immutable
before update or delete on public.project_events
for each row execute procedure public.prevent_project_event_mutation();

create policy "Project members can read project events"
  on public.project_events for select to authenticated
  using (public.is_project_member(project_id));

-- All project writes now go through the audited RPCs below. In particular,
-- no browser role can mutate the key or slug.
revoke update on public.projects from anon, authenticated, public;

create or replace function public.update_project_settings(
  p_project_id uuid,
  p_name text,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_project public.projects%rowtype;
  v_name text := trim(coalesce(p_name, ''));
  v_description text := nullif(trim(coalesce(p_description, '')), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  select * into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_project(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_project.is_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'VALIDATION: Project name must be 2-80 characters' using errcode = '22023'; end if;
  if v_description is not null and char_length(v_description) > 280 then raise exception 'VALIDATION: Description is too long' using errcode = '22023'; end if;

  if v_project.name = v_name and v_project.description is not distinct from v_description then return; end if;

  update public.projects set name = v_name, description = v_description where id = p_project_id;
  insert into public.project_events (project_id, actor_id, event_type, old_value, new_value)
  values (
    p_project_id,
    v_actor,
    'PROJECT_UPDATED',
    jsonb_build_object('name', v_project.name, 'description', v_project.description),
    jsonb_build_object('name', v_name, 'description', v_description)
  );
end;
$$;

create or replace function public.set_project_archived(
  p_project_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_project public.projects%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_archived is null then raise exception 'VALIDATION: Archive state is required' using errcode = '22023'; end if;

  select * into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_project(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_project.is_archived = p_archived then return; end if;

  update public.projects set is_archived = p_archived where id = p_project_id;
  insert into public.project_events (project_id, actor_id, event_type, old_value, new_value)
  values (
    p_project_id,
    v_actor,
    case when p_archived then 'PROJECT_ARCHIVED' else 'PROJECT_RESTORED' end,
    to_jsonb(v_project.is_archived),
    to_jsonb(p_archived)
  );
end;
$$;

create or replace function public.replace_project_workflow(
  p_project_id uuid,
  p_states jsonb,
  p_transitions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_archived boolean;
  v_state jsonb;
  v_transition jsonb;
  v_state_id uuid;
  v_from_id uuid;
  v_to_id uuid;
  v_client_id text;
  v_map jsonb := '{}'::jsonb;
  v_keep_ids uuid[] := '{}'::uuid[];
  v_state_count integer;
  v_transition_count integer;
  v_initial_id uuid;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if jsonb_typeof(p_states) <> 'array' or jsonb_typeof(p_transitions) <> 'array' then
    raise exception 'VALIDATION: Workflow states and transitions must be arrays' using errcode = '22023';
  end if;

  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_project(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;

  v_state_count := jsonb_array_length(p_states);
  v_transition_count := jsonb_array_length(p_transitions);
  if v_state_count not between 2 and 50 then raise exception 'VALIDATION: A workflow needs 2-50 states' using errcode = '22023'; end if;
  if v_transition_count > 500 then raise exception 'VALIDATION: Too many workflow transitions' using errcode = '22023'; end if;

  if (select count(*) from jsonb_array_elements(p_states) s where coalesce((s->>'isInitial')::boolean, false)) <> 1 then
    raise exception 'VALIDATION: A workflow must have exactly one initial state' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_states) s where coalesce((s->>'isTerminal')::boolean, false)) < 1 then
    raise exception 'VALIDATION: A workflow must have at least one terminal state' using errcode = '22023';
  end if;
  if (select count(distinct lower(trim(s->>'name'))) from jsonb_array_elements(p_states) s) <> v_state_count then
    raise exception 'VALIDATION: State names must be unique' using errcode = '22023';
  end if;
  if (select count(distinct (s->>'position')::integer) from jsonb_array_elements(p_states) s) <> v_state_count then
    raise exception 'VALIDATION: State positions must be unique' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', ws.id, 'name', ws.name, 'category', ws.category, 'position', ws.position,
    'isInitial', ws.is_initial, 'isTerminal', ws.is_terminal
  ) order by ws.position) into v_old_snapshot
  from public.workflow_states ws where ws.project_id = p_project_id;

  for v_state in select value from jsonb_array_elements(p_states)
  loop
    v_client_id := nullif(trim(coalesce(v_state->>'clientId', v_state->>'id', '')), '');
    if v_client_id is null or char_length(v_client_id) > 80 then raise exception 'VALIDATION: Every state needs a valid clientId' using errcode = '22023'; end if;
    if v_map ? v_client_id then raise exception 'VALIDATION: State clientIds must be unique' using errcode = '22023'; end if;
    if char_length(trim(coalesce(v_state->>'name', ''))) not between 1 and 40 then raise exception 'VALIDATION: State names must be 1-40 characters' using errcode = '22023'; end if;
    if coalesce(v_state->>'category', '') not in ('TRIAGE', 'OPEN', 'IN_PROGRESS', 'REVIEW', 'RESOLVED', 'CLOSED') then raise exception 'VALIDATION: Invalid state category' using errcode = '22023'; end if;
    if coalesce(v_state->>'position', '') !~ '^\d+$' or (v_state->>'position')::integer > 10000 then raise exception 'VALIDATION: State position must be 0-10000' using errcode = '22023'; end if;

    if nullif(v_state->>'id', '') is not null then
      begin v_state_id := (v_state->>'id')::uuid; exception when invalid_text_representation then raise exception 'VALIDATION: Invalid state id' using errcode = '22023'; end;
      if not exists (select 1 from public.workflow_states ws where ws.id = v_state_id and ws.project_id = p_project_id) then
        raise exception 'VALIDATION: State does not belong to this project' using errcode = '22023';
      end if;
    else
      v_state_id := gen_random_uuid();
    end if;
    v_map := v_map || jsonb_build_object(v_client_id, v_state_id::text);
    v_keep_ids := array_append(v_keep_ids, v_state_id);
  end loop;

  for v_transition in select value from jsonb_array_elements(p_transitions)
  loop
    if not (v_map ? coalesce(v_transition->>'fromClientId', '')) or not (v_map ? coalesce(v_transition->>'toClientId', '')) then
      raise exception 'VALIDATION: Transition references an unknown state' using errcode = '22023';
    end if;
    v_from_id := (v_map->>(v_transition->>'fromClientId'))::uuid;
    v_to_id := (v_map->>(v_transition->>'toClientId'))::uuid;
    if v_from_id = v_to_id then raise exception 'VALIDATION: A state cannot transition to itself' using errcode = '22023'; end if;
    if nullif(v_transition->>'requiredRole', '') is not null and v_transition->>'requiredRole' not in ('MAINTAINER', 'DEVELOPER', 'REPORTER', 'VIEWER') then
      raise exception 'VALIDATION: Invalid transition role' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct concat(t->>'fromClientId', '->', t->>'toClientId')) from jsonb_array_elements(p_transitions) t) <> v_transition_count then
    raise exception 'VALIDATION: Duplicate workflow transition' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.workflow_states ws
    join public.issues i on i.status_id = ws.id
    where ws.project_id = p_project_id and not (ws.id = any(v_keep_ids))
  ) then raise exception 'STATE_IN_USE' using errcode = '23503'; end if;

  delete from public.workflow_transitions where project_id = p_project_id;
  update public.workflow_states
  set name = '#' || left(id::text, 39), position = 1000000 + row_number_value, is_initial = false
  from (
    select id, row_number() over (order by id)::integer as row_number_value
    from public.workflow_states where project_id = p_project_id
  ) staged
  where workflow_states.id = staged.id;

  for v_state in select value from jsonb_array_elements(p_states)
  loop
    v_client_id := coalesce(v_state->>'clientId', v_state->>'id');
    v_state_id := (v_map->>v_client_id)::uuid;
    insert into public.workflow_states (id, project_id, name, category, position, color, is_initial, is_terminal)
    values (
      v_state_id,
      p_project_id,
      trim(v_state->>'name'),
      v_state->>'category',
      (v_state->>'position')::integer,
      nullif(trim(coalesce(v_state->>'color', '')), ''),
      coalesce((v_state->>'isInitial')::boolean, false),
      coalesce((v_state->>'isTerminal')::boolean, false)
    )
    on conflict (id) do update set
      name = excluded.name,
      category = excluded.category,
      position = excluded.position,
      color = excluded.color,
      is_initial = excluded.is_initial,
      is_terminal = excluded.is_terminal;
  end loop;

  delete from public.workflow_states where project_id = p_project_id and not (id = any(v_keep_ids));

  for v_transition in select value from jsonb_array_elements(p_transitions)
  loop
    v_from_id := (v_map->>(v_transition->>'fromClientId'))::uuid;
    v_to_id := (v_map->>(v_transition->>'toClientId'))::uuid;
    insert into public.workflow_transitions (project_id, from_state_id, to_state_id, required_role, requires_resolution)
    values (
      p_project_id,
      v_from_id,
      v_to_id,
      nullif(v_transition->>'requiredRole', ''),
      coalesce((v_transition->>'requiresResolution')::boolean, false)
    );
  end loop;

  select id into v_initial_id from public.workflow_states where project_id = p_project_id and is_initial;

  if exists (
    select 1 from public.workflow_states ws
    where ws.project_id = p_project_id
      and ws.id not in (
        with recursive reachable(id) as (
          select v_initial_id
          union
          select wt.to_state_id from public.workflow_transitions wt join reachable r on r.id = wt.from_state_id where wt.project_id = p_project_id
        ) select id from reachable
      )
  ) then raise exception 'VALIDATION: Every state must be reachable from the initial state' using errcode = '22023'; end if;

  if exists (
    select 1 from public.workflow_states origin
    where origin.project_id = p_project_id
      and not exists (
        with recursive reachable(id) as (
          select origin.id
          union
          select wt.to_state_id from public.workflow_transitions wt join reachable r on r.id = wt.from_state_id where wt.project_id = p_project_id
        )
        select 1 from reachable r join public.workflow_states terminal on terminal.id = r.id where terminal.is_terminal
      )
  ) then raise exception 'VALIDATION: Every state must have a path to a terminal state' using errcode = '22023'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', ws.id, 'name', ws.name, 'category', ws.category, 'position', ws.position,
    'isInitial', ws.is_initial, 'isTerminal', ws.is_terminal
  ) order by ws.position) into v_new_snapshot
  from public.workflow_states ws where ws.project_id = p_project_id;

  insert into public.project_events (project_id, actor_id, event_type, old_value, new_value, metadata)
  values (p_project_id, v_actor, 'WORKFLOW_PUBLISHED', v_old_snapshot, v_new_snapshot, jsonb_build_object('transitionCount', v_transition_count));
end;
$$;

-- Transition resolution behavior is configured per edge. Maintainer overrides
-- still fall back to category-based behavior when no configured edge exists.
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
  v_old public.issues%rowtype;
  v_target_state public.workflow_states%rowtype;
  v_transition public.workflow_transitions%rowtype;
  v_requires_resolution boolean;
  v_resolution text;
  v_resolved_at timestamptz;
  v_closed_at timestamptz;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- SECURITY DEFINER must not let a project role bypass restricted visibility
  -- or distinguish a hidden issue UUID from one that does not exist.
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER', 'REPORTER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select * into v_target_state from public.workflow_states where id = p_to_state_id and project_id = v_project_id;
  if not found then raise exception 'INVALID_STATE' using errcode = '23503'; end if;
  select * into v_old from public.issues where id = p_issue_id for update;
  if v_old.status_id = p_to_state_id and (p_resolution is null or p_resolution = v_old.resolution) then return; end if;

  if v_old.status_id <> p_to_state_id then
    select * into v_transition from public.workflow_transitions
    where project_id = v_project_id and from_state_id = v_old.status_id and to_state_id = p_to_state_id;
    if v_role <> 'MAINTAINER' and (
      not found or not (
        v_transition.required_role is null
        or v_transition.required_role = v_role
        or v_transition.required_role = 'VIEWER'
        or (v_transition.required_role = 'REPORTER' and v_role in ('DEVELOPER', 'MAINTAINER'))
        or (v_transition.required_role = 'DEVELOPER' and v_role = 'MAINTAINER')
      )
    ) then raise exception 'INVALID_TRANSITION' using errcode = '42501'; end if;
  end if;

  v_requires_resolution := case
    when v_transition.id is not null then v_transition.requires_resolution
    else v_target_state.category in ('RESOLVED', 'CLOSED')
  end;

  if v_target_state.category in ('RESOLVED', 'CLOSED') then
    if v_requires_resolution then
      v_resolution := nullif(trim(coalesce(p_resolution, v_old.resolution, 'FIXED')), '');
    else
      v_resolution := nullif(trim(coalesce(p_resolution, '')), '');
    end if;
    if v_resolution is not null and v_resolution not in ('FIXED', 'DUPLICATE', 'WONT_FIX', 'INVALID', 'CANNOT_REPRODUCE', 'WORKS_AS_EXPECTED') then
      raise exception 'VALIDATION: Invalid resolution' using errcode = '22023';
    end if;
    if v_requires_resolution and v_resolution is null then raise exception 'RESOLUTION_REQUIRED' using errcode = '22023'; end if;
    v_resolved_at := coalesce(v_old.resolved_at, v_now);
    v_closed_at := case when v_target_state.category = 'CLOSED' then v_now else null end;
  else
    v_resolution := null;
    v_resolved_at := null;
    v_closed_at := null;
  end if;

  update public.issues set status_id = p_to_state_id, resolution = v_resolution,
    resolved_at = v_resolved_at, closed_at = v_closed_at, updated_at = v_now
  where id = p_issue_id;

  if v_old.status_id <> p_to_state_id then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
    values (p_issue_id, v_user, 'STATUS_CHANGED', 'status_id', to_jsonb(v_old.status_id::text), to_jsonb(p_to_state_id::text),
      jsonb_build_object('old_state_id', v_old.status_id, 'new_state_id', p_to_state_id, 'new_category', v_target_state.category,
        'resolution', v_resolution, 'resolution_required', v_requires_resolution));
  end if;
  if coalesce(v_old.resolution, '') is distinct from coalesce(v_resolution, '') then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
    values (p_issue_id, v_user, 'RESOLUTION_CHANGED', 'resolution', to_jsonb(v_old.resolution), to_jsonb(v_resolution));
  end if;
end;
$$;

revoke execute on function public.update_project_settings(uuid, text, text), public.set_project_archived(uuid, boolean), public.replace_project_workflow(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_project_settings(uuid, text, text), public.set_project_archived(uuid, boolean), public.replace_project_workflow(uuid, jsonb, jsonb) to authenticated;

revoke execute on function public.transition_issue(uuid, uuid, text) from public, anon;
grant execute on function public.transition_issue(uuid, uuid, text) to authenticated;
-- Phase 8: restricted security issue completion.
--
-- Restricted issue rows are already filtered by can_view_issue(). This
-- migration closes the remaining inference and mutation gaps: access changes
-- are auditable, notification payloads are metadata-safe, Storage paths are
-- issue-scoped, and browser writes remain RPC-only.

-- The existing issue_events table is the canonical immutable audit trail. Keep
-- access changes there even when they come from the atomic create RPC or from
-- membership offboarding, not only from the settings UI RPCs.
create or replace function public.record_issue_access_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_target uuid;
begin
  if tg_op = 'INSERT' then
    v_actor := new.granted_by;
    v_target := new.user_id;
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, new_value, metadata)
    values (
      new.issue_id,
      v_actor,
      'ACCESS_GRANTED',
      'issue_access',
      to_jsonb(v_target::text),
      jsonb_build_object('access_action', 'GRANTED', 'target_user_id', v_target)
    );
    return new;
  end if;

  begin
    v_actor := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  exception when invalid_text_representation then
    -- Service-role jobs can use opaque JWT subjects. Preserve the audit row
    -- with an unknown actor instead of silently dropping the event.
    v_actor := null;
  end;
  v_target := old.user_id;
  insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, metadata)
  values (
    old.issue_id,
    v_actor,
    'ACCESS_REVOKED',
    'issue_access',
    to_jsonb(v_target::text),
    jsonb_build_object('access_action', 'REVOKED', 'target_user_id', v_target)
  );
  return old;
end;
$$;

revoke execute on function public.record_issue_access_event() from public, anon, authenticated, service_role;

drop trigger if exists issue_access_audit_insert on public.issue_access;
create trigger issue_access_audit_insert
after insert on public.issue_access
for each row execute procedure public.record_issue_access_event();

drop trigger if exists issue_access_audit_delete on public.issue_access;
create trigger issue_access_audit_delete
after delete on public.issue_access
for each row execute procedure public.record_issue_access_event();

-- Preserve history for grants that predate this table-boundary trigger without
-- duplicating audit rows already written by the legacy grant RPC.
do $backfill_access_history$
declare
  v_previous_role text := current_setting('request.jwt.claim.role', true);
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into public.issue_events (issue_id, actor_id, event_type, field_name, new_value, metadata, created_at)
  select ia.issue_id, ia.granted_by, 'ACCESS_GRANTED', 'issue_access', to_jsonb(ia.user_id::text),
         jsonb_build_object('access_action', 'GRANTED', 'target_user_id', ia.user_id, 'backfilled', true), ia.created_at
    from public.issue_access ia
   where not exists (
     select 1 from public.issue_events e
      where e.issue_id = ia.issue_id
        and e.event_type = 'ACCESS_GRANTED'
        and e.new_value = to_jsonb(ia.user_id::text)
   );
  perform set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
end;
$backfill_access_history$;

-- A restricted issue can only be granted to an active project member (or an
-- organization owner/admin who has workspace-wide project access). Duplicate
-- grants are idempotent and do not create fake history entries.
create or replace function public.grant_issue_access(p_issue_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_issue record;
  v_archived boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_user_id is null then raise exception 'VALIDATION: A user is required' using errcode = '22023'; end if;

  select i.id, i.project_id, i.reporter_id, i.visibility
    into v_issue
    from public.issues i
   where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_issue.visibility <> 'RESTRICTED' then
    raise exception 'VALIDATION: Access grants require restricted visibility' using errcode = '22023';
  end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_issue.project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_actor <> v_issue.reporter_id and public.project_role(v_issue.project_id) not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.project_members pm
     where pm.project_id = v_issue.project_id and pm.user_id = p_user_id
  ) and not exists (
    select 1
      from public.projects p
      join public.organizations o on o.id = p.organization_id
      left join public.organization_members om on om.organization_id = o.id and om.user_id = p_user_id
     where p.id = v_issue.project_id
       and (o.owner_id = p_user_id or om.role in ('OWNER', 'ADMIN'))
  ) then
    raise exception 'VALIDATION: Grantee must have project access' using errcode = '22023';
  end if;

  insert into public.issue_access (issue_id, user_id, granted_by)
  values (p_issue_id, p_user_id, v_actor)
  on conflict (issue_id, user_id) do nothing;
end;
$$;

create or replace function public.revoke_issue_access(p_issue_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_issue record;
  v_archived boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select i.project_id, i.reporter_id, i.visibility into v_issue from public.issues i where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_issue.visibility <> 'RESTRICTED' then
    raise exception 'VALIDATION: Access grants require restricted visibility' using errcode = '22023';
  end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_issue.project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_actor <> v_issue.reporter_id and public.project_role(v_issue.project_id) not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  delete from public.issue_access where issue_id = p_issue_id and user_id = p_user_id;
end;
$$;

-- Reporter/admin visibility controls are allowed only for a currently visible
-- issue. Leaving restricted mode revokes explicit grants so a later re-open of
-- the issue cannot accidentally restore stale confidential access.
create or replace function public.set_issue_visibility(p_issue_id uuid, p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_issue record;
  v_archived boolean;
  v_visibility text := upper(trim(coalesce(p_visibility, 'PROJECT')));
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_visibility not in ('PROJECT', 'RESTRICTED') then raise exception 'VALIDATION: Invalid visibility' using errcode = '22023'; end if;
  select i.id, i.project_id, i.visibility, i.reporter_id into v_issue from public.issues i where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_issue.project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_actor <> v_issue.reporter_id and public.project_role(v_issue.project_id) not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_issue.visibility = v_visibility then return; end if;

  update public.issues set visibility = v_visibility, updated_at = timezone('utc'::text, now()) where id = p_issue_id;
  if v_visibility <> 'RESTRICTED' then
    delete from public.issue_access where issue_id = p_issue_id;
  end if;
  insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
  values (p_issue_id, v_actor, 'VISIBILITY_CHANGED', 'visibility', to_jsonb(v_issue.visibility), to_jsonb(v_visibility));
end;
$$;

revoke execute on function public.grant_issue_access(uuid, uuid), public.revoke_issue_access(uuid, uuid), public.set_issue_visibility(uuid, text) from public, anon;
grant execute on function public.grant_issue_access(uuid, uuid), public.revoke_issue_access(uuid, uuid), public.set_issue_visibility(uuid, text) to authenticated;

-- Browser clients may inspect current grants only through the issue's existing
-- RLS visibility. There is no direct grant/revoke path.
revoke insert, update, delete on public.issue_access from public, anon, authenticated;
grant select on public.issue_access to authenticated;
revoke insert, update, delete on public.issue_events from public, anon, authenticated;

-- Privilege revocation is the browser boundary, while the trigger also makes
-- the audit contract true for privileged maintenance clients.
create or replace function public.prevent_issue_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'IMMUTABLE_AUDIT' using errcode = '42501';
end;
$$;
revoke execute on function public.prevent_issue_event_mutation() from public, anon, authenticated, service_role;

drop trigger if exists issue_events_immutable on public.issue_events;
create trigger issue_events_immutable
before update or delete on public.issue_events
for each row execute procedure public.prevent_issue_event_mutation();

create index if not exists issue_access_issue_created_idx on public.issue_access (issue_id, created_at desc);
create index if not exists issues_restricted_queue_idx on public.issues (project_id, updated_at desc, id) where visibility = 'RESTRICTED';

-- Safe path parser for Storage policies. Invalid or non-UUID prefixes return
-- NULL instead of producing a cast error or allowing a policy bypass.
create or replace function public.issue_id_from_storage_path(p_name text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_prefix text;
begin
  v_prefix := split_part(coalesce(p_name, ''), '/', 1);
  if v_prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return null; end if;
  return v_prefix::uuid;
exception when invalid_text_representation then return null;
end;
$$;
revoke execute on function public.issue_id_from_storage_path(text) from public, anon;
grant execute on function public.issue_id_from_storage_path(text) to authenticated;

drop policy if exists "Issue viewers can download attachments" on storage.objects;
create policy "Issue viewers can download attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and public.can_view_issue(public.issue_id_from_storage_path(name))
  );

drop policy if exists "Members can upload issue attachments" on storage.objects;
create policy "Members can upload issue attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and public.can_view_issue(public.issue_id_from_storage_path(name))
    and public.can_comment_on_issue(public.issue_id_from_storage_path(name))
  );

drop policy if exists "Owners and maintainers can delete attachments" on storage.objects;
create policy "Owners and maintainers can delete attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and public.can_view_issue(public.issue_id_from_storage_path(name))
    and exists (
      select 1 from public.issues i join public.projects p on p.id = i.project_id
       where i.id = public.issue_id_from_storage_path(name) and p.is_archived is false
    )
    and (
      owner_id = (select auth.uid()::text)
      or public.can_manage_project((select i.project_id from public.issues i where i.id = public.issue_id_from_storage_path(name)))
    )
  );

drop policy if exists "Members can update issue attachments" on storage.objects;
create policy "Members can update issue attachments"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and owner_id = (select auth.uid()::text)
    and public.can_view_issue(public.issue_id_from_storage_path(name))
    and exists (
      select 1 from public.issues i join public.projects p on p.id = i.project_id
       where i.id = public.issue_id_from_storage_path(name) and p.is_archived is false
    )
  )
  with check (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and owner_id = (select auth.uid()::text)
    and public.can_view_issue(public.issue_id_from_storage_path(name))
    and exists (
      select 1 from public.issues i join public.projects p on p.id = i.project_id
       where i.id = public.issue_id_from_storage_path(name) and p.is_archived is false
    )
  );

-- Restricted notifications are returned only while the recipient can still
-- view the issue. Preserve the key/number needed for a safe authorized link,
-- while redacting title, actor display name, and arbitrary event payload.
create or replace function public.list_notifications(
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_unread_only boolean default false,
  p_limit integer default 25
)
returns table (
  id uuid, issue_id uuid, type text, data jsonb, actor_id uuid, actor_name text,
  issue_number bigint, project_key text, issue_title text, read_at timestamptz,
  created_at timestamptz, next_cursor_created_at timestamptz, next_cursor_id uuid,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return query
  with visible as (
    select n.id, n.issue_id, n.type,
           case when coalesce(i.visibility, 'PROJECT') = 'RESTRICTED' then jsonb_build_object('restricted', true) else n.data end as safe_data,
           n.actor_id, case when coalesce(i.visibility, 'PROJECT') = 'RESTRICTED' then null else ap.display_name end as safe_actor_name,
           i.issue_number as safe_issue_number,
           p.key as safe_project_key,
           case when coalesce(i.visibility, 'PROJECT') = 'RESTRICTED' then null else i.title end as safe_issue_title,
           n.read_at, n.created_at,
           row_number() over (order by n.created_at desc, n.id desc) as rn
      from public.notifications n
      left join public.profiles ap on ap.id = n.actor_id
      left join public.issues i on i.id = n.issue_id
      left join public.projects p on p.id = i.project_id
     where n.user_id = v_user
       and (p_unread_only is not true or n.read_at is null)
       and (n.issue_id is null or public.can_view_issue(n.issue_id))
       and (p_cursor_created_at is null or (n.created_at, n.id) < (p_cursor_created_at, p_cursor_id))
  ), page as (select * from visible where rn <= v_limit + 1),
  boundary as (select created_at as boundary_created_at, id as boundary_id from page where rn = v_limit),
  more as (select exists (select 1 from page where rn = v_limit + 1) as has_more)
  select v.id, v.issue_id, v.type, v.safe_data, v.actor_id, v.safe_actor_name,
         v.safe_issue_number, v.safe_project_key, v.safe_issue_title, v.read_at, v.created_at,
         b.boundary_created_at, b.boundary_id, m.has_more
    from page v cross join more m left join boundary b on true
   where v.rn <= v_limit
   order by v.created_at desc, v.id desc;
end;
$$;

revoke execute on function public.list_notifications(timestamptz, uuid, boolean, integer) from public, anon;
grant execute on function public.list_notifications(timestamptz, uuid, boolean, integer) to authenticated;

-- Notification rows are dispatcher-owned. Marking read remains available via
-- the dedicated RPCs, whose functions run with the table owner's privileges.
revoke insert, update, delete on public.notifications from public, anon, authenticated;
-- Phase 9: issue queue filtering, indexes, and authorized bulk updates.
-- Queue reads remain RLS-backed. Bulk writes are RPC-only and lock the project
-- before issues in UUID order so a multi-row operation is atomic and observable.

create index if not exists issues_queue_reporter_created_idx
  on public.issues (project_id, reporter_id, created_at desc, id);
create index if not exists issues_queue_version_idx
  on public.issues (project_id, affected_version_id, updated_at desc, id);
create index if not exists issues_queue_milestone_idx
  on public.issues (project_id, target_milestone_id, updated_at desc, id);
create index if not exists issue_labels_issue_label_idx
  on public.issue_labels (issue_id, label_id);

create or replace function public.bulk_update_issue_fields(
  p_project_id uuid,
  p_issue_ids uuid[],
  p_updates jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_archived boolean;
  v_issue record;
  v_count integer := 0;
  v_expected integer;
  v_core jsonb;
  v_version uuid;
  v_milestone uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_project_id is null or p_issue_ids is null or coalesce(array_length(p_issue_ids, 1), 0) = 0 then
    raise exception 'VALIDATION: Select at least one issue' using errcode = '22023';
  end if;
  if array_length(p_issue_ids, 1) > 100 then
    raise exception 'VALIDATION: Bulk updates are limited to 100 issues' using errcode = '22023';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'object' or p_updates = '{}'::jsonb then
    raise exception 'VALIDATION: An update object with at least one supported field is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_updates) key(name)
    where name not in ('priority', 'severity', 'type', 'assignee_id', 'component_id', 'affected_version_id', 'target_milestone_id')
  ) then
    raise exception 'VALIDATION: Unsupported bulk issue update field' using errcode = '22023';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = p_project_id
  for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select count(*)::integer, count(distinct issue_id)::integer
    into v_expected, v_count
  from unnest(p_issue_ids) issue_id;
  if v_expected <> v_count then
    raise exception 'VALIDATION: Duplicate issue selection' using errcode = '22023';
  end if;
  select count(*)::integer into v_count
  from public.issues i
  where i.project_id = p_project_id
    and i.id = any(p_issue_ids)
    and public.can_view_issue(i.id);
  if v_count <> v_expected then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_updates ? 'priority' and (jsonb_typeof(p_updates->'priority') <> 'string' or p_updates->>'priority' not in ('P0','P1','P2','P3','P4')) then
    raise exception 'VALIDATION: Invalid priority' using errcode = '22023';
  end if;
  if p_updates ? 'severity' and (jsonb_typeof(p_updates->'severity') <> 'string' or p_updates->>'severity' not in ('BLOCKER','CRITICAL','MAJOR','MINOR','TRIVIAL')) then
    raise exception 'VALIDATION: Invalid severity' using errcode = '22023';
  end if;
  if p_updates ? 'type' and (jsonb_typeof(p_updates->'type') <> 'string' or p_updates->>'type' not in ('BUG','ENHANCEMENT','TASK','SECURITY','PERFORMANCE','REGRESSION')) then
    raise exception 'VALIDATION: Invalid issue type' using errcode = '22023';
  end if;
  begin
    if p_updates ? 'assignee_id' and jsonb_typeof(p_updates->'assignee_id') <> 'null' then v_version := (p_updates->>'assignee_id')::uuid; end if;
    if p_updates ? 'component_id' and jsonb_typeof(p_updates->'component_id') <> 'null' then v_version := (p_updates->>'component_id')::uuid; end if;
    if p_updates ? 'affected_version_id' and jsonb_typeof(p_updates->'affected_version_id') <> 'null' then v_version := (p_updates->>'affected_version_id')::uuid; end if;
    if p_updates ? 'target_milestone_id' and jsonb_typeof(p_updates->'target_milestone_id') <> 'null' then v_milestone := (p_updates->>'target_milestone_id')::uuid; end if;
  exception when invalid_text_representation then
    raise exception 'VALIDATION: Invalid UUID' using errcode = '22023';
  end;
  if p_updates ? 'component_id' and jsonb_typeof(p_updates->'component_id') <> 'null' and not exists (select 1 from public.components c where c.id = (p_updates->>'component_id')::uuid and c.project_id = p_project_id and not c.is_archived) then
    raise exception 'INVALID_COMPONENT' using errcode = '23503';
  end if;
  if p_updates ? 'assignee_id' and jsonb_typeof(p_updates->'assignee_id') <> 'null' and not (
    exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = (p_updates->>'assignee_id')::uuid)
    or exists (select 1 from public.projects p join public.organizations o on o.id = p.organization_id left join public.organization_members om on om.organization_id = o.id and om.user_id = (p_updates->>'assignee_id')::uuid where p.id = p_project_id and (o.owner_id = (p_updates->>'assignee_id')::uuid or om.role in ('OWNER','ADMIN')))
  ) then raise exception 'INVALID_ASSIGNEE' using errcode = '23503'; end if;
  if p_updates ? 'affected_version_id' and jsonb_typeof(p_updates->'affected_version_id') <> 'null' and not exists (select 1 from public.versions v where v.id = (p_updates->>'affected_version_id')::uuid and v.project_id = p_project_id and not v.is_archived) then
    raise exception 'INVALID_VERSION' using errcode = '23503';
  end if;
  if p_updates ? 'target_milestone_id' and jsonb_typeof(p_updates->'target_milestone_id') <> 'null' and not exists (select 1 from public.milestones m where m.id = (p_updates->>'target_milestone_id')::uuid and m.project_id = p_project_id) then
    raise exception 'INVALID_MILESTONE' using errcode = '23503';
  end if;

  v_core := p_updates - 'affected_version_id' - 'target_milestone_id';
  for v_issue in
    select i.id, i.affected_version_id, i.target_milestone_id
    from public.issues i
    where i.project_id = p_project_id and i.id = any(p_issue_ids)
    order by i.id
    for update
  loop
    if v_core <> '{}'::jsonb then perform public.update_issue_fields(v_issue.id, v_core); end if;
    if p_updates ? 'affected_version_id' and v_issue.affected_version_id is distinct from nullif(p_updates->>'affected_version_id', '')::uuid then
      update public.issues set affected_version_id = nullif(p_updates->>'affected_version_id', '')::uuid where id = v_issue.id;
      insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value) values (v_issue.id, v_user, 'VERSION_CHANGED', 'affected_version_id', to_jsonb(v_issue.affected_version_id::text), to_jsonb(nullif(p_updates->>'affected_version_id', '')));
    end if;
    if p_updates ? 'target_milestone_id' and v_issue.target_milestone_id is distinct from nullif(p_updates->>'target_milestone_id', '')::uuid then
      update public.issues set target_milestone_id = nullif(p_updates->>'target_milestone_id', '')::uuid where id = v_issue.id;
      insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value) values (v_issue.id, v_user, 'MILESTONE_CHANGED', 'target_milestone_id', to_jsonb(v_issue.target_milestone_id::text), to_jsonb(nullif(p_updates->>'target_milestone_id', '')));
    end if;
  end loop;
  return v_expected;
end;
$$;

revoke execute on function public.bulk_update_issue_fields(uuid, uuid[], jsonb) from anon, public;
grant execute on function public.bulk_update_issue_fields(uuid, uuid[], jsonb) to authenticated;
-- Phase 9: saved-view lifecycle, explicit sharing visibility, and stable links.
-- PRIVATE is owner-only, PROJECT is visible to project members, and
-- ORGANIZATION is visible to members of the owning workspace who can access
-- the project. Saved-view writes are RPC-only.

drop function if exists public.create_saved_view(uuid, text, jsonb, boolean);
drop function if exists public.update_saved_view_sharing(uuid, boolean);

-- Remove every legacy policy that references is_shared before retiring the
-- column. PostgreSQL correctly blocks a column drop while policy expressions
-- still depend on it.
drop policy if exists "Project members can read saved views" on public.saved_views;
drop policy if exists "Project members can create saved views" on public.saved_views;
drop policy if exists "Owners can update/delete their saved views" on public.saved_views;
drop policy if exists "Owners can update their saved views" on public.saved_views;
drop policy if exists "Owners can delete their saved views" on public.saved_views;

alter table public.saved_views add column if not exists visibility text;
update public.saved_views
   set visibility = case when is_shared then 'PROJECT' else 'PRIVATE' end
 where visibility is null;
alter table public.saved_views alter column visibility set default 'PRIVATE';
alter table public.saved_views alter column visibility set not null;
alter table public.saved_views drop constraint if exists saved_views_visibility_check;
alter table public.saved_views add constraint saved_views_visibility_check
  check (visibility in ('PRIVATE', 'PROJECT', 'ORGANIZATION'));
alter table public.saved_views drop column if exists is_shared;

create index if not exists saved_views_visibility_project_idx
  on public.saved_views (project_id, visibility, created_at desc);

create policy "Authorized members can read saved views"
  on public.saved_views for select to authenticated
  using (
    public.is_project_member(project_id)
    and (
      (visibility = 'PRIVATE' and created_by = (select auth.uid()))
      or visibility = 'PROJECT'
      or (
        visibility = 'ORGANIZATION'
        and exists (
          select 1 from public.projects p
          join public.organization_members om on om.organization_id = p.organization_id
         where p.id = saved_views.project_id
           and om.user_id = (select auth.uid())
        )
      )
    )
  );

create or replace function public.create_saved_view(
  p_project_id uuid,
  p_name text,
  p_filters jsonb default '{}'::jsonb,
  p_visibility text default 'PRIVATE'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_view_id uuid;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_visibility text := upper(trim(coalesce(p_visibility, 'PRIVATE')));
  v_archived boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_name is null or char_length(v_name) > 80 then raise exception 'VALIDATION: Saved view name must be 1–80 characters' using errcode = '22023'; end if;
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then raise exception 'VALIDATION: Saved view filters must be an object' using errcode = '22023'; end if;
  if v_visibility not in ('PRIVATE', 'PROJECT', 'ORGANIZATION') then raise exception 'VALIDATION: Invalid saved view visibility' using errcode = '22023'; end if;
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_visibility = 'ORGANIZATION' and not public.can_manage_project(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.saved_views (project_id, created_by, name, filters, visibility)
  values (p_project_id, v_user, v_name, p_filters, v_visibility)
  returning id into v_view_id;
  return v_view_id;
end;
$$;

create or replace function public.rename_saved_view(p_view_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_name is null or char_length(v_name) > 80 then raise exception 'VALIDATION: Saved view name must be 1–80 characters' using errcode = '22023'; end if;
  update public.saved_views sv set name = v_name, updated_at = now()
   where sv.id = p_view_id and sv.created_by = v_user
     and public.is_project_member(sv.project_id)
     and exists (select 1 from public.projects p where p.id = sv.project_id and not p.is_archived);
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.update_saved_view_filters(p_view_id uuid, p_filters jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then raise exception 'VALIDATION: Saved view filters must be an object' using errcode = '22023'; end if;
  update public.saved_views sv set filters = p_filters, updated_at = now()
   where sv.id = p_view_id and sv.created_by = v_user
     and public.is_project_member(sv.project_id)
     and exists (select 1 from public.projects p where p.id = sv.project_id and not p.is_archived);
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.update_saved_view_visibility(p_view_id uuid, p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_visibility text := upper(trim(coalesce(p_visibility, 'PRIVATE')));
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_visibility not in ('PRIVATE', 'PROJECT', 'ORGANIZATION') then raise exception 'VALIDATION: Invalid saved view visibility' using errcode = '22023'; end if;
  select sv.project_id, p.is_archived into v_project_id, v_archived
    from public.saved_views sv join public.projects p on p.id = sv.project_id
   where sv.id = p_view_id and sv.created_by = v_user;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(v_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_visibility = 'ORGANIZATION' and not public.can_manage_project(v_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.saved_views set visibility = v_visibility, updated_at = now() where id = p_view_id;
end;
$$;

create or replace function public.delete_saved_view(p_view_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  delete from public.saved_views sv
   where sv.id = p_view_id and sv.created_by = v_user
     and public.is_project_member(sv.project_id)
     and exists (select 1 from public.projects p where p.id = sv.project_id and not p.is_archived);
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

revoke execute on function public.create_saved_view(uuid, text, jsonb, text), public.rename_saved_view(uuid, text), public.update_saved_view_filters(uuid, jsonb), public.update_saved_view_visibility(uuid, text), public.delete_saved_view(uuid) from public, anon;
grant execute on function public.create_saved_view(uuid, text, jsonb, text), public.rename_saved_view(uuid, text), public.update_saved_view_filters(uuid, jsonb), public.update_saved_view_visibility(uuid, text), public.delete_saved_view(uuid) to authenticated;
-- Migration 053: Phase 9 triage command UX contracts.
-- Duplicate resolution is deliberately one RPC so link, lifecycle, and audit
-- events commit together or are all rolled back.

create or replace function public.resolve_duplicate_issue(
  p_duplicate_issue_id uuid,
  p_canonical_issue_id uuid
)
returns table (duplicate_issue_id uuid, canonical_issue_id uuid, canonical_issue_number bigint)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid(); v_project_id uuid; v_archived boolean; v_role text;
  v_canonical_number bigint; v_resolved_state uuid; v_link_id uuid;
  v_old_state uuid; v_old_resolution text; v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_duplicate_issue_id is null or p_canonical_issue_id is null or p_duplicate_issue_id = p_canonical_issue_id then
    raise exception 'VALIDATION: Choose a different canonical issue' using errcode = '22023';
  end if;
  select i.project_id into v_project_id from public.issues i where i.id = p_duplicate_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_duplicate_issue_id) or not exists (
    select 1 from public.issues i where i.id = p_canonical_issue_id and i.project_id = v_project_id and public.can_view_issue(i.id)
  ) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- Stable issue ordering prevents two concurrent duplicate actions deadlocking.
  perform 1 from public.issues i where i.id in (p_duplicate_issue_id, p_canonical_issue_id) order by i.id for update;
  select i.issue_number into v_canonical_number from public.issues i where i.id = p_canonical_issue_id;
  select i.status_id, i.resolution into v_old_state, v_old_resolution
  from public.issues i where i.id = p_duplicate_issue_id;
  select ws.id into v_resolved_state from public.workflow_states ws where ws.project_id = v_project_id and ws.category = 'RESOLVED' order by ws.position limit 1;
  if v_resolved_state is null then raise exception 'INVALID_STATE' using errcode = '23503'; end if;
  -- Keep link, resolution, and their observable activity in this transaction.
  insert into public.issue_links(source_issue_id, target_issue_id, relationship, created_by)
  values (p_duplicate_issue_id, p_canonical_issue_id, 'DUPLICATE_OF', v_user)
  returning id into v_link_id;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, metadata, new_value)
  values (p_duplicate_issue_id, v_user, 'ISSUE_LINKED', null, null,
    jsonb_build_object('target_id', p_canonical_issue_id, 'relationship', 'DUPLICATE_OF'),
    jsonb_build_object('canonical_issue_id', p_canonical_issue_id, 'canonical_issue_number', v_canonical_number));
  update public.issues
  set status_id = v_resolved_state, resolution = 'DUPLICATE', resolved_at = coalesce(resolved_at, v_now), closed_at = null, updated_at = v_now
  where id = p_duplicate_issue_id;
  if v_old_state is distinct from v_resolved_state then
    insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
    values (p_duplicate_issue_id, v_user, 'STATUS_CHANGED', 'status_id', to_jsonb(v_old_state::text), to_jsonb(v_resolved_state::text), jsonb_build_object('new_category', 'RESOLVED', 'resolution', 'DUPLICATE'));
  end if;
  if v_old_resolution is distinct from 'DUPLICATE' then
    insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value)
    values (p_duplicate_issue_id, v_user, 'RESOLUTION_CHANGED', 'resolution', to_jsonb(v_old_resolution), to_jsonb('DUPLICATE'::text));
  end if;
  return query select p_duplicate_issue_id, p_canonical_issue_id, v_canonical_number;
end;
$$;

revoke execute on function public.resolve_duplicate_issue(uuid, uuid) from anon, public;
grant execute on function public.resolve_duplicate_issue(uuid, uuid) to authenticated;
-- Phase 10: complete issue-template lifecycle and safe template application.

alter table public.issue_templates
  add column if not exists is_archived boolean not null default false;

create index if not exists issue_templates_project_active_idx
  on public.issue_templates (project_id, is_archived, name);

create table if not exists public.issue_template_labels (
  template_id uuid not null references public.issue_templates(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  primary key (template_id, label_id)
);
create index if not exists issue_template_labels_label_idx on public.issue_template_labels(label_id);
alter table public.issue_template_labels enable row level security;
create policy "Project members can read issue template labels"
  on public.issue_template_labels for select to authenticated
  using (exists (select 1 from public.issue_templates t where t.id = template_id and public.is_project_member(t.project_id)));

create or replace function public.validate_issue_template_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.is_archived and new.default_component_id is not null and not exists (
    select 1 from public.components c where c.id = new.default_component_id
      and c.project_id = new.project_id and not c.is_archived
  ) then
    raise exception 'INVALID_COMPONENT' using errcode = '23503';
  end if;
  if new.default_priority is not null and new.default_priority not in ('P0','P1','P2','P3','P4') then
    raise exception 'VALIDATION: Invalid template priority' using errcode = '22023';
  end if;
  if new.default_severity is not null and new.default_severity not in ('BLOCKER','CRITICAL','MAJOR','MINOR','TRIVIAL') then
    raise exception 'VALIDATION: Invalid template severity' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists issue_templates_validate_defaults on public.issue_templates;
create trigger issue_templates_validate_defaults before insert or update on public.issue_templates
for each row execute procedure public.validate_issue_template_defaults();

-- Keep the established function contract while applying template labels in the
-- same transaction. The old implementation is retained as a private base.
alter function public.create_issue_complete(uuid, jsonb) rename to create_issue_complete_base;
create or replace function public.create_issue_complete(p_project_id uuid, p_payload jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_number bigint;
  v_issue_id uuid;
  v_template_id uuid := nullif(p_payload->>'template_id', '')::uuid;
  v_template public.issue_templates%rowtype;
  v_key text;
  v_field_id uuid;
begin
  if p_payload ? 'custom_values' and jsonb_typeof(p_payload->'custom_values') <> 'object' then
    raise exception 'VALIDATION: Custom values must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'custom_values') = 'object' then
    for v_key in select jsonb_object_keys(p_payload->'custom_values') loop
      begin v_field_id := v_key::uuid;
      exception when invalid_text_representation then
        raise exception 'VALIDATION: Custom field id must be a UUID' using errcode = '22023';
      end;
      if not exists (select 1 from public.custom_fields f where f.id = v_field_id and f.project_id = p_project_id) then
        raise exception 'VALIDATION: Custom field does not belong to this project' using errcode = '22023';
      end if;
    end loop;
  end if;
  if v_template_id is not null then
    select * into v_template from public.issue_templates t
    where t.id = v_template_id and t.project_id = p_project_id and not t.is_archived
    for key share;
  end if;
  if v_template_id is not null and not found then
    raise exception 'INVALID_TEMPLATE' using errcode = '23503';
  end if;
  v_number := public.create_issue_complete_base(p_project_id, p_payload);
  if v_template_id is not null then
    select id into v_issue_id from public.issues where project_id = p_project_id and issue_number = v_number;
    insert into public.issue_labels(issue_id, label_id)
    select v_issue_id, tl.label_id
    from public.issue_template_labels tl
    join public.labels l on l.id = tl.label_id and l.project_id = p_project_id
    where tl.template_id = v_template_id
    on conflict do nothing;
  end if;
  return v_number;
end;
$$;
revoke execute on function public.create_issue_complete_base(uuid, jsonb) from anon, public, authenticated;
revoke execute on function public.create_issue_complete(uuid, jsonb) from anon, public;
grant execute on function public.create_issue_complete(uuid, jsonb) to authenticated;

create or replace function public.set_issue_template_labels(p_template_id uuid, p_label_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_archived boolean;
begin
  select project_id, is_archived into v_project_id, v_archived from public.issue_templates where id = p_template_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'TEMPLATE_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_manage_project(v_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if exists (select 1 from unnest(coalesce(p_label_ids, '{}'::uuid[])) x(id) where not exists (select 1 from public.labels l where l.id = x.id and l.project_id = v_project_id)) then
    raise exception 'INVALID_LABEL' using errcode = '23503';
  end if;
  delete from public.issue_template_labels where template_id = p_template_id;
  insert into public.issue_template_labels(template_id, label_id)
  select p_template_id, x.id from unnest(coalesce(p_label_ids, '{}'::uuid[])) x(id) on conflict do nothing;
end;
$$;

create or replace function public.set_issue_template_archived(p_template_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_project_id uuid;
begin
  select project_id into v_project_id from public.issue_templates where id = p_template_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_project(v_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.issue_templates set is_archived = coalesce(p_archived, false) where id = p_template_id;
end;
$$;

create or replace function public.duplicate_issue_template(p_template_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_source public.issue_templates%rowtype; v_id uuid; v_name text;
begin
  select * into v_source from public.issue_templates where id = p_template_id for key share;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_project(v_source.project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_name := nullif(trim(p_name), '');
  if v_name is null or char_length(v_name) > 80 then raise exception 'VALIDATION: Template name is required' using errcode = '22023'; end if;
  insert into public.issue_templates(project_id, name, description, issue_type, body_template, default_priority, default_severity, default_component_id, created_by)
  values (v_source.project_id, v_name, v_source.description, v_source.issue_type, v_source.body_template, v_source.default_priority, v_source.default_severity, v_source.default_component_id, auth.uid()) returning id into v_id;
  insert into public.issue_template_labels(template_id, label_id) select v_id, label_id from public.issue_template_labels where template_id = p_template_id;
  return v_id;
end;
$$;

create or replace function public.create_issue_template_complete(
  p_project_id uuid, p_name text, p_description text, p_issue_type text,
  p_body_template text, p_default_priority text, p_default_severity text,
  p_default_component_id uuid, p_label_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := public.create_issue_template(p_project_id, p_name, p_description, p_issue_type, p_body_template, p_default_priority, p_default_severity, p_default_component_id);
  perform public.set_issue_template_labels(v_id, p_label_ids);
  return v_id;
end;
$$;

create or replace function public.update_issue_template_complete(
  p_template_id uuid, p_name text, p_description text, p_issue_type text,
  p_body_template text, p_default_priority text, p_default_severity text,
  p_default_component_id uuid, p_label_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public.update_issue_template(p_template_id, p_name, p_description, p_issue_type, p_body_template, p_default_priority, p_default_severity, p_default_component_id);
  perform public.set_issue_template_labels(p_template_id, p_label_ids);
  return p_template_id;
end;
$$;

revoke execute on function public.set_issue_template_labels(uuid, uuid[]) from anon, public;
revoke execute on function public.set_issue_template_archived(uuid, boolean) from anon, public;
revoke execute on function public.duplicate_issue_template(uuid, text) from anon, public;
grant execute on function public.set_issue_template_labels(uuid, uuid[]) to authenticated;
grant execute on function public.set_issue_template_archived(uuid, boolean) to authenticated;
grant execute on function public.duplicate_issue_template(uuid, text) to authenticated;
revoke execute on function public.create_issue_template_complete(uuid, text, text, text, text, text, text, uuid, uuid[]) from anon, public;
revoke execute on function public.update_issue_template_complete(uuid, text, text, text, text, text, text, uuid, uuid[]) from anon, public;
grant execute on function public.create_issue_template_complete(uuid, text, text, text, text, text, text, uuid, uuid[]) to authenticated;
grant execute on function public.update_issue_template_complete(uuid, text, text, text, text, text, text, uuid, uuid[]) to authenticated;
-- Phase 10: complete custom-field lifecycle and authoritative value validation.
-- All writes remain RPC-only; field types are immutable once values exist.

revoke insert, update, delete on public.custom_fields, public.issue_custom_values from authenticated, anon, public;

create or replace function public.validate_custom_field_definition(
  p_field_type text,
  p_config jsonb
)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_options jsonb := coalesce(p_config, '{}'::jsonb)->'options';
begin
  if p_field_type not in ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'USER') then
    raise exception 'VALIDATION: Invalid custom field type' using errcode = '22023';
  end if;
  if p_field_type in ('SINGLE_SELECT', 'MULTI_SELECT') then
    if jsonb_typeof(v_options) <> 'array' or jsonb_array_length(v_options) = 0
       or exists (select 1 from jsonb_array_elements(v_options) option where jsonb_typeof(option) <> 'string' or nullif(trim(option #>> '{}'), '') is null)
       or jsonb_array_length(v_options) <> (select count(distinct option #>> '{}') from jsonb_array_elements(v_options) option) then
      raise exception 'VALIDATION: Select fields require unique non-empty options' using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function public.validate_custom_field_value(
  p_field_id uuid,
  p_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_field record;
  v_item jsonb;
  v_user uuid := auth.uid();
begin
  select * into v_field from public.custom_fields where id = p_field_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_value is null or jsonb_typeof(p_value) = 'null' or p_value = '""'::jsonb or p_value = '[]'::jsonb then
    if v_field.is_required then raise exception 'VALIDATION: Required custom field cannot be empty' using errcode = '22023'; end if;
    return;
  end if;
  if (v_field.field_type in ('TEXT', 'DATE', 'SINGLE_SELECT', 'USER') and jsonb_typeof(p_value) <> 'string')
     or (v_field.field_type = 'NUMBER' and jsonb_typeof(p_value) <> 'number')
     or (v_field.field_type = 'BOOLEAN' and jsonb_typeof(p_value) <> 'boolean')
     or (v_field.field_type = 'MULTI_SELECT' and jsonb_typeof(p_value) <> 'array') then
    raise exception 'VALIDATION: Custom field value has the wrong type' using errcode = '22023';
  end if;
  if v_field.field_type = 'DATE' then
    begin perform trim(both '"' from p_value::text)::date; exception when others then raise exception 'VALIDATION: Invalid date value' using errcode = '22023'; end;
  elsif v_field.field_type = 'USER' then
    begin
      if not exists (select 1 from public.project_members pm where pm.project_id = v_field.project_id and pm.user_id = trim(both '"' from p_value::text)::uuid)
         and not exists (
           select 1 from public.projects p
           join public.organization_members om on om.organization_id = p.organization_id
          where p.id = v_field.project_id
            and om.user_id = trim(both '"' from p_value::text)::uuid
            and om.role in ('OWNER', 'ADMIN')
         ) then
        raise exception 'VALIDATION: User must be a project member or workspace owner/admin' using errcode = '22023';
      end if;
    exception when invalid_text_representation then raise exception 'VALIDATION: Invalid user value' using errcode = '22023';
    end;
  elsif v_field.field_type = 'SINGLE_SELECT' and not (v_field.config->'options' @> jsonb_build_array(trim(both '"' from p_value::text))) then
    raise exception 'VALIDATION: Invalid select option' using errcode = '22023';
  elsif v_field.field_type = 'MULTI_SELECT' then
    for v_item in select value from jsonb_array_elements(p_value) loop
      if jsonb_typeof(v_item) <> 'string' or not (v_field.config->'options' @> jsonb_build_array(trim(both '"' from v_item::text))) then
        raise exception 'VALIDATION: Invalid multi-select option' using errcode = '22023';
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.validate_custom_field_definition_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := nullif(trim(new.name), '');
  if new.name is null or char_length(new.name) > 80 then
    raise exception 'VALIDATION: Custom field name must be 1-80 characters' using errcode = '22023';
  end if;
  perform public.validate_custom_field_definition(new.field_type, coalesce(new.config, '{}'::jsonb));
  return new;
end;
$$;

drop trigger if exists validate_custom_field_definition on public.custom_fields;
create trigger validate_custom_field_definition
before insert or update on public.custom_fields
for each row execute function public.validate_custom_field_definition_trigger();

create or replace function public.update_custom_field(
  p_field_id uuid,
  p_name text,
  p_field_type text,
  p_config jsonb default '{}'::jsonb,
  p_is_required boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_field record;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_name is null or char_length(v_name) > 80 then raise exception 'VALIDATION: Custom field name must be 1-80 characters' using errcode = '22023'; end if;
  perform public.validate_custom_field_definition(p_field_type, p_config);
  select cf.*, p.is_archived into v_field from public.custom_fields cf join public.projects p on p.id = cf.project_id where cf.id = p_field_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_field.is_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if public.project_role(v_field.project_id) <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_field_type <> v_field.field_type and exists (select 1 from public.issue_custom_values where custom_field_id = p_field_id) then
    raise exception 'VALIDATION: Cannot change field type after values exist; clear values first' using errcode = '22023';
  end if;
  if p_field_type in ('SINGLE_SELECT', 'MULTI_SELECT') and exists (
    select 1 from public.issue_custom_values cv
    where cv.custom_field_id = p_field_id
      and ((p_field_type = 'SINGLE_SELECT' and jsonb_typeof(cv.value) = 'string' and not (coalesce(p_config, '{}'::jsonb)->'options' @> jsonb_build_array(trim(both '"' from cv.value::text))))
        or (p_field_type = 'MULTI_SELECT' and jsonb_typeof(cv.value) = 'array' and exists (select 1 from jsonb_array_elements_text(cv.value) item where not (coalesce(p_config, '{}'::jsonb)->'options' @> jsonb_build_array(item)))))
  ) then
    raise exception 'VALIDATION: Existing values use an option that would be removed' using errcode = '22023';
  end if;
  update public.custom_fields set name = v_name, field_type = p_field_type, config = coalesce(p_config, '{}'::jsonb), is_required = coalesce(p_is_required, false) where id = p_field_id;
end; $$;

create or replace function public.bulk_set_issue_custom_value(p_issue_ids uuid[], p_custom_field_id uuid, p_value jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_issue_id uuid; v_count integer := 0; v_project_id uuid; v_archived boolean; v_old_value jsonb; v_requested integer; v_locked integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_requested := coalesce(array_length(p_issue_ids, 1), 0);
  if v_requested = 0 or v_requested > 100 then raise exception 'VALIDATION: Select between 1 and 100 issues' using errcode = '22023'; end if;
  select project_id into v_project_id from public.custom_fields where id = p_custom_field_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived or public.project_role(v_project_id) not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_requested <> (select count(distinct issue_id) from unnest(p_issue_ids) as requested(issue_id)) then raise exception 'VALIDATION: Duplicate issue IDs are not allowed' using errcode = '22023'; end if;
  select count(*) into v_locked from public.issues i where i.id = any(p_issue_ids) and i.project_id = v_project_id and public.can_view_issue(i.id);
  if v_locked <> v_requested then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform 1 from public.issues i where i.id = any(p_issue_ids) and i.project_id = v_project_id order by i.id for update;
  perform public.validate_custom_field_value(p_custom_field_id, p_value);
  foreach v_issue_id in array p_issue_ids loop
    if not exists (select 1 from public.issues where id = v_issue_id and project_id = v_project_id and public.can_view_issue(id)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
    select value into v_old_value from public.issue_custom_values where issue_id = v_issue_id and custom_field_id = p_custom_field_id;
    if p_value is null or jsonb_typeof(p_value) = 'null' or p_value = '""'::jsonb or p_value = '[]'::jsonb then
      delete from public.issue_custom_values where issue_id = v_issue_id and custom_field_id = p_custom_field_id;
    else
      insert into public.issue_custom_values(issue_id, custom_field_id, value) values (v_issue_id, p_custom_field_id, p_value) on conflict (issue_id, custom_field_id) do update set value = excluded.value;
    end if;
    update public.issues set updated_at = now() where id = v_issue_id;
    insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
    values (v_issue_id, auth.uid(), 'CUSTOM_FIELD_UPDATED', 'custom_field', v_old_value, nullif(p_value, 'null'::jsonb), jsonb_build_object('custom_field_id', p_custom_field_id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;

create or replace function public.validate_issue_custom_value_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.validate_custom_field_value(new.custom_field_id, new.value);
  if not exists (select 1 from public.issues i join public.custom_fields cf on cf.project_id = i.project_id where i.id = new.issue_id and cf.id = new.custom_field_id) then
    raise exception 'VALIDATION: Custom field does not belong to this project' using errcode = '23503';
  end if;
  return new;
end; $$;

drop trigger if exists validate_issue_custom_value on public.issue_custom_values;
create trigger validate_issue_custom_value
before insert or update on public.issue_custom_values
for each row execute function public.validate_issue_custom_value_trigger();

create or replace function public.set_issue_custom_value(p_issue_id uuid, p_custom_field_id uuid, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_archived boolean; v_old_value jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if public.project_role(v_project_id) not in ('DEVELOPER', 'MAINTAINER') or not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if not exists (select 1 from public.custom_fields where id = p_custom_field_id and project_id = v_project_id) then raise exception 'VALIDATION: Custom field does not belong to this project' using errcode = '23503'; end if;
  perform public.validate_custom_field_value(p_custom_field_id, p_value);
  select value into v_old_value from public.issue_custom_values where issue_id = p_issue_id and custom_field_id = p_custom_field_id;
  if p_value is null or jsonb_typeof(p_value) = 'null' or p_value = '""'::jsonb or p_value = '[]'::jsonb then
    delete from public.issue_custom_values where issue_id = p_issue_id and custom_field_id = p_custom_field_id;
  else
    insert into public.issue_custom_values(issue_id, custom_field_id, value) values (p_issue_id, p_custom_field_id, p_value)
    on conflict (issue_id, custom_field_id) do update set value = excluded.value;
  end if;
  update public.issues set updated_at = now() where id = p_issue_id;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (p_issue_id, auth.uid(), 'CUSTOM_FIELD_UPDATED', 'custom_field', v_old_value, nullif(p_value, 'null'::jsonb), jsonb_build_object('custom_field_id', p_custom_field_id));
end; $$;

revoke execute on function public.validate_custom_field_definition(text, jsonb), public.validate_custom_field_value(uuid, jsonb), public.update_custom_field(uuid, text, text, jsonb, boolean), public.bulk_set_issue_custom_value(uuid[], uuid, jsonb) from public, anon;
revoke execute on function public.set_issue_custom_value(uuid, uuid, jsonb) from public, anon;
grant execute on function public.update_custom_field(uuid, text, text, jsonb, boolean), public.bulk_set_issue_custom_value(uuid[], uuid, jsonb), public.set_issue_custom_value(uuid, uuid, jsonb) to authenticated;
-- Migration 056: attachment upload/recovery hardening.
-- Keep validation in a trigger so RPC and any privileged maintenance path share
-- the same MIME and path contract.

create or replace function public.validate_attachment_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_mime text := lower(trim(coalesce(new.mime_type, '')));
begin
  if v_mime not in (
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
    'text/plain', 'text/csv', 'text/markdown', 'application/json',
    'application/pdf', 'application/zip', 'application/gzip',
    'application/x-tar'
  ) then
    raise exception 'VALIDATION: Unsupported attachment MIME type' using errcode = '22023';
  end if;
  if new.storage_path !~ '^[0-9a-fA-F-]{36}/[^/]{1,255}$' then
    raise exception 'VALIDATION: Invalid attachment storage path' using errcode = '22023';
  end if;
  if new.size_bytes < 0 or new.size_bytes > 52428800 then
    raise exception 'VALIDATION: File size must be between 0 and 50MB' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_attachment_metadata on public.attachments;
create trigger validate_attachment_metadata
before insert or update on public.attachments
for each row execute procedure public.validate_attachment_metadata();

-- Validate the actual Supabase Storage Content-Type metadata; absent metadata
-- is rejected so a client cannot claim an allowed MIME only in the DB row.
drop policy if exists "Members can upload issue attachments" on storage.objects;
create policy "Members can upload issue attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and public.can_view_issue(public.issue_id_from_storage_path(name))
    and public.can_comment_on_issue(public.issue_id_from_storage_path(name))
    and metadata is not null
    and lower(coalesce(metadata->>'mimetype', '')) in (
      'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
      'text/plain', 'text/csv', 'text/markdown', 'application/json',
      'application/pdf', 'application/zip', 'application/gzip', 'application/x-tar'
    )
  );

-- Service-role cleanup uses this allowlisted RPC to identify DB rows whose
-- object has disappeared. It never exposes issue metadata to browser clients.
create or replace function public.list_missing_attachment_objects()
returns table (attachment_id uuid, storage_path text)
language sql
security definer
set search_path = public
as $$
  select a.id, a.storage_path
  from public.attachments a
  where not exists (select 1 from storage.objects o where o.bucket_id = 'issue-attachments' and o.name = a.storage_path);
$$;

revoke execute on function public.list_missing_attachment_objects() from anon, authenticated, public;
grant execute on function public.list_missing_attachment_objects() to service_role;
-- Migration 057: API-token lifecycle and developer experience.
-- Tokens remain organization-scoped; API authorization additionally checks the
-- owner's live project memberships. No project restriction is invented here.

create or replace function public.validate_api_token_metadata()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION: Token hash must be a SHA-256 digest' using errcode = '22023';
  end if;
  if new.expires_at is not null and new.expires_at <= timezone('utc'::text, now()) then
    raise exception 'VALIDATION: Token expiration must be in the future' using errcode = '22023';
  end if;
  if new.scopes is null or cardinality(new.scopes) = 0 or not (new.scopes <@ array['read','write','projects:read','issues:read','issues:write','comments:write','milestones:read','search:read','integrations:read','github_links:read','github_links:write']::text[]) then
    raise exception 'VALIDATION: Invalid API token scopes' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_api_token_metadata on public.api_tokens;
create trigger validate_api_token_metadata before insert or update on public.api_tokens
for each row execute procedure public.validate_api_token_metadata();

create or replace function public.rotate_api_token(
  p_token_id uuid,
  p_token_hash text,
  p_expires_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_old record; v_new uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into v_old from public.api_tokens where id = p_token_id and user_id = v_user for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_org_member(v_old.organization_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.api_tokens(user_id, organization_id, name, token_hash, scopes, expires_at)
  values (v_user, v_old.organization_id, v_old.name, p_token_hash, v_old.scopes, p_expires_at)
  returning id into v_new;
  delete from public.api_tokens where id = p_token_id and user_id = v_user;
  return v_new;
end;
$$;

revoke execute on function public.rotate_api_token(uuid, text, timestamptz) from anon, public;
grant execute on function public.rotate_api_token(uuid, text, timestamptz) to authenticated;

create or replace function public.revoke_api_token(p_token_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_deleted integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  delete from public.api_tokens where id = p_token_id and user_id = v_user;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

revoke execute on function public.revoke_api_token(uuid) from anon, public;
grant execute on function public.revoke_api_token(uuid) to authenticated;
-- Phase 11: backend-authoritative, restricted-safe report metrics.
-- SECURITY DEFINER is used for complete aggregates; every issue-derived
-- expression therefore retains an explicit can_view_issue boundary.

create or replace function public.get_issue_reports(
  p_project_id uuid,
  p_window_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_window_days integer := coalesce(p_window_days, 30);
  v_now timestamptz := timezone('utc'::text, now());
  v_start timestamptz;
  v_start_day timestamptz;
  v_end_day timestamptz;
  v_visible_count bigint;
  v_window_count bigint;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_window_days not in (0, 7, 30, 90, 365) then
    raise exception 'VALIDATION: Unsupported report window' using errcode = '22023';
  end if;

  -- Keep the all-time series finite. PostgreSQL does not accept -infinity as
  -- a generate_series timestamp on every supported version.
  if v_window_days = 0 then
    select coalesce(min(i.created_at), v_now) into v_start
    from public.issues i
    where i.project_id = p_project_id and public.can_view_issue(i.id);
  else
    v_start := v_now - make_interval(days => v_window_days);
  end if;
  v_start_day := date_trunc('day', v_start);
  v_end_day := date_trunc('day', v_now);

  select count(*) into v_visible_count from public.issues i
  where i.project_id = p_project_id and public.can_view_issue(i.id);
  select count(*) into v_window_count from public.issues i
  where i.project_id = p_project_id and public.can_view_issue(i.id)
    and i.created_at >= v_start and i.created_at <= v_now;

  return (
    with resolution_events as (
      -- One latest qualifying resolution per visible issue in the window.
      -- This is the shared source for resolved counts, duration statistics,
      -- and the resolved drilldown/CSV.
      select distinct on (i.id)
        i.id,
        i.created_at as issue_created_at,
        e.created_at as resolution_at,
        extract(epoch from (e.created_at - i.created_at)) / 86400.0 as duration_days
      from public.issues i
      join public.issue_events e on e.issue_id = i.id
      left join public.workflow_states ns on ns.id::text = e.new_value #>> '{}'
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and upper(e.event_type) = 'STATUS_CHANGED'
        and lower(coalesce(e.metadata->>'new_category', ns.category)) in ('resolved', 'closed')
        and coalesce((select lower(coalesce(prev.metadata->>'new_category', ps.category))
          from public.issue_events prev
          left join public.workflow_states ps on ps.id::text = prev.new_value #>> '{}'
          where prev.issue_id = e.issue_id and upper(prev.event_type) = 'STATUS_CHANGED'
            and (prev.created_at, prev.id) < (e.created_at, e.id)
          order by prev.created_at desc, prev.id desc limit 1), 'open') not in ('resolved', 'closed')
        and e.created_at >= v_start and e.created_at <= v_now
        and e.created_at >= i.created_at
      order by i.id, e.created_at desc, e.id desc
    )
  select jsonb_build_object(
    'window_days', v_window_days,
    'window_start', v_start,
    'window_end', v_now,
    'visible_count', v_visible_count,
    'window_issue_count', v_window_count,
    'no_data', (v_visible_count = 0),
    'created', (select count(*) from public.issues i
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now),
    -- Count issues entering a terminal state from a non-terminal state. The
    -- issue timestamp is intentionally not authoritative here: reopening an
    -- issue clears it, while the immutable status history preserves every
    -- resolution cycle.
    'resolved', (select count(*) from resolution_events),
    'backlog', (select count(*) from public.issues i
      join public.workflow_states s on s.id = i.status_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and s.category not in ('RESOLVED', 'CLOSED')),

    'resolution_duration', (select jsonb_build_object(
      'count', count(*)::integer,
      'avg_days', round((avg(r.duration_days))::numeric, 1),
      'median_days', round((percentile_cont(0.5) within group (order by r.duration_days))::numeric, 1),
      'p90_days', round((percentile_cont(0.9) within group (order by r.duration_days))::numeric, 1)
    ) from resolution_events r),
    'avg_resolution_days', (select round((avg(r.duration_days))::numeric, 1) from resolution_events r),

    'category_counts', coalesce((select jsonb_object_agg(x.category, x.total) from (
      select s.category, count(*)::integer as total from public.issues i
      join public.workflow_states s on s.id = i.status_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now group by s.category
    ) x), '{}'::jsonb),
    'priority_counts', coalesce((select jsonb_object_agg(x.priority, x.total) from (
      select i.priority, count(*)::integer as total from public.issues i
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now group by i.priority
    ) x), '{}'::jsonb),
    'component_counts', coalesce((select jsonb_agg(jsonb_build_object('id', x.component_id, 'name', x.component_name, 'count', x.total) order by x.total desc, x.component_name) from (
      select coalesce(c.id::text, '') as component_id, coalesce(c.name, 'Unassigned component') as component_name, count(*)::integer as total
      from public.issues i left join public.components c on c.id = i.component_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now group by c.id, c.name
    ) x), '[]'::jsonb),
    'by_assignee', coalesce((select jsonb_agg(jsonb_build_object('id', x.assignee_id, 'name', x.assignee_name, 'count', x.total) order by x.total desc, x.assignee_name) from (
      select coalesce(i.assignee_id::text, '') as assignee_id, coalesce(nullif(p.display_name, ''), 'Unassigned') as assignee_name, count(*)::integer as total
      from public.issues i left join public.profiles p on p.id = i.assignee_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now group by i.assignee_id, p.display_name
    ) x), '[]'::jsonb),
    'by_milestone', coalesce((select jsonb_agg(jsonb_build_object('id', x.milestone_id, 'name', x.milestone_name, 'count', x.total) order by x.total desc, x.milestone_name) from (
      select coalesce(m.id::text, '') as milestone_id, coalesce(m.name, 'No milestone') as milestone_name, count(*)::integer as total
      from public.issues i left join public.milestones m on m.id = i.target_milestone_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now group by m.id, m.name
    ) x), '[]'::jsonb),

    -- Reconstruct historical status from immutable events; current status
    -- alone loses the active interval when an issue is later reopened.
    'historical_trend', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'created', x.created, 'resolved', x.resolved, 'backlog', x.backlog) order by x.day) from (
      with days as (
        select d as day from generate_series(v_start_day, v_end_day, interval '1 day') d
      ), visible as (
        select i.id, i.created_at, i.resolved_at, i.closed_at, s.category as current_category
        from public.issues i join public.workflow_states s on s.id = i.status_id
        where i.project_id = p_project_id and public.can_view_issue(i.id)
      ), state_at_day as (
        select d.day, v.id,
          coalesce(
            (select lower(coalesce(e.metadata->>'new_category', ns.category))
             from public.issue_events e
             left join public.workflow_states ns on ns.id::text = e.new_value #>> '{}'
             where e.issue_id = v.id and upper(e.event_type) = 'STATUS_CHANGED' and e.created_at < d.day + interval '1 day'
             order by e.created_at desc, e.id desc limit 1),
            (select lower(os.category)
             from public.issue_events e
             join public.workflow_states os on os.id::text = e.old_value #>> '{}'
             where e.issue_id = v.id and upper(e.event_type) = 'STATUS_CHANGED'
             order by e.created_at asc, e.id asc limit 1),
            lower(v.current_category)
          ) as category
        from days d cross join visible v
        where v.created_at < d.day + interval '1 day'
      )
      select d.day::date as day,
        (select count(*)::integer from visible v where v.created_at >= d.day and v.created_at < d.day + interval '1 day') as created,
        (select count(*)::integer
         from public.issue_events e
         join visible v on v.id = e.issue_id
         left join public.workflow_states ns on ns.id::text = e.new_value #>> '{}'
         where upper(e.event_type) = 'STATUS_CHANGED'
           and lower(coalesce(e.metadata->>'new_category', ns.category)) in ('resolved', 'closed')
           and coalesce((select lower(coalesce(prev.metadata->>'new_category', ps.category))
             from public.issue_events prev
             left join public.workflow_states ps on ps.id::text = prev.new_value #>> '{}'
             where prev.issue_id = e.issue_id and upper(prev.event_type) = 'STATUS_CHANGED'
               and (prev.created_at, prev.id) < (e.created_at, e.id)
             order by prev.created_at desc, prev.id desc limit 1), 'open') not in ('resolved', 'closed')
           and e.created_at >= d.day and e.created_at < d.day + interval '1 day') as resolved,
        (select count(*)::integer from state_at_day s where s.day = d.day and s.category not in ('resolved', 'closed')) as backlog
      from days d
    ) x), '[]'::jsonb),

    'drilldown', coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'issue_number', x.issue_number, 'title', x.title, 'type', x.type,
      'priority', x.priority, 'severity', x.severity, 'status', x.status_name,
      'status_category', x.status_category, 'component_name', x.component_name,
      'assignee_id', x.assignee_id, 'assignee_name', x.assignee_name,
      'milestone_id', x.milestone_id, 'milestone_name', x.milestone_name,
      'created_at', x.created_at, 'resolved_at', x.resolved_at, 'closed_at', x.closed_at
    ) order by x.updated_at desc, x.issue_number desc) from (
      select i.id, i.issue_number, i.title, i.type, i.priority, i.severity,
        s.name as status_name, s.category as status_category, c.name as component_name,
        i.assignee_id, nullif(trim(coalesce(p.display_name, '')), '') as assignee_name,
        i.target_milestone_id as milestone_id, m.name as milestone_name, i.created_at,
        i.resolved_at, i.closed_at, i.updated_at
      from public.issues i join public.workflow_states s on s.id = i.status_id
      left join public.components c on c.id = i.component_id
      left join public.profiles p on p.id = i.assignee_id
      left join public.milestones m on m.id = i.target_milestone_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and s.category not in ('RESOLVED', 'CLOSED')
      order by i.updated_at desc, i.issue_number desc limit 200
    ) x), '[]'::jsonb),
      'drilldowns', jsonb_build_object(
      'created', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.issue_number desc) from (
        select i.id, i.issue_number, i.title, i.type, i.priority, i.severity, s.name as status_name, s.category as status_category, c.name as component_name, i.assignee_id, nullif(trim(coalesce(p.display_name, '')), '') as assignee_name, i.target_milestone_id as milestone_id, m.name as milestone_name, i.created_at, i.resolved_at, i.closed_at
        from public.issues i join public.workflow_states s on s.id = i.status_id
        left join public.components c on c.id = i.component_id
        left join public.profiles p on p.id = i.assignee_id
        left join public.milestones m on m.id = i.target_milestone_id
        where i.project_id = p_project_id and public.can_view_issue(i.id) and i.created_at >= v_start and i.created_at <= v_now
        order by i.created_at desc, i.issue_number desc limit 200
      ) x), '[]'::jsonb),
      'resolved', coalesce((select jsonb_agg(to_jsonb(x) order by x.resolution_at desc, x.issue_number desc) from (
        select i.id, i.issue_number, i.title, i.type, i.priority, i.severity, s.name as status_name, s.category as status_category, c.name as component_name, i.assignee_id, nullif(trim(coalesce(p.display_name, '')), '') as assignee_name, i.target_milestone_id as milestone_id, m.name as milestone_name, i.created_at, r.resolution_at as resolved_at, i.closed_at, round((extract(epoch from (r.resolution_at - i.created_at)) / 86400.0)::numeric, 1) as resolution_days
        from public.issues i join public.workflow_states s on s.id = i.status_id
        left join public.components c on c.id = i.component_id
        left join public.profiles p on p.id = i.assignee_id
        left join public.milestones m on m.id = i.target_milestone_id
        join resolution_events r on r.id = i.id
        where i.project_id = p_project_id and public.can_view_issue(i.id)
        order by r.resolution_at desc, i.issue_number desc limit 200
      ) x), '[]'::jsonb),
      'backlog', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc, x.issue_number desc) from (
        select i.id, i.issue_number, i.title, i.type, i.priority, i.severity, s.name as status_name, s.category as status_category, c.name as component_name, i.assignee_id, nullif(trim(coalesce(p.display_name, '')), '') as assignee_name, i.target_milestone_id as milestone_id, m.name as milestone_name, i.created_at, i.resolved_at, i.closed_at, i.updated_at
        from public.issues i join public.workflow_states s on s.id = i.status_id
        left join public.components c on c.id = i.component_id
        left join public.profiles p on p.id = i.assignee_id
        left join public.milestones m on m.id = i.target_milestone_id
        where i.project_id = p_project_id and public.can_view_issue(i.id) and s.category not in ('RESOLVED', 'CLOSED')
        order by i.updated_at desc, i.issue_number desc limit 200
      ) x), '[]'::jsonb)
    )
  ));
end;
$$;

revoke execute on function public.get_issue_reports(uuid, integer) from anon, public;
grant execute on function public.get_issue_reports(uuid, integer) to authenticated;
-- Phase 11: authoritative, visibility-safe release-readiness scoring and history.
-- Scores are calculated in SQL so every client sees the same rubric. Restricted
-- issues are included only when can_view_issue() permits the current caller.
-- Snapshots retain the caller-specific aggregate, so history is creator-only.

create table if not exists public.release_readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  milestone_id uuid references public.milestones(id) on delete set null,
  version_id uuid references public.versions(id) on delete set null,
  score integer not null check (score between 0 and 100),
  status text not null check (status in ('READY', 'ATTENTION', 'BLOCKED', 'NO_DATA')),
  breakdown jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists release_readiness_snapshots_project_idx
  on public.release_readiness_snapshots(project_id, created_at desc, id desc);
create index if not exists release_readiness_snapshots_creator_idx
  on public.release_readiness_snapshots(project_id, created_by, created_at desc, id desc);

alter table public.release_readiness_snapshots enable row level security;
drop policy if exists "Project members can read readiness snapshots" on public.release_readiness_snapshots;
drop policy if exists "Creators can read their readiness snapshots" on public.release_readiness_snapshots;
create policy "Creators can read their readiness snapshots"
  on public.release_readiness_snapshots for select to authenticated
  using (created_by = auth.uid() and public.is_project_member(project_id));

revoke all on public.release_readiness_snapshots from anon, authenticated, public;

create or replace function public.prevent_release_readiness_snapshot_mutation()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('tracebox.release_readiness_snapshot_write', true), '') <> 'on' then
      raise exception 'READINESS_SNAPSHOT_RPC_ONLY' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'READINESS_SNAPSHOT_IMMUTABLE' using errcode = '42501';
end;
$$;

drop trigger if exists release_readiness_snapshots_immutable on public.release_readiness_snapshots;
create trigger release_readiness_snapshots_immutable
before insert or update or delete on public.release_readiness_snapshots
for each row execute procedure public.prevent_release_readiness_snapshot_mutation();
revoke execute on function public.prevent_release_readiness_snapshot_mutation() from public, anon, authenticated;

create or replace function public.calculate_release_readiness(
  p_project_id uuid, p_milestone_id uuid default null, p_version_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_archived boolean; v_score integer;
  v_total integer; v_resolved integer; v_open integer; v_blockers integer;
  v_criticals integer; v_regressions integer; v_unassigned integer;
  v_security integer; v_overdue integer; v_result jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = p_project_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if public.project_role(p_project_id) is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_milestone_id is not null and not exists (
    select 1 from public.milestones m where m.id = p_milestone_id and m.project_id = p_project_id
  ) then raise exception 'VALIDATION: Milestone does not belong to project' using errcode = '22023'; end if;
  if p_version_id is not null and not exists (
    select 1 from public.versions v where v.id = p_version_id and v.project_id = p_project_id
  ) then raise exception 'VALIDATION: Version does not belong to project' using errcode = '22023'; end if;

  -- This CTE is the privacy boundary for every count and factor.
  with visible as (
    select i.id, i.target_milestone_id, i.assignee_id, i.type, i.priority, i.severity,
           ws.category as status_category, m.due_at
      from public.issues i
      join public.workflow_states ws on ws.id = i.status_id
      left join public.milestones m on m.id = i.target_milestone_id
     where i.project_id = p_project_id and public.can_view_issue(i.id)
       and (p_milestone_id is null or i.target_milestone_id = p_milestone_id)
       and (p_version_id is null or i.affected_version_id = p_version_id)
  )
  select count(*)::integer,
         count(*) filter (where status_category in ('RESOLVED', 'CLOSED'))::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED'))::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED') and (priority = 'P0' or severity = 'BLOCKER'))::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED') and (priority = 'P1' or severity = 'CRITICAL') and not (priority = 'P0' or severity = 'BLOCKER'))::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED') and type = 'REGRESSION')::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED') and assignee_id is null)::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED') and type = 'SECURITY')::integer,
         count(distinct target_milestone_id) filter (where status_category not in ('RESOLVED', 'CLOSED') and target_milestone_id is not null and due_at is not null and due_at < timezone('utc'::text, now()))::integer
    into v_total, v_resolved, v_open, v_blockers, v_criticals, v_regressions, v_unassigned, v_security, v_overdue
    from visible;

  if v_total = 0 then v_score := 0;
  else v_score := greatest(0, least(100,
    round((v_resolved::numeric / v_total::numeric) * 100)::integer
    - v_blockers * 25 - v_criticals * 10 - v_regressions * 15
    - v_unassigned * 5 - v_security * 10 - v_overdue * 5));
  end if;

  v_result := jsonb_build_object(
    'total', v_total, 'resolved_count', v_resolved, 'open_count', v_open,
    'blocker_count', v_blockers, 'critical_count', v_criticals,
    'regression_count', v_regressions, 'unassigned_count', v_unassigned,
    'unresolved_security_count', v_security, 'overdue_milestone_count', v_overdue,
    'score', v_score,
    'status', case when v_total = 0 then 'NO_DATA'
      when v_blockers > 0 or v_score < 60 then 'BLOCKED'
      when v_criticals > 0 or v_regressions > 0 or v_security > 0 or v_overdue > 0 or v_score < 85 then 'ATTENTION'
      else 'READY' end,
    'issues', '[]'::jsonb
  );

  -- Drilldowns are current-caller visible rows only and are never persisted.
  with visible as (
    select i.id, i.issue_number, i.title, i.type, i.priority, i.severity,
           i.assignee_id, i.target_milestone_id, i.affected_version_id,
           ws.category as status_category, ws.name as status_name, c.name as component_name,
           m.due_at
      from public.issues i
      join public.workflow_states ws on ws.id = i.status_id
      left join public.components c on c.id = i.component_id
      left join public.milestones m on m.id = i.target_milestone_id
     where i.project_id = p_project_id and public.can_view_issue(i.id)
       and (p_milestone_id is null or i.target_milestone_id = p_milestone_id)
       and (p_version_id is null or i.affected_version_id = p_version_id)
       and ws.category not in ('RESOLVED', 'CLOSED')
  )
  select v_result || jsonb_build_object('issues', coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'issueNumber', issue_number, 'title', title, 'type', type,
    'priority', priority, 'severity', severity, 'statusCategory', status_category,
    'statusName', status_name, 'assigneeId', assignee_id, 'componentName', component_name,
    'targetMilestoneId', target_milestone_id, 'affectedVersionId', affected_version_id,
    'dueAt', due_at
  ) order by issue_number), '[]'::jsonb)) into v_result
  from visible;
  return v_result;
end;
$$;

create or replace function public.save_release_readiness_snapshot(
  p_project_id uuid, p_milestone_id uuid default null, p_version_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_analysis jsonb; v_id uuid; v_archived boolean;
begin
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_analysis := public.calculate_release_readiness(p_project_id, p_milestone_id, p_version_id);
  perform set_config('tracebox.release_readiness_snapshot_write', 'on', true);
  insert into public.release_readiness_snapshots(project_id, milestone_id, version_id, score, status, breakdown, created_by)
  values (p_project_id, p_milestone_id, p_version_id, (v_analysis->>'score')::integer,
          v_analysis->>'status', v_analysis - 'issues', auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.list_release_readiness_snapshots(
  p_project_id uuid, p_milestone_id uuid default null, p_version_id uuid default null,
  p_limit integer default 30
)
returns table (id uuid, milestone_id uuid, version_id uuid, score integer, status text,
  breakdown jsonb, created_by uuid, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if public.project_role(p_project_id) is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_milestone_id is not null and not exists (
    select 1 from public.milestones m where m.id = p_milestone_id and m.project_id = p_project_id
  ) then raise exception 'VALIDATION: Milestone does not belong to project' using errcode = '22023'; end if;
  if p_version_id is not null and not exists (
    select 1 from public.versions v where v.id = p_version_id and v.project_id = p_project_id
  ) then raise exception 'VALIDATION: Version does not belong to project' using errcode = '22023'; end if;
  return query select s.id, s.milestone_id, s.version_id, s.score, s.status,
    s.breakdown, s.created_by, s.created_at
    from public.release_readiness_snapshots s where s.project_id = p_project_id
      and s.created_by = auth.uid()
      and (p_milestone_id is null or s.milestone_id = p_milestone_id)
      and (p_version_id is null or s.version_id = p_version_id)
    order by s.created_at desc, s.id desc limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

revoke execute on function public.calculate_release_readiness(uuid, uuid, uuid), public.save_release_readiness_snapshot(uuid, uuid, uuid), public.list_release_readiness_snapshots(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.calculate_release_readiness(uuid, uuid, uuid), public.save_release_readiness_snapshot(uuid, uuid, uuid), public.list_release_readiness_snapshots(uuid, uuid, uuid, integer) to authenticated;
-- Migration 060: authoritative restricted-safe dashboard metrics.
-- All operational cards use one visibility-filtered aggregate so the counts
-- cannot drift from one another or count resolved/restricted work differently.
create or replace function public.get_dashboard_metrics(p_project_id uuid)
returns table (assigned_to_me bigint, awaiting_triage bigint, due_milestones bigint, open_count bigint, in_progress_count bigint, critical_count bigint, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.is_project_member(p_project_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select
    count(*) filter (where i.assignee_id = v_user and ws.category not in ('RESOLVED', 'CLOSED')),
    count(*) filter (where ws.category = 'TRIAGE'),
    count(*) filter (where m.due_at < timezone('utc'::text, now())
      and m.status in ('PLANNED', 'ACTIVE')
      and ws.category not in ('RESOLVED', 'CLOSED')),
    count(*) filter (where ws.category in ('TRIAGE', 'OPEN')),
    count(*) filter (where ws.category in ('IN_PROGRESS', 'REVIEW')),
    count(*) filter (where i.severity in ('BLOCKER', 'CRITICAL')
      and ws.category not in ('RESOLVED', 'CLOSED')),
    count(*)
  from public.issues i
  join public.workflow_states ws on ws.id = i.status_id and ws.project_id = i.project_id
  left join public.milestones m on m.id = i.target_milestone_id and m.project_id = i.project_id
  where i.project_id = p_project_id and public.can_view_issue(i.id);
end;
$$;
revoke execute on function public.get_dashboard_metrics(uuid) from anon, public;
grant execute on function public.get_dashboard_metrics(uuid) to authenticated;
-- Migration 061: read-only, restricted-safe project audit explorer.
-- Issue events are the canonical immutable audit stream. The redaction helper
-- recursively removes cross-issue references from values written by link and
-- duplicate workflows, so a visible event can never disclose an inaccessible
-- canonical issue through its JSON payload.
create or replace function public.redact_audit_json(p_value jsonb)
returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare v_key text; v_item jsonb; v_result jsonb := '{}'::jsonb;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_item in select * from jsonb_each(p_value) loop
      if lower(v_key) in ('target_id', 'target_issue', 'target_issue_id', 'source_issue', 'source_issue_id', 'canonical_issue_id', 'canonical_issue_number', 'canonical_issue_key', 'duplicate_issue_id', 'duplicate_issue_key', 'resolved_issue_id', 'resolved_issue_key', 'target_key', 'source_key')
        or right(lower(v_key), 9) = '_issue_id'
        or right(lower(v_key), 10) = '_issue_key'
        or right(lower(v_key), 13) = '_issue_number' then
        v_result := v_result || jsonb_build_object(v_key, '[redacted]');
      else
        v_result := v_result || jsonb_build_object(v_key, public.redact_audit_json(v_item));
      end if;
    end loop;
    return v_result;
  elsif jsonb_typeof(p_value) = 'array' then
    return coalesce((select jsonb_agg(public.redact_audit_json(value)) from jsonb_array_elements(p_value)), '[]'::jsonb);
  end if;
  return p_value;
end;
$$;

revoke execute on function public.redact_audit_json(jsonb) from anon, authenticated, public;

create or replace function public.list_project_audit_events(
  p_project_id uuid, p_limit integer default 50, p_offset integer default 0,
  p_actor_id uuid default null, p_event_type text default null,
  p_issue_id uuid default null, p_from timestamptz default null, p_to timestamptz default null
)
returns table (id uuid, issue_id uuid, actor_id uuid, event_type text, field_name text, old_value jsonb, new_value jsonb, metadata jsonb, created_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100)); v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_user is null or not public.is_project_member(p_project_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'VALIDATION: Invalid audit date range' using errcode = '22023';
  end if;

  return query
  select e.id, e.issue_id, e.actor_id, e.event_type, e.field_name,
    case when lower(coalesce(e.field_name, '')) = 'issue_link' then to_jsonb('[redacted]'::text) else public.redact_audit_json(e.old_value) end,
    case when lower(coalesce(e.field_name, '')) = 'issue_link' then to_jsonb('[redacted]'::text) else public.redact_audit_json(e.new_value) end,
    public.redact_audit_json(e.metadata), e.created_at, count(*) over ()
  from public.issue_events e
  join public.issues i on i.id = e.issue_id and i.project_id = p_project_id
  where public.can_view_issue(i.id)
    and (p_actor_id is null or e.actor_id = p_actor_id)
    and (p_event_type is null or e.event_type = nullif(trim(p_event_type), ''))
    and (p_issue_id is null or e.issue_id = p_issue_id)
    and (p_from is null or e.created_at >= p_from)
    and (p_to is null or e.created_at < p_to)
  order by e.created_at desc, e.id desc
  limit v_limit offset v_offset;
end;
$$;
revoke execute on function public.list_project_audit_events(uuid, integer, integer, uuid, text, uuid, timestamptz, timestamptz) from anon, public;
grant execute on function public.list_project_audit_events(uuid, integer, integer, uuid, text, uuid, timestamptz, timestamptz) to authenticated;
-- Phase 12: stable comment mentions.
--
-- Mention recipients are selected by identity, not inferred from arbitrary
-- text. The relation keeps the exact display label used when the comment was
-- last saved, while user_id remains the durable identity for notifications.

create table if not exists public.comment_mentions (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  display_label text not null check (char_length(display_label) between 1 and 120),
  mention_token text not null check (char_length(mention_token) between 1 and 120),
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (comment_id, user_id)
);

comment on table public.comment_mentions is 'Stable comment mention identities; writes go through comment RPCs.';
comment on column public.comment_mentions.display_label is 'Exact profile display label rendered when the mention was saved.';
comment on column public.comment_mentions.mention_token is 'Canonical server-normalized token stored in the comment body.';

-- Keep the compact textarea token deterministic and Unicode-aware. The UI may
-- render this value as @<mention_token>; the relation still stores the exact
-- display label separately for history and accessible labels.
create or replace function public.normalize_mention_token(p_display_label text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(
      regexp_replace(
        regexp_replace(lower(trim(coalesce(p_display_label, ''))), '[[:space:]]+', '-', 'g'),
        '[^[:alnum:]_.-]', '', 'g'
      ),
      ''
    ),
    'member'
  )
$$;

revoke execute on function public.normalize_mention_token(text) from public, anon, authenticated;

create index if not exists comment_mentions_user_idx
  on public.comment_mentions (user_id, comment_id);

alter table public.comment_mentions enable row level security;

create policy "Users can read visible comment mentions"
  on public.comment_mentions
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.comments c
       where c.id = comment_id
         and public.can_view_issue(c.issue_id)
    )
  );

-- Mention rows are not directly writable through the Data API. The RPCs below
-- validate every selected identity and maintain the relation atomically with
-- the comment and its audit event.
revoke insert, update, delete on public.comment_mentions from anon, authenticated, public;
grant select on public.comment_mentions to authenticated;

-- A project-aware, restricted-safe identity lookup for mention autocomplete.
-- Project members and workspace owners/admins are included. When an issue is
-- supplied, candidates must also be able to view that issue.
create or replace function public.list_project_mention_candidates(
  p_project_id uuid,
  p_query text default null,
  p_limit integer default 10,
  p_issue_id uuid default null
)
returns table (user_id uuid, display_label text, mention_token text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := left(trim(coalesce(p_query, '')), 80);
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.projects p
     where p.id = p_project_id and not p.is_archived
  ) or not public.is_project_member(p_project_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_issue_id is not null and not exists (
    select 1 from public.issues i
     where i.id = p_issue_id and i.project_id = p_project_id
       and public.can_view_issue(i.id)
  ) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select p.id, p.display_name, public.normalize_mention_token(p.display_name)
    from public.profiles p
   where nullif(trim(p.display_name), '') is not null
     and (
       exists (
         select 1 from public.project_members pm
          where pm.project_id = p_project_id and pm.user_id = p.id
       )
       or exists (
         select 1
           from public.projects pr
           join public.organizations o on o.id = pr.organization_id
           left join public.organization_members om
             on om.organization_id = o.id and om.user_id = p.id
          where pr.id = p_project_id
            and (o.owner_id = p.id or om.role in ('OWNER', 'ADMIN'))
       )
     )
     and (p_issue_id is null or public.notification_recipient_can_view_issue(p.id, p_issue_id))
     and (v_query = '' or position(lower(v_query) in lower(p.display_name)) > 0)
   order by lower(p.display_name), p.id
   limit v_limit;
end;
$$;

revoke execute on function public.list_project_mention_candidates(uuid, text, integer, uuid) from public, anon;
grant execute on function public.list_project_mention_candidates(uuid, text, integer, uuid) to authenticated;

create or replace function public.add_comment_with_mentions(
  p_issue_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[] default null
)
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
  v_ids uuid[] := coalesce(p_mentioned_user_ids, '{}'::uuid[]);
  v_mention record;
  v_identity_count integer;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null or char_length(v_body) > 10000 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_ids) as selected(user_id) where selected.user_id is null) then
    raise exception 'VALIDATION: Too many or invalid mention recipients' using errcode = '22023';
  end if;
  select coalesce(array_agg(selected.user_id order by selected.user_id), '{}'::uuid[])
    into v_ids
    from (select distinct user_id from unnest(v_ids) as selected(user_id)) selected;
  if cardinality(v_ids) > 20 then
    raise exception 'VALIDATION: Too many or invalid mention recipients' using errcode = '22023';
  end if;

  select i.project_id into v_project_id
    from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select p.is_archived into v_archived
    from public.projects p where p.id = v_project_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER')
     or not public.can_view_issue(p_issue_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select count(*) into v_identity_count
    from public.profiles p where p.id = any(v_ids);
  if v_identity_count <> cardinality(v_ids) then
    raise exception 'VALIDATION: Mention recipient was not found' using errcode = '22023';
  end if;
  for v_mention in
    select p.id, p.display_name
      from public.profiles p
     where p.id = any(v_ids)
     order by p.id
  loop
    if nullif(trim(v_mention.display_name), '') is null then
      raise exception 'VALIDATION: Mention recipient has no display label' using errcode = '22023';
    end if;
    if not public.notification_recipient_can_view_issue(v_mention.id, p_issue_id) then
      raise exception 'VALIDATION: Mention recipient is not authorized for this issue' using errcode = '22023';
    end if;
    if position('@' || public.normalize_mention_token(v_mention.display_name) in lower(v_body)) = 0 then
      raise exception 'VALIDATION: Comment must visibly include every selected mention' using errcode = '22023';
    end if;
  end loop;

  insert into public.comments (issue_id, author_id, body)
  values (p_issue_id, v_user, v_body)
  returning id into v_comment_id;

  insert into public.comment_mentions (comment_id, user_id, display_label, mention_token)
  select v_comment_id, p.id, p.display_name, public.normalize_mention_token(p.display_name)
    from public.profiles p where p.id = any(v_ids);

  update public.issues
     set updated_at = timezone('utc'::text, now())
   where id = p_issue_id;
  insert into public.issue_events (issue_id, actor_id, event_type, metadata)
  values (
    p_issue_id,
    v_user,
    'COMMENT_ADDED',
    jsonb_build_object('comment_id', v_comment_id, 'excerpt', left(v_body, 200))
  );

  -- The dispatcher performs preference and restricted-visibility checks. Only
  -- rows inserted by this transaction are notified; text alone never is.
  for v_mention in
    select cm.user_id, cm.display_label, i.issue_number, i.title
      from public.comment_mentions cm
      join public.issues i on i.id = p_issue_id
     where cm.comment_id = v_comment_id
  loop
    perform public.dispatch_issue_notification(
      v_mention.user_id,
      v_user,
      p_issue_id,
      'MENTION',
      jsonb_build_object(
        'issue_number', v_mention.issue_number,
        'title', v_mention.title,
        'excerpt', left(v_body, 140),
        'mention_label', v_mention.display_label
      )
    );
  end loop;
  return v_comment_id;
end;
$$;

create or replace function public.edit_comment_with_mentions(
  p_comment_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[] default null
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
  v_body text;
  v_old record;
  v_ids uuid[];
  v_old_ids uuid[];
  v_added_ids uuid[];
  v_identity_count integer;
  v_ids_same boolean;
  v_body_changed boolean;
  v_existing_label text;
  v_mention record;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null or char_length(v_body) > 10000 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  select c.id, c.issue_id, c.author_id, c.body into v_old
    from public.comments c where c.id = p_comment_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select i.project_id into v_project_id
    from public.issues i where i.id = v_old.issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select p.is_archived into v_archived
    from public.projects p where p.id = v_project_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_view_issue(v_old.issue_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_old.author_id <> v_user then
    v_role := public.project_role(v_project_id);
    if v_role not in ('DEVELOPER', 'MAINTAINER') then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  elsif public.project_role(v_project_id) not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock and refresh the comment after the project lock for a consistent
  -- projects -> comments ordering and conflict-safe edits.
  select c.id, c.issue_id, c.author_id, c.body into v_old
    from public.comments c where c.id = p_comment_id for update;
  select coalesce(array_agg(cm.user_id order by cm.user_id), '{}'::uuid[])
    into v_old_ids
    from public.comment_mentions cm where cm.comment_id = p_comment_id;
  if p_mentioned_user_ids is null then
    v_ids := v_old_ids;
  else
    if exists (select 1 from unnest(p_mentioned_user_ids) as selected(user_id) where selected.user_id is null) then
      raise exception 'VALIDATION: Too many or invalid mention recipients' using errcode = '22023';
    end if;
    select coalesce(array_agg(selected.user_id order by selected.user_id), '{}'::uuid[])
      into v_ids
      from (select distinct user_id from unnest(p_mentioned_user_ids) as selected(user_id)) selected;
    if cardinality(v_ids) > 20 then
      raise exception 'VALIDATION: Too many or invalid mention recipients' using errcode = '22023';
    end if;
  end if;
  v_ids_same := v_ids = v_old_ids;
  v_body_changed := v_body is distinct from v_old.body;

  select count(*) into v_identity_count
    from public.profiles p where p.id = any(v_ids);
  if v_identity_count <> cardinality(v_ids) then
    raise exception 'VALIDATION: Mention recipient was not found' using errcode = '22023';
  end if;
  for v_mention in
    select p.id, p.display_name from public.profiles p
     where p.id = any(v_ids) order by p.id
  loop
    if nullif(trim(v_mention.display_name), '') is null then
      raise exception 'VALIDATION: Mention recipient has no display label' using errcode = '22023';
    end if;
    if not public.notification_recipient_can_view_issue(v_mention.id, v_old.issue_id) then
      raise exception 'VALIDATION: Mention recipient is not authorized for this issue' using errcode = '22023';
    end if;
    -- A profile rename may leave the old token in an existing comment. It is
    -- still a visible selected mention; retain that row and refresh its copied
    -- label below instead of forcing an edit to fail.
    v_existing_label := null;
    select cm.display_label into v_existing_label
      from public.comment_mentions cm
     where cm.comment_id = p_comment_id and cm.user_id = v_mention.id;
    if position('@' || public.normalize_mention_token(v_mention.display_name) in lower(v_body)) = 0
       and (v_existing_label is null or position('@' || public.normalize_mention_token(v_existing_label) in lower(v_body)) = 0) then
      raise exception 'VALIDATION: Comment must visibly include every selected mention' using errcode = '22023';
    end if;
  end loop;

  select coalesce(array_agg(selected.user_id order by selected.user_id), '{}'::uuid[])
    into v_added_ids
    from (
      select user_id from unnest(v_ids) as selected(user_id)
      except
      select user_id from unnest(v_old_ids) as existing(user_id)
    ) selected;

  if not v_ids_same then
    delete from public.comment_mentions cm
     where cm.comment_id = p_comment_id and not (cm.user_id = any(v_ids));
    insert into public.comment_mentions (comment_id, user_id, display_label, mention_token)
    select p_comment_id, p.id, p.display_name, public.normalize_mention_token(p.display_name)
      from public.profiles p
     where p.id = any(v_ids)
       and not exists (
         select 1 from public.comment_mentions cm
          where cm.comment_id = p_comment_id and cm.user_id = p.id
       );
  end if;
  -- Keep existing row identity (and therefore notification history) while
  -- refreshing the copied label if a profile was renamed.
  update public.comment_mentions cm
     set display_label = p.display_name,
         mention_token = public.normalize_mention_token(p.display_name)
    from public.profiles p
   where cm.comment_id = p_comment_id
     and cm.user_id = p.id
     and (cm.display_label is distinct from p.display_name
       or cm.mention_token is distinct from public.normalize_mention_token(p.display_name));

  if not v_body_changed and v_ids_same then
    return;
  end if;
  update public.comments
     set body = v_body,
         edited_at = case when v_body_changed then timezone('utc'::text, now()) else edited_at end
   where id = p_comment_id;
  update public.issues
     set updated_at = timezone('utc'::text, now())
   where id = v_old.issue_id;
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

  -- v_added_ids was computed before relation changes, so unchanged mentions
  -- never receive duplicate notifications on edit.
  for v_mention in
    select cm.user_id, cm.display_label, i.issue_number, i.title
      from public.comment_mentions cm
      join public.issues i on i.id = v_old.issue_id
      where cm.comment_id = p_comment_id and cm.user_id = any(v_added_ids)
  loop
    perform public.dispatch_issue_notification(
      v_mention.user_id,
      v_user,
      v_old.issue_id,
      'MENTION',
      jsonb_build_object(
        'issue_number', v_mention.issue_number,
        'title', v_mention.title,
        'excerpt', left(v_body, 140),
        'mention_label', v_mention.display_label
      )
    );
  end loop;
end;
$$;

revoke execute on function public.add_comment_with_mentions(uuid, text, uuid[]) from public, anon;
revoke execute on function public.edit_comment_with_mentions(uuid, text, uuid[]) from public, anon;
grant execute on function public.add_comment_with_mentions(uuid, text, uuid[]) to authenticated;
grant execute on function public.edit_comment_with_mentions(uuid, text, uuid[]) to authenticated;

-- Legacy browser/API entry points remain compatible but delegate to the
-- identity-aware implementation. They cannot infer or notify arbitrary text.
create or replace function public.add_comment(p_issue_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.add_comment_with_mentions(p_issue_id, p_body, null::uuid[]);
end;
$$;

create or replace function public.edit_comment(p_comment_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- NULL means preserve the existing stable identities while editing text.
  perform public.edit_comment_with_mentions(p_comment_id, p_body, null::uuid[]);
end;
$$;

revoke execute on function public.add_comment(uuid, text), public.edit_comment(uuid, text) from public, anon;
grant execute on function public.add_comment(uuid, text), public.edit_comment(uuid, text) to authenticated;

-- Remove the old regex/profile-name trigger. Stable mention RPCs are the only
-- path that dispatches MENTION notifications after this migration.
drop trigger if exists trg_comment_mentions_notifications on public.comments;
drop function if exists public.on_comment_mentions_notifications();

-- Direct comment writes are RPC-only; SELECT remains governed by comments RLS.
revoke insert, update, delete on public.comments from anon, authenticated, public;
-- Migration 063: personal account metadata and public profile avatars.
-- Migration 062 is reserved for the mentions workstream.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = excluded.allowed_mime_types;

-- Profile avatars are intentionally public, but only authenticated owners may
-- create, replace, or remove an object. A UUID-prefixed path prevents a user
-- from writing into another user's avatar namespace.
drop policy if exists "Public profile avatars can be viewed" on storage.objects;
create policy "Public profile avatars can be viewed"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'profile-avatars'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)$'
  );

drop policy if exists "Users can upload their profile avatars" on storage.objects;
create policy "Users can upload their profile avatars"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)$'
    and metadata is not null
    and lower(coalesce(metadata->>'mimetype', '')) in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  );

drop policy if exists "Users can replace their profile avatars" on storage.objects;
create policy "Users can replace their profile avatars"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)$'
    and metadata is not null
    and lower(coalesce(metadata->>'mimetype', '')) in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  );

drop policy if exists "Users can delete their profile avatars" on storage.objects;
create policy "Users can delete their profile avatars"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- Profile mutations go through this contract so the caller cannot attach an
-- arbitrary tracking URL. Existing OAuth/provider avatars remain valid when
-- the user only changes their display name; new avatar URLs must be in the
-- TraceBox public bucket and scoped to the current user's UUID.
drop policy if exists "Users can update their own profile" on public.profiles;
revoke insert, update, delete on public.profiles from anon, authenticated;

create or replace function public.update_current_profile(
  p_display_name text,
  p_avatar_url text
)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing_avatar text;
  v_display_name text := nullif(trim(p_display_name), '');
  v_avatar_url text := nullif(trim(p_avatar_url), '');
  v_avatar_pattern text;
  v_avatar_path text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if v_display_name is null or char_length(v_display_name) > 120 then
    raise exception 'VALIDATION: Display name is required and must be <= 120 characters' using errcode = '22023';
  end if;

  select p.avatar_url into v_existing_avatar
  from public.profiles p
  where p.id = v_user
  for update;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_avatar_pattern := '^(https://[a-z0-9-]+\.supabase\.co|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)/storage/v1/object/public/profile-avatars/' || v_user::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)(\?.*)?$';
  if v_avatar_url is not null
     and v_avatar_url is distinct from v_existing_avatar
     and v_avatar_url !~* v_avatar_pattern then
    raise exception 'VALIDATION: Avatar must be a TraceBox profile image' using errcode = '22023';
  end if;
  if v_avatar_url is not null and v_avatar_url is distinct from v_existing_avatar then
    v_avatar_path := substring(v_avatar_url from '/storage/v1/object/public/profile-avatars/([^?]+)');
    if v_avatar_path is null or not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'profile-avatars' and o.name = v_avatar_path
    ) then
      raise exception 'VALIDATION: Avatar object was not found' using errcode = '22023';
    end if;
  end if;

  update public.profiles
  set display_name = v_display_name,
      avatar_url = v_avatar_url
  where profiles.id = v_user;

  return query
  select p.id, p.display_name, p.avatar_url, p.updated_at
  from public.profiles p
  where p.id = v_user;
end;
$$;

revoke execute on function public.update_current_profile(text, text) from public, anon;
grant execute on function public.update_current_profile(text, text) to authenticated;
-- Migration 064: additive GitHub operational visibility and retry contract.
--
-- github_installations + github_repositories + project_github_repositories are
-- the canonical stable-ID GitHub App model. project_integrations remains a
-- compatibility projection for the older free-text integration path; it is
-- intentionally retained so existing links and deployments keep working.

comment on table public.github_installations is
  'Canonical GitHub App installation model. Legacy project_integrations rows are compatibility-only.';
comment on table public.github_repositories is
  'Canonical GitHub repository catalog keyed by stable GitHub IDs.';
comment on table public.project_github_repositories is
  'Canonical project-to-GitHub repository binding model.';
comment on table public.project_integrations is
  'Legacy compatibility projection for integrations; GitHub App installation and stable-ID repository bindings are canonical.';

-- A bounded, non-secret failure vocabulary is safe to expose through the
-- maintainer-only history RPC. The existing error column remains service-role
-- diagnostic storage and is never returned by the read functions below.
alter table public.github_webhook_deliveries
  add column if not exists failure_category text not null default 'NONE',
  add column if not exists failed_at timestamptz,
  add column if not exists last_error_at timestamptz,
  add column if not exists retry_requested_at timestamptz;

update public.github_webhook_deliveries
set failure_category = case when attempt_count >= 8 then 'RETRY_BUDGET_EXHAUSTED' else 'PROCESSING' end
where status = 'FAILED' and failure_category = 'NONE';

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.github_webhook_deliveries'::regclass
      and conname = 'github_webhook_deliveries_failure_category_check'
  ) then
    alter table public.github_webhook_deliveries
      add constraint github_webhook_deliveries_failure_category_check
      check (failure_category in (
        'NONE', 'AUTHORIZATION', 'RATE_LIMITED', 'REPOSITORY_ACCESS',
        'RETRY_BUDGET_EXHAUSTED', 'UPSTREAM', 'PROCESSING'
      ));
  end if;
end;
$migration$;

create index if not exists github_webhook_deliveries_history_idx
  on public.github_webhook_deliveries(received_at desc, id desc);
create index if not exists github_webhook_deliveries_failure_idx
  on public.github_webhook_deliveries(status, failure_category, received_at desc);

-- Optional exact delivery-to-issue/audit linkage. Existing ingestion remains
-- unchanged; trusted future processing can populate this table when one
-- delivery affects one or more issues. RLS is deliberately deny-by-default.
create table if not exists public.github_webhook_delivery_issues (
  delivery_id uuid not null references public.github_webhook_deliveries(id) on delete cascade,
  issue_id uuid not null references public.issues(id) on delete cascade,
  issue_event_id uuid references public.issue_events(id) on delete set null,
  relationship text not null default 'REFERENCES'
    check (relationship in ('REFERENCES', 'FIXES', 'RESOLVES', 'LINKED')),
  resolution_applied boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (delivery_id, issue_id, relationship)
);

comment on table public.github_webhook_delivery_issues is
  'Optional service-only linkage from a GitHub delivery to affected TraceBox issues and their audit event.';

create index if not exists github_webhook_delivery_issues_issue_idx
  on public.github_webhook_delivery_issues(issue_id, created_at desc);
create index if not exists github_webhook_delivery_issues_event_idx
  on public.github_webhook_delivery_issues(issue_event_id)
  where issue_event_id is not null;

alter table public.github_webhook_delivery_issues enable row level security;

-- Record an association without exposing delivery payloads or restricted issue
-- metadata. The issue-event check prevents an unrelated audit row from being
-- attached accidentally.
create or replace function public.record_github_webhook_delivery_issue(
  p_delivery_id text,
  p_issue_id uuid,
  p_issue_event_id uuid default null,
  p_relationship text default 'REFERENCES',
  p_resolution_applied boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery uuid;
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if nullif(trim(p_delivery_id), '') is null or p_issue_id is null then
    raise exception 'VALIDATION: Delivery and issue are required' using errcode = '22023';
  end if;
  if coalesce(p_relationship, 'REFERENCES') not in ('REFERENCES', 'FIXES', 'RESOLVES', 'LINKED') then
    raise exception 'VALIDATION: Invalid delivery issue relationship' using errcode = '22023';
  end if;
  select id into v_delivery
  from public.github_webhook_deliveries d
  where d.delivery_id = trim(p_delivery_id);
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.issues where id = p_issue_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_issue_event_id is not null and not exists (
    select 1 from public.issue_events
    where id = p_issue_event_id and issue_id = p_issue_id
  ) then
    raise exception 'VALIDATION: Issue event does not belong to issue' using errcode = '22023';
  end if;

  insert into public.github_webhook_delivery_issues(
    delivery_id, issue_id, issue_event_id, relationship, resolution_applied
  ) values (
    v_delivery, p_issue_id, p_issue_event_id, coalesce(p_relationship, 'REFERENCES'), coalesce(p_resolution_applied, false)
  )
  on conflict (delivery_id, issue_id, relationship) do update set
    issue_event_id = coalesce(excluded.issue_event_id, public.github_webhook_delivery_issues.issue_event_id),
    resolution_applied = public.github_webhook_delivery_issues.resolution_applied or excluded.resolution_applied;
end;
$$;

-- Preserve the existing four-argument processor contract while allowing
-- trusted callers to persist a safe provider failure category when available.
create or replace function public.mark_github_webhook_delivery(
  p_delivery_id text,
  p_status text,
  p_error text default null,
  p_retry_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mark_github_webhook_delivery(p_delivery_id, p_status, p_error, p_retry_at, null);
end;
$$;

create or replace function public.mark_github_webhook_delivery(
  p_delivery_id text,
  p_status text,
  p_error text,
  p_retry_at timestamptz,
  p_failure_category text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text := upper(nullif(trim(p_failure_category), ''));
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_status not in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED') then
    raise exception 'VALIDATION: Invalid webhook delivery status' using errcode = '22023';
  end if;
  if v_category is not null and v_category not in (
    'NONE', 'AUTHORIZATION', 'RATE_LIMITED', 'REPOSITORY_ACCESS',
    'RETRY_BUDGET_EXHAUSTED', 'UPSTREAM', 'PROCESSING'
  ) then
    raise exception 'VALIDATION: Invalid webhook failure category' using errcode = '22023';
  end if;

  update public.github_webhook_deliveries d
  set status = p_status,
      error = nullif(trim(p_error), ''),
      failure_category = case
        when p_status = 'FAILED' and attempt_count >= 8 then 'RETRY_BUDGET_EXHAUSTED'
        when p_status = 'FAILED' then coalesce(v_category, 'PROCESSING')
        else failure_category
      end,
      failed_at = case when p_status = 'FAILED' then timezone('utc'::text, now()) else failed_at end,
      last_error_at = case when p_status = 'FAILED' then timezone('utc'::text, now()) else last_error_at end,
      next_retry_at = case when p_status = 'FAILED' then p_retry_at else null end,
      processing_started_at = case when p_status = 'PROCESSING' then coalesce(processing_started_at, timezone('utc'::text, now())) else null end,
      processed_at = case when p_status in ('PROCESSED', 'FAILED', 'IGNORED') then timezone('utc'::text, now()) else processed_at end
  where d.delivery_id = trim(p_delivery_id);
end;
$$;

-- Maintainers can request a retry for an eligible failed delivery. The request
-- is idempotent per delivery and immediately returns it to RECEIVED, which is
-- already selected by /api/github/webhook-replay; no processor change is
-- required. Cleared payloads and exhausted attempts are never retryable.
create table if not exists public.github_webhook_retry_requests (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null unique references public.github_webhook_deliveries(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default timezone('utc'::text, now()),
  request_count integer not null default 1 check (request_count >= 1)
);

comment on table public.github_webhook_retry_requests is
  'Idempotent maintainer retry requests; replay consumes the linked delivery through the existing inbox.';

create index if not exists github_webhook_retry_requests_requested_idx
  on public.github_webhook_retry_requests(requested_at desc);
alter table public.github_webhook_retry_requests enable row level security;

revoke all on table public.github_webhook_delivery_issues, public.github_webhook_retry_requests from anon, authenticated, public;
grant select, insert, update, delete on table public.github_webhook_delivery_issues, public.github_webhook_retry_requests to service_role;

create or replace function public.request_github_webhook_retry(
  p_project_id uuid,
  p_delivery_id text
)
returns table (
  request_id uuid,
  delivery_id text,
  status text,
  requested_at timestamptz,
  request_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_delivery public.github_webhook_deliveries;
  v_request public.github_webhook_retry_requests;
  v_project_org uuid;
  v_request_id uuid;
  v_requested_at timestamptz;
  v_count integer;
begin
  if v_user is null or public.project_role(p_project_id) <> 'MAINTAINER' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select organization_id into v_project_org
  from public.projects
  where id = p_project_id and not is_archived;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select d.* into v_delivery
  from public.github_webhook_deliveries d
  where d.delivery_id = trim(p_delivery_id)
    and (
      exists (
        select 1
        from public.github_installations gi
        where gi.organization_id = v_project_org
          and gi.github_installation_id = d.github_installation_id
          and d.github_repository_id is null
      )
      or exists (
        select 1
        from public.project_github_repositories pgr
        join public.github_repositories gr on gr.id = pgr.github_repository_id
        where pgr.project_id = p_project_id
          and gr.github_repository_id = d.github_repository_id
      )
    )
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_request
  from public.github_webhook_retry_requests r
  where r.delivery_id = v_delivery.id
  for update;

  if v_delivery.status = 'RECEIVED' and v_request.id is not null then
    request_id := v_request.id;
    delivery_id := v_delivery.delivery_id;
    status := 'QUEUED';
    requested_at := v_request.requested_at;
    request_count := v_request.request_count;
    return next;
    return;
  end if;
  if v_delivery.status <> 'FAILED'
    or v_delivery.attempt_count >= 8
    or v_delivery.payload_cleared_at is not null
    or v_delivery.payload = '{}'::jsonb then
    raise exception 'NOT_RETRYABLE' using errcode = '42501';
  end if;

  if v_request.id is null then
    insert into public.github_webhook_retry_requests(delivery_id, requested_by)
    values (v_delivery.id, v_user)
    returning id, requested_at, request_count into v_request_id, v_requested_at, v_count;
  else
    update public.github_webhook_retry_requests
    set requested_by = v_user,
        requested_at = timezone('utc'::text, now()),
        request_count = request_count + 1
    where id = v_request.id
    returning id, requested_at, request_count into v_request_id, v_requested_at, v_count;
  end if;

  update public.github_webhook_deliveries
  set status = 'RECEIVED',
      next_retry_at = null,
      processing_started_at = null,
      processed_at = null,
      retry_requested_at = v_requested_at
  where id = v_delivery.id;

  request_id := v_request_id;
  delivery_id := v_delivery.delivery_id;
  status := 'QUEUED';
  requested_at := v_requested_at;
  request_count := v_count;
  return next;
end;
$$;

-- Boolean compatibility wrapper for callers that only need to know whether a
-- retry was queued. It delegates to the idempotent row-returning contract.
create or replace function public.retry_github_webhook_delivery(
  p_project_id uuid,
  p_delivery_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.request_github_webhook_retry(p_project_id, p_delivery_id);
  return true;
exception
  when others then
    if sqlerrm = 'NOT_RETRYABLE' then return false; end if;
    raise;
end;
$$;

-- Maintainer-safe, payload-free delivery history. Association is scoped to
-- this project's canonical repository bindings or its organization's verified
-- installation; no issue rows or failure diagnostics are returned.
create or replace function public.list_github_webhook_deliveries(
  p_project_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  delivery_id text,
  event_name text,
  action text,
  github_installation_id bigint,
  github_repository_id bigint,
  received_at timestamptz,
  last_attempt_at timestamptz,
  processed_at timestamptz,
  status text,
  attempt_count integer,
  next_retry_at timestamptz,
  failure_category text,
  failed_at timestamptz,
  retry_requested_at timestamptz,
  payload_cleared_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null or public.project_role(p_project_id) <> 'MAINTAINER' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select organization_id into v_org
  from public.projects
  where id = p_project_id and not is_archived;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select d.delivery_id, d.event_name, d.action, d.github_installation_id, d.github_repository_id, d.received_at, d.last_attempt_at,
    d.processed_at, d.status, d.attempt_count, d.next_retry_at,
    d.failure_category, d.failed_at, d.retry_requested_at, d.payload_cleared_at
  from public.github_webhook_deliveries d
    where exists (
      select 1
      from public.github_installations gi
      where gi.organization_id = v_org
        and gi.github_installation_id = d.github_installation_id
        and d.github_repository_id is null
  )
  or exists (
    select 1
    from public.project_github_repositories pgr
    join public.github_repositories gr on gr.id = pgr.github_repository_id
    where pgr.project_id = p_project_id
      and gr.github_repository_id = d.github_repository_id
  )
  order by d.received_at desc, d.id desc
  limit v_limit offset v_offset;
end;
$$;

-- JSON read model consumed by the settings surface. It is deliberately built
-- from project-scoped stable-ID rows and returns no payload or raw error text.
create or replace function public.get_github_operations(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_deliveries jsonb;
  v_counts jsonb;
begin
  if auth.uid() is null or public.project_role(p_project_id) not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select organization_id into v_org
  from public.projects
  where id = p_project_id and not is_archived;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  with scoped as (
    select d.*
    from public.github_webhook_deliveries d
    where exists (
      select 1 from public.github_installations gi
      where gi.organization_id = v_org
        and gi.github_installation_id = d.github_installation_id
        and d.github_repository_id is null
    )
    or exists (
      select 1
      from public.project_github_repositories pgr
      join public.github_repositories gr on gr.id = pgr.github_repository_id
      where pgr.project_id = p_project_id
        and gr.github_repository_id = d.github_repository_id
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', s.delivery_id,
    'event_name', s.event_name,
    'action', s.action,
    'github_installation_id', s.github_installation_id,
    'github_repository_id', s.github_repository_id,
    'status', s.status,
    'attempt_count', s.attempt_count,
    'error', null,
    'received_at', s.received_at,
    'last_attempt_at', s.last_attempt_at,
    'next_retry_at', s.next_retry_at,
    'processed_at', s.processed_at,
    'failure_category', case when s.status = 'FAILED' then s.failure_category else null end,
    'retry_eligible', (s.status = 'FAILED' and s.attempt_count < 8 and s.payload_cleared_at is null and s.payload <> '{}'::jsonb),
    'affected_issues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'issue_key', p.key || '-' || i.issue_number,
        'relationship', di.relationship,
        'resolution_applied', di.resolution_applied
      ) order by p.key, i.issue_number, di.relationship)
      from public.github_webhook_delivery_issues di
      join public.issues i on i.id = di.issue_id
      join public.projects p on p.id = i.project_id
      where di.delivery_id = s.id
        and i.project_id = p_project_id
        and public.can_view_issue(i.id)
    ), '[]'::jsonb)
  ) order by s.received_at desc, s.id desc), '[]'::jsonb)
  into v_deliveries
  from (select * from scoped order by received_at desc, id desc limit 100) s;

  with scoped as (
    select d.status, d.attempt_count, d.payload_cleared_at, d.payload
    from public.github_webhook_deliveries d
    where exists (
      select 1 from public.github_installations gi
      where gi.organization_id = v_org
        and gi.github_installation_id = d.github_installation_id
        and d.github_repository_id is null
    )
    or exists (
      select 1
      from public.project_github_repositories pgr
      join public.github_repositories gr on gr.id = pgr.github_repository_id
      where pgr.project_id = p_project_id
        and gr.github_repository_id = d.github_repository_id
    )
  )
  select jsonb_build_object(
    'processed', count(*) filter (where status = 'PROCESSED'),
    'failed', count(*) filter (where status = 'FAILED'),
    'terminal', count(*) filter (where status = 'FAILED' and (attempt_count >= 8 or payload_cleared_at is not null or payload = '{}'::jsonb)),
    'retryable', count(*) filter (where status = 'FAILED' and attempt_count < 8 and payload_cleared_at is null and payload <> '{}'::jsonb)
  ) into v_counts
  from scoped;

  return jsonb_build_object(
    'health', null,
    'legacy_repo', (
      select pi.repo_full_name
      from public.project_integrations pi
      where pi.project_id = p_project_id and pi.provider = 'GITHUB' and pi.is_enabled
      order by pi.updated_at desc
      limit 1
    ),
    'installations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', gi.id,
        'github_installation_id', gi.github_installation_id,
        'github_account_login', gi.github_account_login,
        'github_account_type', gi.github_account_type,
        'status', gi.status,
        'permissions', gi.permissions,
        'last_verified_at', gi.last_verified_at
      ) order by gi.updated_at desc)
      from public.github_installations gi
      where gi.organization_id = v_org
    ), '[]'::jsonb),
    'repositories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', gr.id,
        'installation_id', gr.installation_id,
        'github_repository_id', gr.github_repository_id,
        'full_name', gr.full_name,
        'private', gr.private,
        'archived', gr.archived,
        'default_branch', gr.default_branch,
        'html_url', gr.html_url,
        'is_accessible', gr.is_accessible,
        'last_synced_at', gr.last_synced_at,
        'is_primary', pgr.is_primary,
        'target_branches', pgr.target_branches,
        'auto_resolve_enabled', pgr.auto_resolve_enabled,
        'last_webhook_at', last_delivery.received_at,
        'last_webhook_status', last_delivery.status,
        'last_webhook_failure_category', case when last_delivery.status = 'FAILED' then last_delivery.failure_category else null end,
        'configuration_error', case
          when gi.status <> 'ACTIVE' then 'INSTALLATION_' || gi.status
          when not gr.is_accessible then 'REPOSITORY_INACCESSIBLE'
          when gr.archived then 'REPOSITORY_ARCHIVED'
          else null
        end
      ) order by pgr.is_primary desc, gr.full_name)
      from public.project_github_repositories pgr
      join public.github_repositories gr on gr.id = pgr.github_repository_id
      join public.github_installations gi on gi.id = gr.installation_id
      left join lateral (
        select d.received_at, d.status, d.failure_category
        from public.github_webhook_deliveries d
        where d.github_repository_id = gr.github_repository_id
        order by d.received_at desc, d.id desc
        limit 1
      ) last_delivery on true
      where pgr.project_id = p_project_id
    ), '[]'::jsonb),
    'deliveries', v_deliveries,
    'counts', v_counts,
    'configuration_errors', coalesce((
      select jsonb_agg(distinct configuration_error)
      from (
        select case
          when gi.status <> 'ACTIVE' then 'INSTALLATION_' || gi.status
          when not gr.is_accessible then 'REPOSITORY_INACCESSIBLE'
          when gr.archived then 'REPOSITORY_ARCHIVED'
          else null
        end as configuration_error
        from public.project_github_repositories pgr
        join public.github_repositories gr on gr.id = pgr.github_repository_id
        join public.github_installations gi on gi.id = gr.installation_id
        where pgr.project_id = p_project_id
      ) errors
      where configuration_error is not null
    ), '[]'::jsonb),
    'canonical_model', 'GITHUB_APP',
    'compatibility_model', 'LEGACY_COMPATIBILITY'
  );
end;
$$;

revoke execute on function public.record_github_webhook_delivery_issue(text, uuid, uuid, text, boolean) from anon, authenticated, public;
grant execute on function public.record_github_webhook_delivery_issue(text, uuid, uuid, text, boolean) to service_role;
revoke execute on function public.mark_github_webhook_delivery(text, text, text, timestamptz), public.mark_github_webhook_delivery(text, text, text, timestamptz, text) from anon, authenticated, public;
grant execute on function public.mark_github_webhook_delivery(text, text, text, timestamptz), public.mark_github_webhook_delivery(text, text, text, timestamptz, text) to service_role;
revoke execute on function public.request_github_webhook_retry(uuid, text), public.retry_github_webhook_delivery(uuid, text), public.list_github_webhook_deliveries(uuid, integer, integer), public.get_github_operations(uuid) from anon, public;
grant execute on function public.request_github_webhook_retry(uuid, text), public.retry_github_webhook_delivery(uuid, text), public.list_github_webhook_deliveries(uuid, integer, integer), public.get_github_operations(uuid) to authenticated;
-- Forward-only repair for hosted schema drift: the migration ledger contains
-- the 11-scope contract from 040, but the live constraint was later observed
-- at the older eight-scope definition. Never rewrite or replay 040.

alter table public.api_tokens drop constraint if exists api_tokens_scopes_check;
alter table public.api_tokens add constraint api_tokens_scopes_check check (
  cardinality(scopes) between 1 and 11
  and scopes <@ array[
    'read', 'write', 'projects:read', 'issues:read', 'issues:write',
    'comments:write', 'milestones:read', 'search:read',
    'integrations:read', 'github_links:read', 'github_links:write'
  ]::text[]
);

comment on constraint api_tokens_scopes_check on public.api_tokens is
  'Canonical public API scopes; reconciled forward after hosted constraint drift.';
-- Resolve actionable hosted security-advisor findings without weakening the
-- intentional RPC authorization model. Trigger functions are never public API
-- endpoints, and API token primitives are server-only implementation details.

alter function public.membership_role_rank(text) set search_path = public;

revoke execute on function public.authenticate_api_token(text) from public, anon, authenticated;
revoke execute on function public.touch_api_token(text) from public, anon, authenticated;
grant execute on function public.authenticate_api_token(text) to service_role;
grant execute on function public.touch_api_token(text) to service_role;

do $$
declare
  v_function record;
begin
  for v_function in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      v_function.nspname,
      v_function.proname,
      v_function.arguments
    );
  end loop;
end;
$$;
-- Public REST routes authenticate bearer tokens in server-only Next.js code
-- and invoke these wrappers with the service-role client. Browser sessions do
-- not need a second direct PostgREST entry point for token-hash mutations.

revoke execute on function public.api_create_issue(text, jsonb) from public, anon, authenticated;
revoke execute on function public.api_update_issue(text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.api_add_comment(text, uuid, text) from public, anon, authenticated;

grant execute on function public.api_create_issue(text, jsonb) to service_role;
grant execute on function public.api_update_issue(text, uuid, jsonb) to service_role;
grant execute on function public.api_add_comment(text, uuid, text) to service_role;
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
-- Repair runtime defects detected by plpgsql_check on the fully migrated hosted
-- schema. Each dynamic rewrite is guarded: the migration fails instead of
-- silently doing nothing if the expected canonical function body changes.

create or replace function public.find_duplicate_candidates(
  p_project_id uuid,
  p_title text,
  p_limit integer default 5
)
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
    select i.id, i.issue_number, i.title, similarity(i.title, v_title)::double precision
    from public.issues i
    where i.project_id = p_project_id
      and public.can_view_issue(i.id)
      and i.title % v_title
      and similarity(i.title, v_title) > 0.2
    order by similarity(i.title, v_title) desc
    limit v_limit;
end;
$$;

-- pgcrypto is installed in extensions on hosted Supabase. These functions use
-- unqualified gen_random_bytes/digest calls, so expose that trusted schema only
-- through their fixed function-local search paths.
alter function public.create_organization_invitation(uuid, text, text, uuid, text)
  set search_path = public, extensions;
alter function public.accept_organization_invitation(text)
  set search_path = public, extensions;

do $$
declare
  v_definition text;
  v_fixed text;
begin
  select pg_get_functiondef('public.replace_project_workflow(uuid,jsonb,jsonb)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'select id, row_number() over (order by id)::integer as row_number_value' || chr(10) ||
    '    from public.workflow_states where project_id = p_project_id',
    'select staged_state.id, row_number() over (order by staged_state.id)::integer as row_number_value' || chr(10) ||
    '    from public.workflow_states staged_state where staged_state.project_id = p_project_id'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: replace_project_workflow'; end if;
  execute v_fixed;

  select pg_get_functiondef('public.list_notifications(timestamptz,uuid,boolean,integer)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'boundary as (select created_at as boundary_created_at, id as boundary_id from page where rn = v_limit)',
    'boundary as (select page.created_at as boundary_created_at, page.id as boundary_id from page where page.rn = v_limit)'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: list_notifications'; end if;
  execute v_fixed;

  select pg_get_functiondef('public.get_issue_reports(uuid,integer)'::regprocedure)
    into v_definition;
  v_fixed := replace(v_definition, 'order by x.resolution_at desc, x.issue_number desc', 'order by x.resolved_at desc, x.issue_number desc');
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: get_issue_reports'; end if;
  execute v_fixed;

  select pg_get_functiondef('public.request_github_webhook_retry(uuid,text)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'returning id, requested_at, request_count into v_request_id, v_requested_at, v_count',
    'returning github_webhook_retry_requests.id, github_webhook_retry_requests.requested_at, github_webhook_retry_requests.request_count into v_request_id, v_requested_at, v_count'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: request_github_webhook_retry'; end if;
  execute v_fixed;
end;
$$;

revoke execute on function public.find_duplicate_candidates(uuid, text, integer) from public, anon;
grant execute on function public.find_duplicate_candidates(uuid, text, integer) to authenticated;
-- Finish the plpgsql_check ambiguity repairs exposed after the first runtime
-- repair pass. Guard every canonical text rewrite against silent drift.

do $$
declare
  v_definition text;
  v_fixed text;
begin
  select pg_get_functiondef('public.create_organization_invitation(uuid,text,text,uuid,text)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'select id from public.workspace_invitations' || chr(10) ||
    '    where organization_id = p_organization_id and email = v_email' || chr(10) ||
    '      and accepted_at is null and revoked_at is null',
    'select invitation.id from public.workspace_invitations invitation' || chr(10) ||
    '    where invitation.organization_id = p_organization_id and invitation.email = v_email' || chr(10) ||
    '      and invitation.accepted_at is null and invitation.revoked_at is null'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: create_organization_invitation'; end if;
  execute v_fixed;

  select pg_get_functiondef('public.replace_project_workflow(uuid,jsonb,jsonb)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'set name = ''#'' || left(id::text, 39), position = 1000000 + row_number_value, is_initial = false',
    'set name = ''#'' || left(workflow_states.id::text, 39), position = 1000000 + staged.row_number_value, is_initial = false'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: replace_project_workflow'; end if;
  execute v_fixed;

  select pg_get_functiondef('public.request_github_webhook_retry(uuid,text)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'request_count = request_count + 1',
    'request_count = github_webhook_retry_requests.request_count + 1'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: request_github_webhook_retry'; end if;
  execute v_fixed;
end;
$$;
-- Qualify the final invitation output-column collision found by plpgsql_check.

do $$
declare
  v_definition text;
  v_fixed text;
begin
  select pg_get_functiondef('public.create_organization_invitation(uuid,text,text,uuid,text)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'update public.workspace_invitations set revoked_at = timezone(''utc''::text, now()) where id = v_old_invitation',
    'update public.workspace_invitations invitation set revoked_at = timezone(''utc''::text, now()) where invitation.id = v_old_invitation'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: create_organization_invitation update'; end if;
  execute v_fixed;
end;
$$;
-- Match optimizer volatility declarations to the visibility/auth helpers each
-- read model invokes. VOLATILE is the safe contract when a function depends on
-- request-local identity or helpers that PostgreSQL classifies as volatile.

alter function public.get_github_operations(uuid) volatile;
alter function public.get_unread_notifications_count() volatile;
alter function public.list_notifications(timestamptz, uuid, boolean, integer) volatile;
alter function public.get_issue_reports(uuid, integer) volatile;
alter function public.get_dashboard_metrics(uuid) volatile;
alter function public.list_project_audit_events(uuid, integer, integer, uuid, text, uuid, timestamptz, timestamptz) volatile;
alter function public.list_project_mention_candidates(uuid, text, integer, uuid) volatile;
alter function public.redact_audit_json(jsonb) stable;

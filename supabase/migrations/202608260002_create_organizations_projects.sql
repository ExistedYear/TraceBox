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

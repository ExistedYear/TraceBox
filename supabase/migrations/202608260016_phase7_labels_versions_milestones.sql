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

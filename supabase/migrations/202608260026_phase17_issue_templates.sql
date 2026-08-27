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

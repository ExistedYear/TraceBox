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

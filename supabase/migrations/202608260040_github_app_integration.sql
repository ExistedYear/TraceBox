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

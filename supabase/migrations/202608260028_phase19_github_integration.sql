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

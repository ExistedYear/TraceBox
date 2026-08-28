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

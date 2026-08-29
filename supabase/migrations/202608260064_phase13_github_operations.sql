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

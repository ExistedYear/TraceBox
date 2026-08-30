-- Migration 080: Trace Intelligence database and security contracts.
--
-- AI requests are advisory and server-orchestrated.  These tables intentionally
-- retain only opaque input hashes and bounded, schema-validated results: raw
-- prompts, issue bodies, comments, attachments, provider payloads, and secrets
-- never belong in the database contract.

create extension if not exists pgcrypto;

create table if not exists public.ai_analysis_cache (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  issue_id uuid references public.issues (id) on delete cascade,
  context_issue_ids uuid[] not null default '{}'::uuid[] check (cardinality(context_issue_ids) <= 20),
  feature text not null check (feature in (
    'TRIAGE', 'REPORT_QUALITY', 'DUPLICATE_EXPLANATION',
    'NATURAL_LANGUAGE_SEARCH', 'RELEASE_RISK', 'BLAST_RADIUS'
  )),
  input_hash text not null check (input_hash ~ '^[0-9a-fA-F]{64}$'),
  model_version text not null check (char_length(model_version) between 1 and 120),
  schema_version text not null check (char_length(schema_version) between 1 and 80),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  status text not null default 'PENDING' check (status in ('PENDING', 'SUCCEEDED', 'FAILED')),
  result jsonb,
  error_code text check (error_code is null or error_code in (
    'AI_NOT_CONFIGURED', 'AI_RATE_LIMITED', 'AI_TIMEOUT',
    'AI_PROVIDER_ERROR', 'AI_INVALID_RESPONSE',
    'AI_DISABLED_FOR_RESTRICTED_ISSUE', 'AI_CONTEXT_UNAVAILABLE'
  )),
  lease_until timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_analysis_cache_result_size_check
    check (result is null or pg_column_size(result) <= 262144),
  constraint ai_analysis_cache_status_result_check
    check (
      (status = 'PENDING' and result is null and error_code is null)
      or (status = 'SUCCEEDED' and result is not null and error_code is null)
      or (status = 'FAILED' and result is null and error_code is not null)
    )
);

create table if not exists public.ai_request_ledger (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  issue_id uuid references public.issues (id) on delete cascade,
  context_issue_ids uuid[] not null default '{}'::uuid[] check (cardinality(context_issue_ids) <= 20),
  cache_id uuid references public.ai_analysis_cache (id) on delete set null,
  feature text not null check (feature in (
    'TRIAGE', 'REPORT_QUALITY', 'DUPLICATE_EXPLANATION',
    'NATURAL_LANGUAGE_SEARCH', 'RELEASE_RISK', 'BLAST_RADIUS'
  )),
  input_hash text not null check (input_hash ~ '^[0-9a-fA-F]{64}$'),
  model_version text not null check (char_length(model_version) between 1 and 120),
  schema_version text not null check (char_length(schema_version) between 1 and 80),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  status text not null default 'CLAIMED' check (status in ('CLAIMED', 'COMPLETED', 'FAILED', 'EXPIRED')),
  lease_until timestamptz not null,
  failure_code text check (failure_code is null or failure_code in (
    'AI_NOT_CONFIGURED', 'AI_RATE_LIMITED', 'AI_TIMEOUT',
    'AI_PROVIDER_ERROR', 'AI_INVALID_RESPONSE',
    'AI_DISABLED_FOR_RESTRICTED_ISSUE', 'AI_CONTEXT_UNAVAILABLE'
  )),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_request_ledger_failure_status_check
    check ((status in ('FAILED', 'EXPIRED') and failure_code is not null) or (status in ('CLAIMED', 'COMPLETED') and failure_code is null))
);

comment on table public.ai_analysis_cache is
  'Opaque, viewer-scoped Trace Intelligence results. Raw prompts and provider payloads are never stored.';
comment on table public.ai_request_ledger is
  'Bounded Trace Intelligence request ledger used for ownership, budgets, leases, and single-flight claims.';

create unique index if not exists ai_analysis_cache_key_idx
  on public.ai_analysis_cache (
    viewer_id, project_id, coalesce(issue_id, '00000000-0000-0000-0000-000000000000'::uuid),
    feature, input_hash, model_version, schema_version, prompt_version
  );
create index if not exists ai_analysis_cache_expiry_idx
  on public.ai_analysis_cache (expires_at);
create index if not exists ai_request_ledger_requester_created_idx
  on public.ai_request_ledger (requester_id, created_at desc);
create index if not exists ai_request_ledger_project_created_idx
  on public.ai_request_ledger (project_id, created_at desc);
create index if not exists ai_request_ledger_lease_idx
  on public.ai_request_ledger (status, lease_until);
create index if not exists ai_analysis_cache_context_issue_ids_idx
  on public.ai_analysis_cache using gin (context_issue_ids);

create trigger ai_analysis_cache_set_updated_at
before update on public.ai_analysis_cache
for each row execute procedure public.set_updated_at();

create trigger ai_request_ledger_set_updated_at
before update on public.ai_request_ledger
for each row execute procedure public.set_updated_at();

alter table public.ai_analysis_cache enable row level security;
alter table public.ai_request_ledger enable row level security;

-- There are deliberately no browser policies. Every read and write is through
-- the narrow RPCs below, which re-check live project/issue authorization.
revoke all on table public.ai_analysis_cache, public.ai_request_ledger from public, anon, authenticated, service_role;

create or replace function public.ai_issue_context_allowed(p_project_id uuid, p_issue_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.issues i
     where i.id = p_issue_id
       and i.project_id = p_project_id
       and coalesce(i.visibility, 'PROJECT') <> 'RESTRICTED'
       and i.type <> 'SECURITY'
       and public.can_view_issue(i.id)
  );
$$;

revoke execute on function public.ai_issue_context_allowed(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.ai_context_issues_allowed(p_project_id uuid, p_issue_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(bool_and(public.ai_issue_context_allowed(p_project_id, issue_id)), true)
  from unnest(coalesce(p_issue_ids, '{}'::uuid[])) issue_id;
$$;

revoke execute on function public.ai_context_issues_allowed(uuid, uuid[]) from public, anon, authenticated, service_role;

create or replace function public.claim_ai_analysis(
  p_project_id uuid,
  p_issue_id uuid,
  p_feature text,
  p_input_hash text,
  p_model_version text,
  p_schema_version text,
  p_prompt_version text,
  p_ttl_seconds integer default 86400,
  p_context_issue_ids uuid[] default null
)
returns table (
  status text,
  request_id uuid,
  cache_id uuid,
  result jsonb,
  retry_after timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_archived boolean;
  v_cache public.ai_analysis_cache;
  v_request public.ai_request_ledger;
  v_request_id uuid;
  v_cache_id uuid;
  v_now timestamptz := timezone('utc'::text, now());
  v_key text;
  v_user_count integer;
  v_project_count integer;
  v_retry timestamptz;
  v_ttl integer := coalesce(p_ttl_seconds, 86400);
  v_cache_found boolean;
  v_request_found boolean;
  v_context_issue_ids uuid[] := coalesce(p_context_issue_ids, '{}'::uuid[]);
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_project_id is null or not public.is_project_member(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select p.is_archived into v_archived from public.projects p where p.id = p_project_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if p_issue_id is not null and not public.ai_issue_context_allowed(p_project_id, p_issue_id) then
    raise exception 'AI_DISABLED_FOR_RESTRICTED_ISSUE' using errcode = '42501';
  end if;
  if cardinality(v_context_issue_ids) > 20 or not public.ai_context_issues_allowed(p_project_id, v_context_issue_ids) then
    raise exception 'AI_DISABLED_FOR_RESTRICTED_ISSUE' using errcode = '42501';
  end if;
  if p_feature is null or p_feature not in ('TRIAGE', 'REPORT_QUALITY', 'DUPLICATE_EXPLANATION', 'NATURAL_LANGUAGE_SEARCH', 'RELEASE_RISK', 'BLAST_RADIUS') then
    raise exception 'VALIDATION: Invalid AI feature' using errcode = '22023';
  end if;
  if p_input_hash is null or p_input_hash !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'VALIDATION: Input hash must be SHA-256 hex' using errcode = '22023';
  end if;
  if p_model_version is null or char_length(p_model_version) not between 1 and 120
     or p_schema_version is null or char_length(p_schema_version) not between 1 and 80
     or p_prompt_version is null or char_length(p_prompt_version) not between 1 and 80 then
    raise exception 'VALIDATION: AI version is invalid' using errcode = '22023';
  end if;
  if v_ttl < 60 or v_ttl > 604800 then
    raise exception 'VALIDATION: AI cache TTL must be between 60 seconds and 7 days' using errcode = '22023';
  end if;

  -- All claimers for an equivalent canonical input serialize on one key.
  v_key := concat_ws('|', v_user::text, p_project_id::text,
    coalesce(p_issue_id::text, 'PROJECT'), p_feature, lower(p_input_hash),
    p_model_version, p_schema_version, p_prompt_version);
  perform pg_advisory_xact_lock(hashtextextended(v_key, 080260));

  select c.* into v_cache
    from public.ai_analysis_cache c
   where c.viewer_id = v_user
     and c.project_id = p_project_id
     and c.issue_id is not distinct from p_issue_id
     and c.feature = p_feature
     and c.input_hash = lower(p_input_hash)
     and c.model_version = p_model_version
     and c.schema_version = p_schema_version
     and c.prompt_version = p_prompt_version
   for update;
  v_cache_found := found;
  if found and v_cache.status = 'SUCCEEDED' and v_cache.expires_at > v_now
     and public.ai_context_issues_allowed(v_cache.project_id, v_cache.context_issue_ids) then
    return query select 'HIT'::text, null::uuid, v_cache.id, v_cache.result, v_cache.expires_at;
    return;
  end if;

  update public.ai_request_ledger r
     set status = 'EXPIRED', failure_code = 'AI_TIMEOUT', completed_at = v_now
   where r.requester_id = v_user
     and r.project_id = p_project_id
     and r.issue_id is not distinct from p_issue_id
     and r.feature = p_feature
     and r.input_hash = lower(p_input_hash)
     and r.model_version = p_model_version
     and r.schema_version = p_schema_version
     and r.prompt_version = p_prompt_version
     and r.status = 'CLAIMED'
     and r.lease_until <= v_now;

  select r.* into v_request
    from public.ai_request_ledger r
   where r.requester_id = v_user
     and r.project_id = p_project_id
     and r.issue_id is not distinct from p_issue_id
     and r.feature = p_feature
     and r.input_hash = lower(p_input_hash)
     and r.model_version = p_model_version
     and r.schema_version = p_schema_version
     and r.prompt_version = p_prompt_version
     and r.status = 'CLAIMED'
     and r.lease_until > v_now
   order by r.created_at desc
   limit 1
   for update;
  v_request_found := found;
  if v_request_found then
    return query select 'PENDING'::text, v_request.id, v_request.cache_id, null::jsonb, v_request.lease_until;
    return;
  end if;

  select count(*)::integer into v_user_count
    from public.ai_request_ledger r
   where r.requester_id = v_user
     and r.created_at >= v_now - interval '1 hour'
     and r.status in ('CLAIMED', 'COMPLETED', 'FAILED');
  select count(*)::integer into v_project_count
    from public.ai_request_ledger r
   where r.project_id = p_project_id
     and r.created_at >= v_now - interval '1 hour'
     and r.status in ('CLAIMED', 'COMPLETED', 'FAILED');
  if v_user_count >= 30 or v_project_count >= 200 then
    v_retry := v_now + interval '1 hour';
    return query select 'RATE_LIMITED'::text, null::uuid, null::uuid, null::jsonb, v_retry;
    return;
  end if;

  if v_cache_found then
    update public.ai_analysis_cache
     set status = 'PENDING', result = null, error_code = null,
           context_issue_ids = v_context_issue_ids,
           expires_at = v_now + make_interval(secs => v_ttl),
           lease_until = v_now + interval '60 seconds', completed_at = null
     where id = v_cache.id
     returning id into v_cache_id;
  else
    insert into public.ai_analysis_cache (
      viewer_id, project_id, issue_id, context_issue_ids, feature, input_hash, model_version,
      schema_version, prompt_version, status, expires_at, lease_until
    ) values (
      v_user, p_project_id, p_issue_id, v_context_issue_ids, p_feature, lower(p_input_hash), p_model_version,
      p_schema_version, p_prompt_version, 'PENDING', v_now + make_interval(secs => v_ttl), v_now + interval '60 seconds'
    ) returning id into v_cache_id;
  end if;

  insert into public.ai_request_ledger (
    requester_id, project_id, issue_id, context_issue_ids, cache_id, feature, input_hash,
    model_version, schema_version, prompt_version, status, lease_until
  ) values (
    v_user, p_project_id, p_issue_id, v_context_issue_ids, v_cache_id, p_feature, lower(p_input_hash),
    p_model_version, p_schema_version, p_prompt_version, 'CLAIMED', v_now + interval '60 seconds'
  ) returning id into v_request_id;

  return query select 'CLAIMED'::text, v_request_id, v_cache_id, null::jsonb, v_now + interval '60 seconds';
end;
$$;

create or replace function public.get_ai_analysis_cache(
  p_project_id uuid,
  p_issue_id uuid,
  p_feature text,
  p_input_hash text,
  p_model_version text,
  p_schema_version text,
  p_prompt_version text
)
returns table (
  cache_id uuid,
  feature text,
  result jsonb,
  expires_at timestamptz,
  model_version text,
  schema_version text,
  prompt_version text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_project_id is null or not public.is_project_member(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_issue_id is not null and not public.ai_issue_context_allowed(p_project_id, p_issue_id) then
    raise exception 'AI_DISABLED_FOR_RESTRICTED_ISSUE' using errcode = '42501';
  end if;
  return query
    select c.id, c.feature, c.result, c.expires_at, c.model_version, c.schema_version, c.prompt_version
      from public.ai_analysis_cache c
     where c.viewer_id = v_user
       and c.project_id = p_project_id
       and c.issue_id is not distinct from p_issue_id
       and c.feature = p_feature
       and c.input_hash = lower(p_input_hash)
       and c.model_version = p_model_version
       and c.schema_version = p_schema_version
       and c.prompt_version = p_prompt_version
       and c.status = 'SUCCEEDED'
       and c.expires_at > timezone('utc'::text, now())
       and public.ai_context_issues_allowed(c.project_id, c.context_issue_ids);
end;
$$;

create or replace function public.complete_ai_analysis(
  p_request_id uuid,
  p_result jsonb,
  p_ttl_seconds integer default 86400
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_request public.ai_request_ledger;
  v_now timestamptz := timezone('utc'::text, now());
  v_ttl integer := coalesce(p_ttl_seconds, 86400);
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' or pg_column_size(p_result) > 262144 then
    raise exception 'VALIDATION: AI result must be a bounded JSON object' using errcode = '22023';
  end if;
  if v_ttl < 60 or v_ttl > 604800 then
    raise exception 'VALIDATION: AI cache TTL must be between 60 seconds and 7 days' using errcode = '22023';
  end if;
  select r.* into v_request from public.ai_request_ledger r where r.id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_request.requester_id <> v_user then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_request.status <> 'CLAIMED' or v_request.lease_until <= v_now then
    raise exception 'AI_REQUEST_EXPIRED' using errcode = '40001';
  end if;
  if not public.is_project_member(v_request.project_id)
     or (v_request.issue_id is not null and not public.ai_issue_context_allowed(v_request.project_id, v_request.issue_id))
     or not public.ai_context_issues_allowed(v_request.project_id, v_request.context_issue_ids) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  update public.ai_analysis_cache c
     set status = 'SUCCEEDED', result = p_result, error_code = null,
         completed_at = v_now, lease_until = null, expires_at = v_now + make_interval(secs => v_ttl)
   where c.id = v_request.cache_id and c.viewer_id = v_user;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  update public.ai_request_ledger
     set status = 'COMPLETED', completed_at = v_now, lease_until = v_now, failure_code = null
   where id = p_request_id;
end;
$$;

create or replace function public.fail_ai_analysis(p_request_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_request public.ai_request_ledger;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_error_code is null or p_error_code not in ('AI_NOT_CONFIGURED', 'AI_RATE_LIMITED', 'AI_TIMEOUT', 'AI_PROVIDER_ERROR', 'AI_INVALID_RESPONSE', 'AI_DISABLED_FOR_RESTRICTED_ISSUE', 'AI_CONTEXT_UNAVAILABLE') then
    raise exception 'VALIDATION: Invalid AI failure code' using errcode = '22023';
  end if;
  select r.* into v_request from public.ai_request_ledger r where r.id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_request.requester_id <> v_user then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_request.status <> 'CLAIMED' then raise exception 'AI_REQUEST_NOT_ACTIVE' using errcode = '40001'; end if;
  update public.ai_request_ledger
     set status = 'FAILED', failure_code = p_error_code, completed_at = v_now, lease_until = v_now
   where id = p_request_id;
  update public.ai_analysis_cache
     set status = 'FAILED', result = null, error_code = p_error_code, completed_at = v_now,
         lease_until = null, expires_at = v_now
   where id = v_request.cache_id and viewer_id = v_user;
end;
$$;

-- Service-role maintenance removes expired results and old terminal ledger
-- rows. No browser role can invoke this broad cleanup operation.
create or replace function public.cleanup_ai_analysis_cache(p_before timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before timestamptz := coalesce(p_before, timezone('utc'::text, now()));
  v_deleted integer;
begin
  if not public.is_service_role_request() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.ai_analysis_cache where expires_at <= v_before;
  get diagnostics v_deleted = row_count;
  delete from public.ai_request_ledger
   where status in ('COMPLETED', 'FAILED', 'EXPIRED') and created_at <= v_before - interval '7 days';
  return v_deleted;
end;
$$;

-- Deterministic, bounded graph context. Restricted or SECURITY issues are
-- excluded at every hop, even when the current viewer can see them.
create or replace function public.get_issue_blast_radius_context(p_issue_id uuid, p_limit integer default 50)
returns table (
  issue_id uuid,
  issue_number bigint,
  title text,
  relationship text,
  direction text,
  depth integer
)
language sql
volatile
security definer
set search_path = public
as $$
  with recursive root as (
    select i.id, i.project_id
      from public.issues i
     where i.id = p_issue_id
       and coalesce(i.visibility, 'PROJECT') <> 'RESTRICTED'
       and i.type <> 'SECURITY'
       and public.can_view_issue(i.id)
  ), walk(root_id, project_id, related_id, relationship, direction, depth, visited) as (
    select r.id, r.project_id,
           case when l.source_issue_id = r.id then l.target_issue_id else l.source_issue_id end,
           l.relationship,
           case when l.source_issue_id = r.id then 'OUTBOUND' else 'INBOUND' end,
           1,
           array[r.id, case when l.source_issue_id = r.id then l.target_issue_id else l.source_issue_id end]
      from root r
      join public.issue_links l on l.source_issue_id = r.id or l.target_issue_id = r.id
      join public.issues n on n.id = case when l.source_issue_id = r.id then l.target_issue_id else l.source_issue_id end
     where n.project_id = r.project_id
       and coalesce(n.visibility, 'PROJECT') <> 'RESTRICTED'
       and n.type <> 'SECURITY'
       and public.can_view_issue(n.id)
    union all
    select w.root_id, w.project_id,
           case when l.source_issue_id = w.related_id then l.target_issue_id else l.source_issue_id end,
           l.relationship,
           case when l.source_issue_id = w.related_id then 'OUTBOUND' else 'INBOUND' end,
           w.depth + 1,
           w.visited || case when l.source_issue_id = w.related_id then l.target_issue_id else l.source_issue_id end
      from walk w
      join public.issue_links l on l.source_issue_id = w.related_id or l.target_issue_id = w.related_id
      join public.issues n on n.id = case when l.source_issue_id = w.related_id then l.target_issue_id else l.source_issue_id end
     where w.depth < 3
       and not (case when l.source_issue_id = w.related_id then l.target_issue_id else l.source_issue_id end = any(w.visited))
       and n.project_id = w.project_id
       and coalesce(n.visibility, 'PROJECT') <> 'RESTRICTED'
       and n.type <> 'SECURITY'
       and public.can_view_issue(n.id)
  ), ranked as (
    select distinct on (w.related_id) w.related_id, w.relationship, w.direction, w.depth
      from walk w
     order by w.related_id, w.depth, w.direction, w.relationship
  )
  select i.id, i.issue_number, i.title, r.relationship, r.direction, r.depth
    from ranked r
    join public.issues i on i.id = r.related_id
   order by r.depth, r.direction, i.issue_number, i.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- One optimistic, atomic application point for human-approved triage output.
-- Existing RPCs remain the source of truth for field, assignment, labels, and
-- transition authorization. Any error rolls back every preceding mutation.
create or replace function public.apply_issue_triage_updates(
  p_issue_id uuid,
  p_updates jsonb,
  p_expected_updated_at timestamptz
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
  v_current_updated_at timestamptz;
  v_core jsonb;
  v_assignee uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'object' or p_updates = '{}'::jsonb then
    raise exception 'VALIDATION: Triage updates must be a non-empty JSON object' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_updates) k(name)
     where name not in ('priority', 'severity', 'component_id', 'assignee_id')
  ) then raise exception 'VALIDATION: Unsupported triage update field' using errcode = '22023'; end if;
  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select i.updated_at into v_current_updated_at from public.issues i where i.id = p_issue_id for update;
  if p_expected_updated_at is null or v_current_updated_at <> p_expected_updated_at then
    raise exception 'CONFLICT: Issue changed since it was loaded' using errcode = '40001';
  end if;
  v_core := p_updates - 'assignee_id';
  if v_core <> '{}'::jsonb then perform public.update_issue_fields(p_issue_id, v_core); end if;

  if p_updates ? 'assignee_id' then
    if jsonb_typeof(p_updates->'assignee_id') = 'null' then v_assignee := null;
    elsif jsonb_typeof(p_updates->'assignee_id') = 'string' then
      begin v_assignee := nullif(p_updates->>'assignee_id', '')::uuid;
      exception when invalid_text_representation then raise exception 'VALIDATION: Invalid assignee UUID' using errcode = '22023'; end;
    else raise exception 'VALIDATION: Assignee must be a UUID or null' using errcode = '22023'; end if;
    perform public.assign_issue(p_issue_id, v_assignee);
  end if;
end;
$$;

revoke execute on function public.claim_ai_analysis(uuid, uuid, text, text, text, text, text, integer, uuid[]) from public, anon;
revoke execute on function public.get_ai_analysis_cache(uuid, uuid, text, text, text, text, text) from public, anon;
revoke execute on function public.complete_ai_analysis(uuid, jsonb, integer) from public, anon;
revoke execute on function public.fail_ai_analysis(uuid, text) from public, anon;
revoke execute on function public.cleanup_ai_analysis_cache(timestamptz) from public, anon, authenticated;
revoke execute on function public.get_issue_blast_radius_context(uuid, integer) from public, anon;
revoke execute on function public.apply_issue_triage_updates(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.claim_ai_analysis(uuid, uuid, text, text, text, text, text, integer, uuid[]) to authenticated;
grant execute on function public.get_ai_analysis_cache(uuid, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.complete_ai_analysis(uuid, jsonb, integer) to authenticated;
grant execute on function public.fail_ai_analysis(uuid, text) to authenticated;
grant execute on function public.cleanup_ai_analysis_cache(timestamptz) to service_role;
grant execute on function public.get_issue_blast_radius_context(uuid, integer) to authenticated;
grant execute on function public.apply_issue_triage_updates(uuid, jsonb, timestamptz) to authenticated;

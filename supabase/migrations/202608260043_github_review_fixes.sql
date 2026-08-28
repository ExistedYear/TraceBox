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

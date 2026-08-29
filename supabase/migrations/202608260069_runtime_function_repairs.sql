-- Repair runtime defects detected by plpgsql_check on the fully migrated hosted
-- schema. Each dynamic rewrite is guarded: the migration fails instead of
-- silently doing nothing if the expected canonical function body changes.

create or replace function public.find_duplicate_candidates(
  p_project_id uuid,
  p_title text,
  p_limit integer default 5
)
returns table (issue_id uuid, issue_number bigint, title text, similarity double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_title is null or char_length(v_title) < 3 then raise exception 'VALIDATION: Title must be at least 3 characters' using errcode = '22023'; end if;
  return query
    select i.id, i.issue_number, i.title, similarity(i.title, v_title)::double precision
    from public.issues i
    where i.project_id = p_project_id
      and public.can_view_issue(i.id)
      and i.title % v_title
      and similarity(i.title, v_title) > 0.2
    order by similarity(i.title, v_title) desc
    limit v_limit;
end;
$$;

-- pgcrypto is installed in extensions on hosted Supabase. These functions use
-- unqualified gen_random_bytes/digest calls, so expose that trusted schema only
-- through their fixed function-local search paths.
alter function public.create_organization_invitation(uuid, text, text, uuid, text)
  set search_path = public, extensions;
alter function public.accept_organization_invitation(text)
  set search_path = public, extensions;

do $$
declare
  v_definition text;
  v_fixed text;
begin
  select pg_get_functiondef('public.replace_project_workflow(uuid,jsonb,jsonb)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'select id, row_number() over (order by id)::integer as row_number_value' || chr(10) ||
    '    from public.workflow_states where project_id = p_project_id',
    'select staged_state.id, row_number() over (order by staged_state.id)::integer as row_number_value' || chr(10) ||
    '    from public.workflow_states staged_state where staged_state.project_id = p_project_id'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: replace_project_workflow'; end if;
  execute v_fixed;

  select pg_get_functiondef('public.list_notifications(timestamptz,uuid,boolean,integer)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'boundary as (select created_at as boundary_created_at, id as boundary_id from page where rn = v_limit)',
    'boundary as (select page.created_at as boundary_created_at, page.id as boundary_id from page where page.rn = v_limit)'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: list_notifications'; end if;
  execute v_fixed;

  select pg_get_functiondef('public.get_issue_reports(uuid,integer)'::regprocedure)
    into v_definition;
  v_fixed := replace(v_definition, 'order by x.resolution_at desc, x.issue_number desc', 'order by x.resolved_at desc, x.issue_number desc');
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: get_issue_reports'; end if;
  execute v_fixed;

  select pg_get_functiondef('public.request_github_webhook_retry(uuid,text)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'returning id, requested_at, request_count into v_request_id, v_requested_at, v_count',
    'returning github_webhook_retry_requests.id, github_webhook_retry_requests.requested_at, github_webhook_retry_requests.request_count into v_request_id, v_requested_at, v_count'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: request_github_webhook_retry'; end if;
  execute v_fixed;
end;
$$;

revoke execute on function public.find_duplicate_candidates(uuid, text, integer) from public, anon;
grant execute on function public.find_duplicate_candidates(uuid, text, integer) to authenticated;

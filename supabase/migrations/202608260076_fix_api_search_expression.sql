-- Migration 076: repair api_search_issues to use the expression-backed FTS
-- contract created in migration 018. Migration 075 referenced a generated
-- column that does not exist in the applied schema.

create or replace function public.api_search_issues(
  p_token_hash text,
  p_project_id uuid,
  p_query text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
  v_query text := trim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_rows jsonb;
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not (('read' = any(v_token.scopes)) or ('search:read' = any(v_token.scopes))) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if char_length(v_query) < 2 or char_length(v_query) > 200 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and p.organization_id = v_token.organization_id
      and not p.is_archived
  ) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);

  select coalesce(jsonb_agg(to_jsonb(search_rows) order by search_rows.updated_at desc, search_rows.issue_number desc), '[]'::jsonb)
  into v_rows
  from (
    select i.id, i.project_id, i.visibility, i.reporter_id, i.assignee_id,
      i.issue_number, i.title, i.type, i.priority, i.severity, i.created_at, i.updated_at
    from public.issues i
    where i.project_id = p_project_id
      and public.can_view_issue(i.id)
      and (
        to_tsvector('english', coalesce(i.title, '') || ' ' || coalesce(i.description, ''))
          @@ websearch_to_tsquery('english', v_query)
        or i.title ilike '%' || replace(replace(replace(v_query, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' escape '\\'
        or coalesce(i.description, '') ilike '%' || replace(replace(replace(v_query, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' escape '\\'
      )
    order by i.updated_at desc, i.issue_number desc
    limit v_limit
  ) search_rows;

  return v_rows;
end;
$$;

revoke execute on function public.api_search_issues(text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.api_search_issues(text, uuid, text, integer) to service_role;

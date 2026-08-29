-- Require the API token owner to retain live project access before list/search.
-- Row visibility was already enforced in 075/076, but an inaccessible project
-- could otherwise be distinguished from an empty accessible project.

create or replace function public.api_token_can_access_project(
  p_user_id uuid,
  p_organization_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    join public.organizations o on o.id = p.organization_id
    where p.id = p_project_id
      and p.organization_id = p_organization_id
      and not p.is_archived
      and (
        o.owner_id = p_user_id
        or exists (
          select 1
          from public.organization_members om
          where om.organization_id = p.organization_id
            and om.user_id = p_user_id
            and om.role in ('OWNER', 'ADMIN')
        )
        or exists (
          select 1
          from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = p_user_id
        )
      )
  );
$$;

revoke all on function public.api_token_can_access_project(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.api_token_can_access_project(uuid, uuid, uuid) to service_role;

create or replace function public.api_list_issues(
  p_token_hash text,
  p_project_id uuid,
  p_status_id uuid default null,
  p_type text default null,
  p_priority text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 1000000);
  v_total bigint;
  v_rows jsonb;
begin
  if not public.is_service_role_request() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not (('read' = any(v_token.scopes)) or ('issues:read' = any(v_token.scopes))) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if not public.api_token_can_access_project(v_token.user_id, v_token.organization_id, p_project_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);

  select count(*) into v_total
  from public.issues i
  where i.project_id = p_project_id
    and (p_status_id is null or i.status_id = p_status_id)
    and (p_type is null or i.type = p_type)
    and (p_priority is null or i.priority = p_priority)
    and public.can_view_issue(i.id);

  select coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows.created_at desc, page_rows.issue_number desc), '[]'::jsonb)
  into v_rows
  from (
    select
      i.id,
      i.project_id,
      i.visibility,
      i.reporter_id,
      i.assignee_id,
      i.issue_number,
      i.title,
      i.type,
      i.priority,
      i.severity,
      case when ws.id is null then null else jsonb_build_object('name', ws.name, 'category', ws.category) end as status,
      case when c.id is null then null else jsonb_build_object('name', c.name) end as component,
      i.created_at,
      i.updated_at
    from public.issues i
    left join public.workflow_states ws on ws.id = i.status_id
    left join public.components c on c.id = i.component_id
    where i.project_id = p_project_id
      and (p_status_id is null or i.status_id = p_status_id)
      and (p_type is null or i.type = p_type)
      and (p_priority is null or i.priority = p_priority)
      and public.can_view_issue(i.id)
    order by i.created_at desc, i.issue_number desc
    limit v_limit offset v_offset
  ) page_rows;

  return jsonb_build_object('data', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

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
  if not public.api_token_can_access_project(v_token.user_id, v_token.organization_id, p_project_id) then
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
        or i.title ilike '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        or coalesce(i.description, '') ilike '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
      )
    order by i.updated_at desc, i.issue_number desc
    limit v_limit
  ) search_rows;

  return v_rows;
end;
$$;

revoke execute on function public.api_list_issues(text, uuid, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.api_search_issues(text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.api_list_issues(text, uuid, uuid, text, text, integer, integer) to service_role;
grant execute on function public.api_search_issues(text, uuid, text, integer) to service_role;

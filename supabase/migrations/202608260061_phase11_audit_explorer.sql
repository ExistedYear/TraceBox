-- Migration 061: read-only, restricted-safe project audit explorer.
-- Issue events are the canonical immutable audit stream. The redaction helper
-- recursively removes cross-issue references from values written by link and
-- duplicate workflows, so a visible event can never disclose an inaccessible
-- canonical issue through its JSON payload.
create or replace function public.redact_audit_json(p_value jsonb)
returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare v_key text; v_item jsonb; v_result jsonb := '{}'::jsonb;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_item in select * from jsonb_each(p_value) loop
      if lower(v_key) in ('target_id', 'target_issue', 'target_issue_id', 'source_issue', 'source_issue_id', 'canonical_issue_id', 'canonical_issue_number', 'canonical_issue_key', 'duplicate_issue_id', 'duplicate_issue_key', 'resolved_issue_id', 'resolved_issue_key', 'target_key', 'source_key')
        or right(lower(v_key), 9) = '_issue_id'
        or right(lower(v_key), 10) = '_issue_key'
        or right(lower(v_key), 13) = '_issue_number' then
        v_result := v_result || jsonb_build_object(v_key, '[redacted]');
      else
        v_result := v_result || jsonb_build_object(v_key, public.redact_audit_json(v_item));
      end if;
    end loop;
    return v_result;
  elsif jsonb_typeof(p_value) = 'array' then
    return coalesce((select jsonb_agg(public.redact_audit_json(value)) from jsonb_array_elements(p_value)), '[]'::jsonb);
  end if;
  return p_value;
end;
$$;

revoke execute on function public.redact_audit_json(jsonb) from anon, authenticated, public;

create or replace function public.list_project_audit_events(
  p_project_id uuid, p_limit integer default 50, p_offset integer default 0,
  p_actor_id uuid default null, p_event_type text default null,
  p_issue_id uuid default null, p_from timestamptz default null, p_to timestamptz default null
)
returns table (id uuid, issue_id uuid, actor_id uuid, event_type text, field_name text, old_value jsonb, new_value jsonb, metadata jsonb, created_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100)); v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_user is null or not public.is_project_member(p_project_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'VALIDATION: Invalid audit date range' using errcode = '22023';
  end if;

  return query
  select e.id, e.issue_id, e.actor_id, e.event_type, e.field_name,
    case when lower(coalesce(e.field_name, '')) = 'issue_link' then to_jsonb('[redacted]'::text) else public.redact_audit_json(e.old_value) end,
    case when lower(coalesce(e.field_name, '')) = 'issue_link' then to_jsonb('[redacted]'::text) else public.redact_audit_json(e.new_value) end,
    public.redact_audit_json(e.metadata), e.created_at, count(*) over ()
  from public.issue_events e
  join public.issues i on i.id = e.issue_id and i.project_id = p_project_id
  where public.can_view_issue(i.id)
    and (p_actor_id is null or e.actor_id = p_actor_id)
    and (p_event_type is null or e.event_type = nullif(trim(p_event_type), ''))
    and (p_issue_id is null or e.issue_id = p_issue_id)
    and (p_from is null or e.created_at >= p_from)
    and (p_to is null or e.created_at < p_to)
  order by e.created_at desc, e.id desc
  limit v_limit offset v_offset;
end;
$$;
revoke execute on function public.list_project_audit_events(uuid, integer, integer, uuid, text, uuid, timestamptz, timestamptz) from anon, public;
grant execute on function public.list_project_audit_events(uuid, integer, integer, uuid, text, uuid, timestamptz, timestamptz) to authenticated;

-- Migration 053: Phase 9 triage command UX contracts.
-- Duplicate resolution is deliberately one RPC so link, lifecycle, and audit
-- events commit together or are all rolled back.

create or replace function public.resolve_duplicate_issue(
  p_duplicate_issue_id uuid,
  p_canonical_issue_id uuid
)
returns table (duplicate_issue_id uuid, canonical_issue_id uuid, canonical_issue_number bigint)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid(); v_project_id uuid; v_archived boolean; v_role text;
  v_canonical_number bigint; v_resolved_state uuid; v_link_id uuid;
  v_old_state uuid; v_old_resolution text; v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_duplicate_issue_id is null or p_canonical_issue_id is null or p_duplicate_issue_id = p_canonical_issue_id then
    raise exception 'VALIDATION: Choose a different canonical issue' using errcode = '22023';
  end if;
  select i.project_id into v_project_id from public.issues i where i.id = p_duplicate_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_duplicate_issue_id) or not exists (
    select 1 from public.issues i where i.id = p_canonical_issue_id and i.project_id = v_project_id and public.can_view_issue(i.id)
  ) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- Stable issue ordering prevents two concurrent duplicate actions deadlocking.
  perform 1 from public.issues i where i.id in (p_duplicate_issue_id, p_canonical_issue_id) order by i.id for update;
  select i.issue_number into v_canonical_number from public.issues i where i.id = p_canonical_issue_id;
  select i.status_id, i.resolution into v_old_state, v_old_resolution
  from public.issues i where i.id = p_duplicate_issue_id;
  select ws.id into v_resolved_state from public.workflow_states ws where ws.project_id = v_project_id and ws.category = 'RESOLVED' order by ws.position limit 1;
  if v_resolved_state is null then raise exception 'INVALID_STATE' using errcode = '23503'; end if;
  -- Keep link, resolution, and their observable activity in this transaction.
  insert into public.issue_links(source_issue_id, target_issue_id, relationship, created_by)
  values (p_duplicate_issue_id, p_canonical_issue_id, 'DUPLICATE_OF', v_user)
  returning id into v_link_id;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, metadata, new_value)
  values (p_duplicate_issue_id, v_user, 'ISSUE_LINKED', null, null,
    jsonb_build_object('target_id', p_canonical_issue_id, 'relationship', 'DUPLICATE_OF'),
    jsonb_build_object('canonical_issue_id', p_canonical_issue_id, 'canonical_issue_number', v_canonical_number));
  update public.issues
  set status_id = v_resolved_state, resolution = 'DUPLICATE', resolved_at = coalesce(resolved_at, v_now), closed_at = null, updated_at = v_now
  where id = p_duplicate_issue_id;
  if v_old_state is distinct from v_resolved_state then
    insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
    values (p_duplicate_issue_id, v_user, 'STATUS_CHANGED', 'status_id', to_jsonb(v_old_state::text), to_jsonb(v_resolved_state::text), jsonb_build_object('new_category', 'RESOLVED', 'resolution', 'DUPLICATE'));
  end if;
  if v_old_resolution is distinct from 'DUPLICATE' then
    insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value)
    values (p_duplicate_issue_id, v_user, 'RESOLUTION_CHANGED', 'resolution', to_jsonb(v_old_resolution), to_jsonb('DUPLICATE'::text));
  end if;
  return query select p_duplicate_issue_id, p_canonical_issue_id, v_canonical_number;
end;
$$;

revoke execute on function public.resolve_duplicate_issue(uuid, uuid) from anon, public;
grant execute on function public.resolve_duplicate_issue(uuid, uuid) to authenticated;

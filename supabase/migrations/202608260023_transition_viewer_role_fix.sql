-- Migration 023: Fix transition_issue role check to match can_transition_issue
-- Supports wt.required_role = 'VIEWER' across all workflow transitions

create or replace function public.transition_issue(
  p_issue_id uuid,
  p_to_state_id uuid,
  p_resolution text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_old record;
  v_target_state record;
  v_resolution text;
  v_resolved_at timestamptz;
  v_closed_at timestamptz;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Top-down lock: project row first
  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER', 'REPORTER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock target state
  select * into v_target_state
  from public.workflow_states ws
  where ws.id = p_to_state_id and ws.project_id = v_project_id;

  if not found then
    raise exception 'INVALID_STATE' using errcode = '23503';
  end if;

  -- Lock issue row
  select * into v_old
  from public.issues
  where id = p_issue_id
  for update;

  -- If same state and resolution unchanged, no-op
  if v_old.status_id = p_to_state_id and (p_resolution is null or p_resolution = v_old.resolution) then
    return;
  end if;

  -- Validate transition permission unless Maintainer override
  if v_old.status_id <> p_to_state_id and v_role <> 'MAINTAINER' then
    if not exists (
      select 1 from public.workflow_transitions wt
      where wt.project_id = v_project_id
        and wt.from_state_id = v_old.status_id
        and wt.to_state_id = p_to_state_id
        and (
          wt.required_role is null
          or wt.required_role = v_role
          or wt.required_role = 'VIEWER'
          or (wt.required_role = 'REPORTER' and v_role in ('DEVELOPER', 'MAINTAINER'))
          or (wt.required_role = 'DEVELOPER' and v_role = 'MAINTAINER')
        )
    ) then
      raise exception 'INVALID_TRANSITION' using errcode = '42501';
    end if;
  end if;

  -- Determine resolution and timestamps based on target state category
  if v_target_state.category in ('RESOLVED', 'CLOSED') then
    v_resolution := nullif(trim(coalesce(p_resolution, v_old.resolution, 'FIXED')), '');
    if v_resolution not in ('FIXED', 'DUPLICATE', 'WONT_FIX', 'INVALID', 'CANNOT_REPRODUCE', 'WORKS_AS_EXPECTED') then
      raise exception 'VALIDATION: Invalid resolution' using errcode = '22023';
    end if;
    v_resolved_at := coalesce(v_old.resolved_at, v_now);
    if v_target_state.category = 'CLOSED' then
      v_closed_at := v_now;
    else
      v_closed_at := null;
    end if;
  else
    -- Reopening or transitioning back to non-resolved state clears resolution
    v_resolution := null;
    v_resolved_at := null;
    v_closed_at := null;
  end if;

  -- Update issue row
  update public.issues
  set status_id = p_to_state_id,
      resolution = v_resolution,
      resolved_at = v_resolved_at,
      closed_at = v_closed_at,
      updated_at = v_now
  where id = p_issue_id;

  -- Insert STATUS_CHANGED audit event if status changed
  if v_old.status_id <> p_to_state_id then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
    values (
      p_issue_id,
      v_user,
      'STATUS_CHANGED',
      'status_id',
      to_jsonb(v_old.status_id::text),
      to_jsonb(p_to_state_id::text),
      jsonb_build_object(
        'old_state_id', v_old.status_id,
        'new_state_id', p_to_state_id,
        'new_category', v_target_state.category,
        'resolution', v_resolution
      )
    );
  end if;

  -- Insert RESOLUTION_CHANGED audit event if resolution changed
  if coalesce(v_old.resolution, '') is distinct from coalesce(v_resolution, '') then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
    values (
      p_issue_id,
      v_user,
      'RESOLUTION_CHANGED',
      'resolution',
      to_jsonb(v_old.resolution),
      to_jsonb(v_resolution)
    );
  end if;
end;
$$;

revoke execute on function public.transition_issue(uuid, uuid, text) from anon, public;
grant execute on function public.transition_issue(uuid, uuid, text) to authenticated;

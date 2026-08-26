-- Phase 4: inline field editing for issues. General fields require DEVELOPER or
-- MAINTAINER (plan §7 matrix). Each change appends an immutable audit event;
-- status transitions and resolution stay reserved for Phase 6.

create or replace function public.update_issue_fields(p_issue_id uuid, p_updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_old record;
  v_new_title text;
  v_new_value text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into v_old from public.issues where id = p_issue_id;

  if p_updates ? 'title' then
    v_new_title := nullif(trim(p_updates->>'title'), '');
    if v_new_title is null or char_length(v_new_title) > 200 then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_title is distinct from v_old.title then
      update public.issues set title = v_new_title where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TITLE_CHANGED', 'title', to_jsonb(v_old.title), to_jsonb(v_new_title));
    end if;
  end if;

  if p_updates ? 'priority' then
    v_new_value := p_updates->>'priority';
    if v_new_value not in ('P0', 'P1', 'P2', 'P3', 'P4') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.priority then
      update public.issues set priority = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'PRIORITY_CHANGED', 'priority', to_jsonb(v_old.priority), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'severity' then
    v_new_value := p_updates->>'severity';
    if v_new_value not in ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.severity then
      update public.issues set severity = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'SEVERITY_CHANGED', 'severity', to_jsonb(v_old.severity), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'type' then
    v_new_value := p_updates->>'type';
    if v_new_value not in ('BUG', 'ENHANCEMENT', 'TASK', 'SECURITY', 'PERFORMANCE', 'REGRESSION') then
      raise exception 'VALIDATION' using errcode = '22023';
    end if;
    if v_new_value is distinct from v_old.type then
      update public.issues set type = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TYPE_CHANGED', 'type', to_jsonb(v_old.type), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'component_id' then
    v_new_value := nullif(p_updates->>'component_id', '');
    if v_new_value is not null and not exists (
      select 1 from public.components c
      where c.id = v_new_value::uuid and c.project_id = v_project_id
    ) then
      raise exception 'INVALID_COMPONENT' using errcode = '23503';
    end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.component_id::text, '') then
      update public.issues set component_id = v_new_value::uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'COMPONENT_CHANGED', 'component_id',
              case when v_old.component_id is null then to_jsonb(null::text) else to_jsonb(v_old.component_id::text) end,
              to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'assignee_id' then
    v_new_value := nullif(p_updates->>'assignee_id', '');
    if v_new_value is not null and not exists (
      select 1 from public.project_members m
      where m.user_id = v_new_value::uuid and m.project_id = v_project_id
    ) then
      raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
    end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.assignee_id::text, '') then
      update public.issues set assignee_id = v_new_value::uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ASSIGNEE_CHANGED', 'assignee_id',
              case when v_old.assignee_id is null then to_jsonb(null::text) else to_jsonb(v_old.assignee_id::text) end,
              to_jsonb(v_new_value));
    end if;
  end if;
end;
$$;

revoke execute on function public.update_issue_fields(uuid, jsonb) from anon, public;
grant execute on function public.update_issue_fields(uuid, jsonb) to authenticated;

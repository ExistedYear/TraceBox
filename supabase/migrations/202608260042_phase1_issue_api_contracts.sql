-- Phase 1: keep browser and REST issue updates on one validated contract.
-- Body fields are nullable so clients can clear optional text. Every changed
-- field retains the existing per-field audit and updated_at trigger behavior.

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
  v_archived boolean;
  v_old record;
  v_new_title text;
  v_new_value text;
  v_new_uuid uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'object' or p_updates = '{}'::jsonb then
    raise exception 'VALIDATION: An update object with at least one supported field is required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_updates) as keys(update_key)
    where update_key not in (
      'title', 'description', 'environment', 'steps_to_reproduce',
      'expected_behavior', 'actual_behavior', 'priority', 'severity',
      'type', 'assignee_id', 'component_id'
    )
  ) then
    raise exception 'VALIDATION: Unsupported issue update field' using errcode = '22023';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock project first, then issue, matching the other issue mutation paths.
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  select * into v_old from public.issues where id = p_issue_id for update;

  if p_updates ? 'title' then
    if jsonb_typeof(p_updates->'title') <> 'string' then
      raise exception 'VALIDATION: Title must be text' using errcode = '22023';
    end if;
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

  if p_updates ? 'description' then
    if jsonb_typeof(p_updates->'description') not in ('string', 'null') then
      raise exception 'VALIDATION: Description must be text or null' using errcode = '22023';
    end if;
    v_new_value := nullif(trim(p_updates->>'description'), '');
    if v_new_value is not null and char_length(v_new_value) > 10000 then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.description then
      update public.issues set description = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'DESCRIPTION_CHANGED', 'description', to_jsonb(v_old.description), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'environment' then
    if jsonb_typeof(p_updates->'environment') not in ('string', 'null') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    v_new_value := nullif(trim(p_updates->>'environment'), '');
    if v_new_value is not null and char_length(v_new_value) > 2000 then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.environment then
      update public.issues set environment = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ENVIRONMENT_CHANGED', 'environment', to_jsonb(v_old.environment), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'steps_to_reproduce' then
    if jsonb_typeof(p_updates->'steps_to_reproduce') not in ('string', 'null') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    v_new_value := nullif(trim(p_updates->>'steps_to_reproduce'), '');
    if v_new_value is not null and char_length(v_new_value) > 5000 then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.steps_to_reproduce then
      update public.issues set steps_to_reproduce = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'STEPS_TO_REPRODUCE_CHANGED', 'steps_to_reproduce', to_jsonb(v_old.steps_to_reproduce), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'expected_behavior' then
    if jsonb_typeof(p_updates->'expected_behavior') not in ('string', 'null') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    v_new_value := nullif(trim(p_updates->>'expected_behavior'), '');
    if v_new_value is not null and char_length(v_new_value) > 5000 then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.expected_behavior then
      update public.issues set expected_behavior = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'EXPECTED_BEHAVIOR_CHANGED', 'expected_behavior', to_jsonb(v_old.expected_behavior), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'actual_behavior' then
    if jsonb_typeof(p_updates->'actual_behavior') not in ('string', 'null') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    v_new_value := nullif(trim(p_updates->>'actual_behavior'), '');
    if v_new_value is not null and char_length(v_new_value) > 5000 then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.actual_behavior then
      update public.issues set actual_behavior = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ACTUAL_BEHAVIOR_CHANGED', 'actual_behavior', to_jsonb(v_old.actual_behavior), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'priority' then
    if jsonb_typeof(p_updates->'priority') <> 'string' then raise exception 'VALIDATION: Priority must be text' using errcode = '22023'; end if;
    v_new_value := p_updates->>'priority';
    if v_new_value not in ('P0', 'P1', 'P2', 'P3', 'P4') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.priority then
      update public.issues set priority = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'PRIORITY_CHANGED', 'priority', to_jsonb(v_old.priority), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'severity' then
    if jsonb_typeof(p_updates->'severity') <> 'string' then raise exception 'VALIDATION: Severity must be text' using errcode = '22023'; end if;
    v_new_value := p_updates->>'severity';
    if v_new_value not in ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.severity then
      update public.issues set severity = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'SEVERITY_CHANGED', 'severity', to_jsonb(v_old.severity), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'type' then
    if jsonb_typeof(p_updates->'type') <> 'string' then raise exception 'VALIDATION: Type must be text' using errcode = '22023'; end if;
    v_new_value := p_updates->>'type';
    if v_new_value not in ('BUG', 'ENHANCEMENT', 'TASK', 'SECURITY', 'PERFORMANCE', 'REGRESSION') then raise exception 'VALIDATION' using errcode = '22023'; end if;
    if v_new_value is distinct from v_old.type then
      update public.issues set type = v_new_value where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'TYPE_CHANGED', 'type', to_jsonb(v_old.type), to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'component_id' then
    if jsonb_typeof(p_updates->'component_id') not in ('string', 'null') then raise exception 'VALIDATION: Component must be a UUID or null' using errcode = '22023'; end if;
    v_new_value := nullif(p_updates->>'component_id', '');
    v_new_uuid := null;
    if v_new_value is not null then
      begin v_new_uuid := v_new_value::uuid; exception when invalid_text_representation then raise exception 'VALIDATION: Component must be a UUID or null' using errcode = '22023'; end;
    end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.component_id::text, '') then
      if v_new_uuid is not null and not exists (select 1 from public.components c where c.id = v_new_uuid and c.project_id = v_project_id and not c.is_archived) then
        raise exception 'INVALID_COMPONENT' using errcode = '23503';
      end if;
      update public.issues set component_id = v_new_uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'COMPONENT_CHANGED', 'component_id', case when v_old.component_id is null then to_jsonb(null::text) else to_jsonb(v_old.component_id::text) end, to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'assignee_id' then
    if jsonb_typeof(p_updates->'assignee_id') not in ('string', 'null') then raise exception 'VALIDATION: Assignee must be a UUID or null' using errcode = '22023'; end if;
    v_new_value := nullif(p_updates->>'assignee_id', '');
    v_new_uuid := null;
    if v_new_value is not null then
      begin v_new_uuid := v_new_value::uuid; exception when invalid_text_representation then raise exception 'VALIDATION: Assignee must be a UUID or null' using errcode = '22023'; end;
    end if;
    if v_new_value is not null and not (
      exists (select 1 from public.project_members m where m.user_id = v_new_uuid and m.project_id = v_project_id)
      or exists (
        select 1 from public.projects p join public.organizations o on o.id = p.organization_id
        left join public.organization_members om on om.organization_id = o.id and om.user_id = v_new_uuid
        where p.id = v_project_id and (o.owner_id = v_new_uuid or om.role in ('OWNER', 'ADMIN'))
      )
    ) then raise exception 'INVALID_ASSIGNEE' using errcode = '23503'; end if;
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.assignee_id::text, '') then
      update public.issues set assignee_id = v_new_uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'ASSIGNEE_CHANGED', 'assignee_id', case when v_old.assignee_id is null then to_jsonb(null::text) else to_jsonb(v_old.assignee_id::text) end, to_jsonb(v_new_value));
    end if;
  end if;
end;
$$;

revoke execute on function public.update_issue_fields(uuid, jsonb) from anon, public;
grant execute on function public.update_issue_fields(uuid, jsonb) to authenticated;

-- Phase 4/5: complete issue mutation contracts.
--
-- The two-argument update_issue_fields contract remains available to existing
-- clients.  The checked overload is used by the editor so an active edit can
-- never silently overwrite a newer server version.

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
  v_key text;
  v_new_text text;
  v_old_text text;
  v_new_uuid uuid;
  v_old_json jsonb;
  v_new_json jsonb;
  v_event text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'object' or p_updates = '{}'::jsonb then
    raise exception 'VALIDATION: An update object with at least one supported field is required' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_updates) keys(update_key) where update_key not in (
    'title', 'description', 'environment', 'steps_to_reproduce', 'expected_behavior',
    'actual_behavior', 'priority', 'severity', 'type', 'assignee_id', 'component_id'
  )) then raise exception 'VALIDATION: Unsupported issue update field' using errcode = '22023'; end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  select i.* into v_old from public.issues i where i.id = p_issue_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') and v_old.reporter_id <> v_user then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  for v_key in select jsonb_object_keys(p_updates) loop
    v_new_text := nullif(trim(p_updates->>v_key), '');
    v_new_uuid := null;
    v_old_text := null;
    v_event := case v_key
      when 'title' then 'TITLE_CHANGED'
      when 'description' then 'DESCRIPTION_CHANGED'
      when 'environment' then 'ENVIRONMENT_CHANGED'
      when 'steps_to_reproduce' then 'STEPS_TO_REPRODUCE_CHANGED'
      when 'expected_behavior' then 'EXPECTED_BEHAVIOR_CHANGED'
      when 'actual_behavior' then 'ACTUAL_BEHAVIOR_CHANGED'
      when 'priority' then 'PRIORITY_CHANGED'
      when 'severity' then 'SEVERITY_CHANGED'
      when 'type' then 'TYPE_CHANGED'
      when 'component_id' then 'COMPONENT_CHANGED'
      when 'assignee_id' then 'ASSIGNEE_CHANGED'
    end;

    if v_key = 'title' then
      if jsonb_typeof(p_updates->v_key) <> 'string' or v_new_text is null or char_length(v_new_text) > 200 then raise exception 'VALIDATION: Title is required and must be at most 200 characters' using errcode = '22023'; end if;
      v_old_text := v_old.title;
    elsif v_key in ('description', 'environment', 'steps_to_reproduce', 'expected_behavior', 'actual_behavior') then
      if jsonb_typeof(p_updates->v_key) not in ('string', 'null') then raise exception 'VALIDATION: Body fields must be text or null' using errcode = '22023'; end if;
      if v_new_text is not null and char_length(v_new_text) > (case v_key when 'description' then 10000 when 'environment' then 2000 else 5000 end) then raise exception 'VALIDATION: Body field is too long' using errcode = '22023'; end if;
      v_old_text := case v_key when 'description' then v_old.description when 'environment' then v_old.environment when 'steps_to_reproduce' then v_old.steps_to_reproduce when 'expected_behavior' then v_old.expected_behavior when 'actual_behavior' then v_old.actual_behavior end;
    elsif v_key = 'priority' then
      if jsonb_typeof(p_updates->v_key) <> 'string' or v_new_text not in ('P0','P1','P2','P3','P4') then raise exception 'VALIDATION: Invalid priority' using errcode = '22023'; end if;
      v_old_text := v_old.priority;
    elsif v_key = 'severity' then
      if jsonb_typeof(p_updates->v_key) <> 'string' or v_new_text not in ('BLOCKER','CRITICAL','MAJOR','MINOR','TRIVIAL') then raise exception 'VALIDATION: Invalid severity' using errcode = '22023'; end if;
      v_old_text := v_old.severity;
    elsif v_key = 'type' then
      if jsonb_typeof(p_updates->v_key) <> 'string' or v_new_text not in ('BUG','ENHANCEMENT','TASK','SECURITY','PERFORMANCE','REGRESSION') then raise exception 'VALIDATION: Invalid issue type' using errcode = '22023'; end if;
      v_old_text := v_old.type;
    elsif v_key in ('component_id', 'assignee_id') then
      if jsonb_typeof(p_updates->v_key) not in ('string', 'null') then raise exception 'VALIDATION: User and component values must be UUIDs or null' using errcode = '22023'; end if;
      if v_new_text is not null then begin v_new_uuid := v_new_text::uuid; exception when invalid_text_representation then raise exception 'VALIDATION: Invalid UUID' using errcode = '22023'; end; end if;
      v_old_text := case v_key when 'component_id' then v_old.component_id::text when 'assignee_id' then v_old.assignee_id::text end;
      if v_key = 'component_id' and v_new_uuid is not null and not exists (select 1 from public.components c where c.id = v_new_uuid and c.project_id = v_project_id and not c.is_archived) then raise exception 'INVALID_COMPONENT' using errcode = '23503'; end if;
      if v_key = 'assignee_id' and v_new_uuid is not null and not (
        exists (select 1 from public.project_members m where m.project_id = v_project_id and m.user_id = v_new_uuid)
        or exists (select 1 from public.projects p join public.organizations o on o.id = p.organization_id left join public.organization_members om on om.organization_id = o.id and om.user_id = v_new_uuid where p.id = v_project_id and (o.owner_id = v_new_uuid or om.role in ('OWNER','ADMIN')))
      ) then raise exception 'INVALID_ASSIGNEE' using errcode = '23503'; end if;
    end if;

    v_old_json := to_jsonb(v_old_text);
    v_new_json := to_jsonb(v_new_text);
    if v_old_text is distinct from v_new_text then
      if v_key in ('component_id', 'assignee_id') then
        execute format('update public.issues set %I = $1 where id = $2', v_key) using v_new_uuid, p_issue_id;
      else
        execute format('update public.issues set %I = $1 where id = $2', v_key) using v_new_text, p_issue_id;
      end if;
      insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, v_event, v_key, v_old_json, v_new_json);
    end if;
  end loop;
end;
$$;

create or replace function public.update_issue_fields(
  p_issue_id uuid,
  p_updates jsonb,
  p_expected_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_current timestamptz; v_project_id uuid; v_archived boolean;
begin
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  select updated_at into v_current from public.issues where id = p_issue_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_expected_updated_at is not null and v_current <> p_expected_updated_at then
    raise exception 'CONFLICT: Issue changed since it was loaded' using errcode = '40001';
  end if;
  perform public.update_issue_fields(p_issue_id, p_updates);
end;
$$;

revoke execute on function public.update_issue_fields(uuid, jsonb), public.update_issue_fields(uuid, jsonb, timestamptz) from anon, public;
grant execute on function public.update_issue_fields(uuid, jsonb), public.update_issue_fields(uuid, jsonb, timestamptz) to authenticated;

-- Atomic browser/API creation contract.  Defaults, restricted grants, and
-- required custom values are committed with the issue or rolled back together.
create or replace function public.create_issue_complete(p_project_id uuid, p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid(); v_role text; v_archived boolean; v_number bigint; v_issue_id uuid;
  v_template record; v_field record; v_value jsonb; v_visibility text;
  v_template_body text; v_template_type text; v_template_priority text; v_template_severity text; v_template_component text;
  v_title text; v_description text; v_type text; v_priority text; v_severity text;
  v_component uuid; v_assignee uuid; v_json jsonb; v_initial_state uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('REPORTER','DEVELOPER','MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;

  if nullif(trim(p_payload->>'template_id'), '') is not null then
    select * into v_template from public.issue_templates t where t.id = (p_payload->>'template_id')::uuid and t.project_id = p_project_id;
    if not found then raise exception 'INVALID_TEMPLATE' using errcode = '23503'; end if;
    v_template_body := v_template.body_template;
    v_template_type := v_template.issue_type;
    v_template_priority := v_template.default_priority;
    v_template_severity := v_template.default_severity;
    v_template_component := v_template.default_component_id::text;
  end if;
  v_title := nullif(trim(coalesce(p_payload->>'title', '')), '');
  v_description := coalesce(nullif(trim(coalesce(p_payload->>'description', '')), ''), nullif(trim(coalesce(v_template_body, '')), ''));
  v_type := coalesce(nullif(p_payload->>'type',''), v_template_type, 'BUG');
  v_priority := coalesce(nullif(p_payload->>'priority',''), v_template_priority, 'P2');
  v_severity := coalesce(nullif(p_payload->>'severity',''), v_template_severity, 'MAJOR');
  if v_title is null or char_length(v_title) > 200 or v_description is null or char_length(v_description) > 10000 then raise exception 'VALIDATION: Title and description are required' using errcode = '22023'; end if;
  if v_type not in ('BUG','ENHANCEMENT','TASK','SECURITY','PERFORMANCE','REGRESSION') or v_priority not in ('P0','P1','P2','P3','P4') or v_severity not in ('BLOCKER','CRITICAL','MAJOR','MINOR','TRIVIAL') then raise exception 'VALIDATION: Invalid issue classification' using errcode = '22023'; end if;
  v_component := coalesce(nullif(p_payload->>'component_id', ''), v_template_component)::uuid;
  v_assignee := nullif(p_payload->>'assignee_id', '')::uuid;
  v_visibility := upper(coalesce(nullif(p_payload->>'visibility',''), 'PROJECT'));
  if v_visibility not in ('PROJECT','RESTRICTED') then raise exception 'VALIDATION: Invalid visibility' using errcode = '22023'; end if;
  if v_component is not null and not exists (select 1 from public.components c where c.id = v_component and c.project_id = p_project_id and not c.is_archived) then raise exception 'INVALID_COMPONENT' using errcode = '23503'; end if;
  if v_assignee is not null and not (
    exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = v_assignee)
    or exists (select 1 from public.projects p join public.organizations o on o.id = p.organization_id left join public.organization_members om on om.organization_id = o.id and om.user_id = v_assignee where p.id = p_project_id and (o.owner_id = v_assignee or om.role in ('OWNER','ADMIN')))
  ) then raise exception 'INVALID_ASSIGNEE' using errcode = '23503'; end if;
  -- Creation triggers read this transaction-local marker so restricted issues
  -- never emit a pre-grant notification as a project-visible issue.
  perform set_config('tracebox.issue_visibility', v_visibility, true);
  v_json := jsonb_build_object('title', v_title, 'type', v_type, 'description', v_description, 'component_id', v_component, 'priority', v_priority, 'severity', v_severity, 'assignee_id', v_assignee, 'environment', nullif(p_payload->>'environment',''), 'steps_to_reproduce', nullif(p_payload->>'steps_to_reproduce',''), 'expected_behavior', nullif(p_payload->>'expected_behavior',''), 'actual_behavior', nullif(p_payload->>'actual_behavior',''));
  select next_issue_number into v_number from public.projects where id = p_project_id for update;
  update public.projects set next_issue_number = v_number + 1 where id = p_project_id;
  select s.id into v_initial_state from public.workflow_states s where s.project_id = p_project_id order by s.is_initial desc, s.position limit 1;
  if v_initial_state is null then raise exception 'VALIDATION: Project has no initial workflow state' using errcode = '22023'; end if;
  insert into public.issues (
    project_id, issue_number, title, description, type, status_id, priority,
    severity, reporter_id, assignee_id, component_id, environment,
    steps_to_reproduce, expected_behavior, actual_behavior, visibility
  ) values (
    p_project_id, v_number, v_title, v_description, v_type, v_initial_state,
    v_priority, v_severity, v_user, v_assignee, v_component,
    nullif(trim(p_payload->>'environment'), ''), nullif(trim(p_payload->>'steps_to_reproduce'), ''),
    nullif(trim(p_payload->>'expected_behavior'), ''), nullif(trim(p_payload->>'actual_behavior'), ''), v_visibility
  ) returning id into v_issue_id;
  insert into public.issue_events(issue_id, actor_id, event_type, metadata)
  values (v_issue_id, v_user, 'ISSUE_CREATED', jsonb_build_object('title', v_title, 'type', v_type, 'priority', v_priority, 'severity', v_severity));

  if v_visibility = 'RESTRICTED' then
    if jsonb_typeof(p_payload->'access_user_ids') = 'array' then
      for v_json in select value from jsonb_array_elements(p_payload->'access_user_ids') loop
        if not exists (select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = (v_json #>> '{}')::uuid) and not exists (select 1 from public.organizations o join public.projects p on p.organization_id = o.id left join public.organization_members om on om.organization_id = o.id and om.user_id = (v_json #>> '{}')::uuid where p.id = p_project_id and (o.owner_id = (v_json #>> '{}')::uuid or om.role in ('OWNER','ADMIN'))) then raise exception 'INVALID_ACCESS_GRANT' using errcode = '23503'; end if;
        insert into public.issue_access(issue_id, user_id, granted_by) values (v_issue_id, (v_json #>> '{}')::uuid, v_user) on conflict do nothing;
      end loop;
    end if;
  end if;

  if jsonb_typeof(p_payload->'custom_values') = 'object' then
    for v_field in select * from public.custom_fields where project_id = p_project_id loop
      v_value := p_payload->'custom_values' -> v_field.id::text;
      if v_field.is_required and (v_value is null or v_value = 'null'::jsonb or v_value = '""'::jsonb or v_value = '[]'::jsonb) then raise exception 'VALIDATION: Required custom field is missing' using errcode = '22023'; end if;
      if v_value is not null and v_value <> 'null'::jsonb then
        if v_field.field_type in ('TEXT','SINGLE_SELECT','USER','DATE') and jsonb_typeof(v_value) <> 'string' then raise exception 'VALIDATION: Custom field must be text' using errcode = '22023'; end if;
        if v_field.field_type = 'NUMBER' and jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') ~ '^-?[0-9]+(\\.[0-9]+)?$' then v_value := to_jsonb((v_value #>> '{}')::numeric); end if;
        if v_field.field_type = 'NUMBER' and jsonb_typeof(v_value) <> 'number' then raise exception 'VALIDATION: Custom field must be numeric' using errcode = '22023'; end if;
        if v_field.field_type = 'BOOLEAN' and jsonb_typeof(v_value) = 'string' and lower(v_value #>> '{}') in ('true','false') then v_value := to_jsonb((v_value #>> '{}')::boolean); end if;
        if v_field.field_type = 'BOOLEAN' and jsonb_typeof(v_value) <> 'boolean' then raise exception 'VALIDATION: Custom field must be boolean' using errcode = '22023'; end if;
        if v_field.field_type = 'MULTI_SELECT' and jsonb_typeof(v_value) <> 'array' then raise exception 'VALIDATION: Custom field must be a list' using errcode = '22023'; end if;
        if v_field.field_type = 'SINGLE_SELECT' and jsonb_typeof(v_field.config->'options') = 'array' and not exists (select 1 from jsonb_array_elements_text(v_field.config->'options') as opts(option_value) where opts.option_value = v_value #>> '{}') then raise exception 'VALIDATION: Invalid custom field option' using errcode = '22023'; end if;
      end if;
      if v_value is not null and v_value <> 'null'::jsonb then insert into public.issue_custom_values(issue_id, custom_field_id, value) values (v_issue_id, v_field.id, v_value); end if;
    end loop;
  elsif exists (select 1 from public.custom_fields where project_id = p_project_id and is_required) then
    raise exception 'VALIDATION: Required custom field is missing' using errcode = '22023';
  end if;
  return v_number;
end;
$$;

revoke execute on function public.create_issue_complete(uuid, jsonb) from anon, public;
grant execute on function public.create_issue_complete(uuid, jsonb) to authenticated;

-- Keep the public REST create path on the same atomic contract as the browser.
create or replace function public.api_create_issue(p_token_hash text, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_token record; v_project_id uuid; v_org uuid; v_number bigint;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not (('write' = any(v_token.scopes)) or ('issues:write' = any(v_token.scopes))) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_project_id := nullif(p_payload->>'project_id', '')::uuid;
  select organization_id into v_org from public.projects where id = v_project_id and not is_archived;
  if v_org is null or v_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  v_number := public.create_issue_complete(v_project_id, p_payload);
  perform public.touch_api_token(p_token_hash);
  return v_number::integer;
end;
$$;
revoke execute on function public.api_create_issue(text, jsonb) from anon, public;
grant execute on function public.api_create_issue(text, jsonb) to authenticated, service_role;

-- The issue-created trigger still auto-watches the reporter and assignee, but
-- suppresses the initial assignee notification while a restricted issue is
-- being created. Subsequent notifications are guarded by issue visibility.
create or replace function public.on_issue_created_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.issue_watchers(issue_id, user_id) values (new.id, new.reporter_id) on conflict do nothing;
  if new.assignee_id is not null then
    insert into public.issue_watchers(issue_id, user_id) values (new.id, new.assignee_id) on conflict do nothing;
    if coalesce(current_setting('tracebox.issue_visibility', true), 'PROJECT') <> 'RESTRICTED' then
      perform public.dispatch_issue_notification(new.assignee_id, new.reporter_id, new.id, 'ASSIGNED', jsonb_build_object('title', new.title, 'issue_number', new.issue_number));
    end if;
  end if;
  return new;
end;
$$;

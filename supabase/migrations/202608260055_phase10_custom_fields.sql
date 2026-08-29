-- Phase 10: complete custom-field lifecycle and authoritative value validation.
-- All writes remain RPC-only; field types are immutable once values exist.

revoke insert, update, delete on public.custom_fields, public.issue_custom_values from authenticated, anon, public;

create or replace function public.validate_custom_field_definition(
  p_field_type text,
  p_config jsonb
)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_options jsonb := coalesce(p_config, '{}'::jsonb)->'options';
begin
  if p_field_type not in ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'USER') then
    raise exception 'VALIDATION: Invalid custom field type' using errcode = '22023';
  end if;
  if p_field_type in ('SINGLE_SELECT', 'MULTI_SELECT') then
    if jsonb_typeof(v_options) <> 'array' or jsonb_array_length(v_options) = 0
       or exists (select 1 from jsonb_array_elements(v_options) option where jsonb_typeof(option) <> 'string' or nullif(trim(option #>> '{}'), '') is null)
       or jsonb_array_length(v_options) <> (select count(distinct option #>> '{}') from jsonb_array_elements(v_options) option) then
      raise exception 'VALIDATION: Select fields require unique non-empty options' using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function public.validate_custom_field_value(
  p_field_id uuid,
  p_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_field record;
  v_item jsonb;
  v_user uuid := auth.uid();
begin
  select * into v_field from public.custom_fields where id = p_field_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_value is null or jsonb_typeof(p_value) = 'null' or p_value = '""'::jsonb or p_value = '[]'::jsonb then
    if v_field.is_required then raise exception 'VALIDATION: Required custom field cannot be empty' using errcode = '22023'; end if;
    return;
  end if;
  if (v_field.field_type in ('TEXT', 'DATE', 'SINGLE_SELECT', 'USER') and jsonb_typeof(p_value) <> 'string')
     or (v_field.field_type = 'NUMBER' and jsonb_typeof(p_value) <> 'number')
     or (v_field.field_type = 'BOOLEAN' and jsonb_typeof(p_value) <> 'boolean')
     or (v_field.field_type = 'MULTI_SELECT' and jsonb_typeof(p_value) <> 'array') then
    raise exception 'VALIDATION: Custom field value has the wrong type' using errcode = '22023';
  end if;
  if v_field.field_type = 'DATE' then
    begin perform trim(both '"' from p_value::text)::date; exception when others then raise exception 'VALIDATION: Invalid date value' using errcode = '22023'; end;
  elsif v_field.field_type = 'USER' then
    begin
      if not exists (select 1 from public.project_members pm where pm.project_id = v_field.project_id and pm.user_id = trim(both '"' from p_value::text)::uuid)
         and not exists (
           select 1 from public.projects p
           join public.organization_members om on om.organization_id = p.organization_id
          where p.id = v_field.project_id
            and om.user_id = trim(both '"' from p_value::text)::uuid
            and om.role in ('OWNER', 'ADMIN')
         ) then
        raise exception 'VALIDATION: User must be a project member or workspace owner/admin' using errcode = '22023';
      end if;
    exception when invalid_text_representation then raise exception 'VALIDATION: Invalid user value' using errcode = '22023';
    end;
  elsif v_field.field_type = 'SINGLE_SELECT' and not (v_field.config->'options' @> jsonb_build_array(trim(both '"' from p_value::text))) then
    raise exception 'VALIDATION: Invalid select option' using errcode = '22023';
  elsif v_field.field_type = 'MULTI_SELECT' then
    for v_item in select value from jsonb_array_elements(p_value) loop
      if jsonb_typeof(v_item) <> 'string' or not (v_field.config->'options' @> jsonb_build_array(trim(both '"' from v_item::text))) then
        raise exception 'VALIDATION: Invalid multi-select option' using errcode = '22023';
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.validate_custom_field_definition_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := nullif(trim(new.name), '');
  if new.name is null or char_length(new.name) > 80 then
    raise exception 'VALIDATION: Custom field name must be 1-80 characters' using errcode = '22023';
  end if;
  perform public.validate_custom_field_definition(new.field_type, coalesce(new.config, '{}'::jsonb));
  return new;
end;
$$;

drop trigger if exists validate_custom_field_definition on public.custom_fields;
create trigger validate_custom_field_definition
before insert or update on public.custom_fields
for each row execute function public.validate_custom_field_definition_trigger();

create or replace function public.update_custom_field(
  p_field_id uuid,
  p_name text,
  p_field_type text,
  p_config jsonb default '{}'::jsonb,
  p_is_required boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_field record;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_name is null or char_length(v_name) > 80 then raise exception 'VALIDATION: Custom field name must be 1-80 characters' using errcode = '22023'; end if;
  perform public.validate_custom_field_definition(p_field_type, p_config);
  select cf.*, p.is_archived into v_field from public.custom_fields cf join public.projects p on p.id = cf.project_id where cf.id = p_field_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_field.is_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if public.project_role(v_field.project_id) <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_field_type <> v_field.field_type and exists (select 1 from public.issue_custom_values where custom_field_id = p_field_id) then
    raise exception 'VALIDATION: Cannot change field type after values exist; clear values first' using errcode = '22023';
  end if;
  if p_field_type in ('SINGLE_SELECT', 'MULTI_SELECT') and exists (
    select 1 from public.issue_custom_values cv
    where cv.custom_field_id = p_field_id
      and ((p_field_type = 'SINGLE_SELECT' and jsonb_typeof(cv.value) = 'string' and not (coalesce(p_config, '{}'::jsonb)->'options' @> jsonb_build_array(trim(both '"' from cv.value::text))))
        or (p_field_type = 'MULTI_SELECT' and jsonb_typeof(cv.value) = 'array' and exists (select 1 from jsonb_array_elements_text(cv.value) item where not (coalesce(p_config, '{}'::jsonb)->'options' @> jsonb_build_array(item)))))
  ) then
    raise exception 'VALIDATION: Existing values use an option that would be removed' using errcode = '22023';
  end if;
  update public.custom_fields set name = v_name, field_type = p_field_type, config = coalesce(p_config, '{}'::jsonb), is_required = coalesce(p_is_required, false) where id = p_field_id;
end; $$;

create or replace function public.bulk_set_issue_custom_value(p_issue_ids uuid[], p_custom_field_id uuid, p_value jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_issue_id uuid; v_count integer := 0; v_project_id uuid; v_archived boolean; v_old_value jsonb; v_requested integer; v_locked integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_requested := coalesce(array_length(p_issue_ids, 1), 0);
  if v_requested = 0 or v_requested > 100 then raise exception 'VALIDATION: Select between 1 and 100 issues' using errcode = '22023'; end if;
  select project_id into v_project_id from public.custom_fields where id = p_custom_field_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived or public.project_role(v_project_id) not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_requested <> (select count(distinct issue_id) from unnest(p_issue_ids) as requested(issue_id)) then raise exception 'VALIDATION: Duplicate issue IDs are not allowed' using errcode = '22023'; end if;
  select count(*) into v_locked from public.issues i where i.id = any(p_issue_ids) and i.project_id = v_project_id and public.can_view_issue(i.id);
  if v_locked <> v_requested then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform 1 from public.issues i where i.id = any(p_issue_ids) and i.project_id = v_project_id order by i.id for update;
  perform public.validate_custom_field_value(p_custom_field_id, p_value);
  foreach v_issue_id in array p_issue_ids loop
    if not exists (select 1 from public.issues where id = v_issue_id and project_id = v_project_id and public.can_view_issue(id)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
    select value into v_old_value from public.issue_custom_values where issue_id = v_issue_id and custom_field_id = p_custom_field_id;
    if p_value is null or jsonb_typeof(p_value) = 'null' or p_value = '""'::jsonb or p_value = '[]'::jsonb then
      delete from public.issue_custom_values where issue_id = v_issue_id and custom_field_id = p_custom_field_id;
    else
      insert into public.issue_custom_values(issue_id, custom_field_id, value) values (v_issue_id, p_custom_field_id, p_value) on conflict (issue_id, custom_field_id) do update set value = excluded.value;
    end if;
    update public.issues set updated_at = now() where id = v_issue_id;
    insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
    values (v_issue_id, auth.uid(), 'CUSTOM_FIELD_UPDATED', 'custom_field', v_old_value, nullif(p_value, 'null'::jsonb), jsonb_build_object('custom_field_id', p_custom_field_id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;

create or replace function public.validate_issue_custom_value_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.validate_custom_field_value(new.custom_field_id, new.value);
  if not exists (select 1 from public.issues i join public.custom_fields cf on cf.project_id = i.project_id where i.id = new.issue_id and cf.id = new.custom_field_id) then
    raise exception 'VALIDATION: Custom field does not belong to this project' using errcode = '23503';
  end if;
  return new;
end; $$;

drop trigger if exists validate_issue_custom_value on public.issue_custom_values;
create trigger validate_issue_custom_value
before insert or update on public.issue_custom_values
for each row execute function public.validate_issue_custom_value_trigger();

create or replace function public.set_issue_custom_value(p_issue_id uuid, p_custom_field_id uuid, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_archived boolean; v_old_value jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if public.project_role(v_project_id) not in ('DEVELOPER', 'MAINTAINER') or not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if not exists (select 1 from public.custom_fields where id = p_custom_field_id and project_id = v_project_id) then raise exception 'VALIDATION: Custom field does not belong to this project' using errcode = '23503'; end if;
  perform public.validate_custom_field_value(p_custom_field_id, p_value);
  select value into v_old_value from public.issue_custom_values where issue_id = p_issue_id and custom_field_id = p_custom_field_id;
  if p_value is null or jsonb_typeof(p_value) = 'null' or p_value = '""'::jsonb or p_value = '[]'::jsonb then
    delete from public.issue_custom_values where issue_id = p_issue_id and custom_field_id = p_custom_field_id;
  else
    insert into public.issue_custom_values(issue_id, custom_field_id, value) values (p_issue_id, p_custom_field_id, p_value)
    on conflict (issue_id, custom_field_id) do update set value = excluded.value;
  end if;
  update public.issues set updated_at = now() where id = p_issue_id;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (p_issue_id, auth.uid(), 'CUSTOM_FIELD_UPDATED', 'custom_field', v_old_value, nullif(p_value, 'null'::jsonb), jsonb_build_object('custom_field_id', p_custom_field_id));
end; $$;

revoke execute on function public.validate_custom_field_definition(text, jsonb), public.validate_custom_field_value(uuid, jsonb), public.update_custom_field(uuid, text, text, jsonb, boolean), public.bulk_set_issue_custom_value(uuid[], uuid, jsonb) from public, anon;
revoke execute on function public.set_issue_custom_value(uuid, uuid, jsonb) from public, anon;
grant execute on function public.update_custom_field(uuid, text, text, jsonb, boolean), public.bulk_set_issue_custom_value(uuid[], uuid, jsonb), public.set_issue_custom_value(uuid, uuid, jsonb) to authenticated;

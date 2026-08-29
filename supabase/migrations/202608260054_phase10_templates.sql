-- Phase 10: complete issue-template lifecycle and safe template application.

alter table public.issue_templates
  add column if not exists is_archived boolean not null default false;

create index if not exists issue_templates_project_active_idx
  on public.issue_templates (project_id, is_archived, name);

create table if not exists public.issue_template_labels (
  template_id uuid not null references public.issue_templates(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  primary key (template_id, label_id)
);
create index if not exists issue_template_labels_label_idx on public.issue_template_labels(label_id);
alter table public.issue_template_labels enable row level security;
create policy "Project members can read issue template labels"
  on public.issue_template_labels for select to authenticated
  using (exists (select 1 from public.issue_templates t where t.id = template_id and public.is_project_member(t.project_id)));

create or replace function public.validate_issue_template_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.is_archived and new.default_component_id is not null and not exists (
    select 1 from public.components c where c.id = new.default_component_id
      and c.project_id = new.project_id and not c.is_archived
  ) then
    raise exception 'INVALID_COMPONENT' using errcode = '23503';
  end if;
  if new.default_priority is not null and new.default_priority not in ('P0','P1','P2','P3','P4') then
    raise exception 'VALIDATION: Invalid template priority' using errcode = '22023';
  end if;
  if new.default_severity is not null and new.default_severity not in ('BLOCKER','CRITICAL','MAJOR','MINOR','TRIVIAL') then
    raise exception 'VALIDATION: Invalid template severity' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists issue_templates_validate_defaults on public.issue_templates;
create trigger issue_templates_validate_defaults before insert or update on public.issue_templates
for each row execute procedure public.validate_issue_template_defaults();

-- Keep the established function contract while applying template labels in the
-- same transaction. The old implementation is retained as a private base.
alter function public.create_issue_complete(uuid, jsonb) rename to create_issue_complete_base;
create or replace function public.create_issue_complete(p_project_id uuid, p_payload jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_number bigint;
  v_issue_id uuid;
  v_template_id uuid := nullif(p_payload->>'template_id', '')::uuid;
  v_template public.issue_templates%rowtype;
  v_key text;
  v_field_id uuid;
begin
  if p_payload ? 'custom_values' and jsonb_typeof(p_payload->'custom_values') <> 'object' then
    raise exception 'VALIDATION: Custom values must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'custom_values') = 'object' then
    for v_key in select jsonb_object_keys(p_payload->'custom_values') loop
      begin v_field_id := v_key::uuid;
      exception when invalid_text_representation then
        raise exception 'VALIDATION: Custom field id must be a UUID' using errcode = '22023';
      end;
      if not exists (select 1 from public.custom_fields f where f.id = v_field_id and f.project_id = p_project_id) then
        raise exception 'VALIDATION: Custom field does not belong to this project' using errcode = '22023';
      end if;
    end loop;
  end if;
  if v_template_id is not null then
    select * into v_template from public.issue_templates t
    where t.id = v_template_id and t.project_id = p_project_id and not t.is_archived
    for key share;
  end if;
  if v_template_id is not null and not found then
    raise exception 'INVALID_TEMPLATE' using errcode = '23503';
  end if;
  v_number := public.create_issue_complete_base(p_project_id, p_payload);
  if v_template_id is not null then
    select id into v_issue_id from public.issues where project_id = p_project_id and issue_number = v_number;
    insert into public.issue_labels(issue_id, label_id)
    select v_issue_id, tl.label_id
    from public.issue_template_labels tl
    join public.labels l on l.id = tl.label_id and l.project_id = p_project_id
    where tl.template_id = v_template_id
    on conflict do nothing;
  end if;
  return v_number;
end;
$$;
revoke execute on function public.create_issue_complete_base(uuid, jsonb) from anon, public, authenticated;
revoke execute on function public.create_issue_complete(uuid, jsonb) from anon, public;
grant execute on function public.create_issue_complete(uuid, jsonb) to authenticated;

create or replace function public.set_issue_template_labels(p_template_id uuid, p_label_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_archived boolean;
begin
  select project_id, is_archived into v_project_id, v_archived from public.issue_templates where id = p_template_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'TEMPLATE_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_manage_project(v_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if exists (select 1 from unnest(coalesce(p_label_ids, '{}'::uuid[])) x(id) where not exists (select 1 from public.labels l where l.id = x.id and l.project_id = v_project_id)) then
    raise exception 'INVALID_LABEL' using errcode = '23503';
  end if;
  delete from public.issue_template_labels where template_id = p_template_id;
  insert into public.issue_template_labels(template_id, label_id)
  select p_template_id, x.id from unnest(coalesce(p_label_ids, '{}'::uuid[])) x(id) on conflict do nothing;
end;
$$;

create or replace function public.set_issue_template_archived(p_template_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_project_id uuid;
begin
  select project_id into v_project_id from public.issue_templates where id = p_template_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_project(v_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.issue_templates set is_archived = coalesce(p_archived, false) where id = p_template_id;
end;
$$;

create or replace function public.duplicate_issue_template(p_template_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_source public.issue_templates%rowtype; v_id uuid; v_name text;
begin
  select * into v_source from public.issue_templates where id = p_template_id for key share;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_project(v_source.project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_name := nullif(trim(p_name), '');
  if v_name is null or char_length(v_name) > 80 then raise exception 'VALIDATION: Template name is required' using errcode = '22023'; end if;
  insert into public.issue_templates(project_id, name, description, issue_type, body_template, default_priority, default_severity, default_component_id, created_by)
  values (v_source.project_id, v_name, v_source.description, v_source.issue_type, v_source.body_template, v_source.default_priority, v_source.default_severity, v_source.default_component_id, auth.uid()) returning id into v_id;
  insert into public.issue_template_labels(template_id, label_id) select v_id, label_id from public.issue_template_labels where template_id = p_template_id;
  return v_id;
end;
$$;

create or replace function public.create_issue_template_complete(
  p_project_id uuid, p_name text, p_description text, p_issue_type text,
  p_body_template text, p_default_priority text, p_default_severity text,
  p_default_component_id uuid, p_label_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := public.create_issue_template(p_project_id, p_name, p_description, p_issue_type, p_body_template, p_default_priority, p_default_severity, p_default_component_id);
  perform public.set_issue_template_labels(v_id, p_label_ids);
  return v_id;
end;
$$;

create or replace function public.update_issue_template_complete(
  p_template_id uuid, p_name text, p_description text, p_issue_type text,
  p_body_template text, p_default_priority text, p_default_severity text,
  p_default_component_id uuid, p_label_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public.update_issue_template(p_template_id, p_name, p_description, p_issue_type, p_body_template, p_default_priority, p_default_severity, p_default_component_id);
  perform public.set_issue_template_labels(p_template_id, p_label_ids);
  return p_template_id;
end;
$$;

revoke execute on function public.set_issue_template_labels(uuid, uuid[]) from anon, public;
revoke execute on function public.set_issue_template_archived(uuid, boolean) from anon, public;
revoke execute on function public.duplicate_issue_template(uuid, text) from anon, public;
grant execute on function public.set_issue_template_labels(uuid, uuid[]) to authenticated;
grant execute on function public.set_issue_template_archived(uuid, boolean) to authenticated;
grant execute on function public.duplicate_issue_template(uuid, text) to authenticated;
revoke execute on function public.create_issue_template_complete(uuid, text, text, text, text, text, text, uuid, uuid[]) from anon, public;
revoke execute on function public.update_issue_template_complete(uuid, text, text, text, text, text, text, uuid, uuid[]) from anon, public;
grant execute on function public.create_issue_template_complete(uuid, text, text, text, text, text, text, uuid, uuid[]) to authenticated;
grant execute on function public.update_issue_template_complete(uuid, text, text, text, text, text, text, uuid, uuid[]) to authenticated;

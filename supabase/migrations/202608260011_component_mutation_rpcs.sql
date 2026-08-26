-- Serialize component writes with issue writes: both lock the project row first,
-- then mutate a component. This prevents component archival/assignment deadlocks
-- and keeps archived projects fully read-only.

drop policy if exists "Maintainers manage components" on public.components;
drop policy if exists "Maintainers update components" on public.components;

create or replace function public.create_component(
  p_project_id uuid,
  p_name text,
  p_description text default null,
  p_default_assignee_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_archived boolean;
  v_component_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = p_project_id
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.components (project_id, name, description, default_assignee_id)
  values (p_project_id, p_name, nullif(trim(coalesce(p_description, '')), ''), p_default_assignee_id)
  returning id into v_component_id;
  return v_component_id;
end;
$$;

create or replace function public.update_component(
  p_component_id uuid,
  p_name text,
  p_description text default null,
  p_default_assignee_id uuid default null,
  p_is_archived boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select c.project_id into v_project_id
  from public.components c
  where c.id = p_component_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock after the project row, matching create_issue/update_issue_fields.
  perform 1 from public.components c where c.id = p_component_id for update;
  update public.components
  set name = p_name,
      description = nullif(trim(coalesce(p_description, '')), ''),
      default_assignee_id = p_default_assignee_id,
      is_archived = p_is_archived
  where id = p_component_id;
end;
$$;

revoke execute on function public.create_component(uuid, text, text, uuid), public.update_component(uuid, text, text, uuid, boolean) from anon, public;
grant execute on function public.create_component(uuid, text, text, uuid), public.update_component(uuid, text, text, uuid, boolean) to authenticated;

-- Migration 013: Security & Role Refinements
-- 1. project_role: Org Admins unconditionally have MAINTAINER permissions.
-- 2. edit_comment: Authors must still hold REPORTER+ role to edit past comments.
-- 3. create_issue / create_component: Trim and validate titles and component names.
-- 4. validate_component_assignment: Permit service_role / postgres maintenance context.

create or replace function public.project_role(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_org_admin(
      (select p.organization_id from public.projects p where p.id = p_project_id)
    ) then 'MAINTAINER'
    else (
      select m.role from public.project_members m
      where m.project_id = p_project_id and m.user_id = auth.uid()
      limit 1
    )
  end;
$$;

create or replace function public.create_issue(
  p_project_id uuid,
  p_title text,
  p_type text,
  p_description text default null,
  p_component_id uuid default null,
  p_priority text default 'P2',
  p_severity text default 'MAJOR',
  p_assignee_id uuid default null,
  p_environment text default null,
  p_steps_to_reproduce text default null,
  p_expected_behavior text default null,
  p_actual_behavior text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_number bigint;
  v_archived boolean;
  v_issue_id uuid;
  v_initial_state uuid;
  v_title text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null or char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  v_role := public.project_role(p_project_id);
  if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select next_issue_number, is_archived
  into v_number, v_archived
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  if p_component_id is not null and not exists (
    select 1 from public.components c
    where c.id = p_component_id and c.project_id = p_project_id and not c.is_archived
  ) then
    raise exception 'INVALID_COMPONENT' using errcode = '23503';
  end if;

  if p_assignee_id is not null and not (
    exists (
      select 1 from public.project_members m
      where m.user_id = p_assignee_id and m.project_id = p_project_id
    )
    or exists (
      select 1
      from public.projects p
      join public.organizations o on o.id = p.organization_id
      left join public.organization_members om
        on om.organization_id = o.id and om.user_id = p_assignee_id
      where p.id = p_project_id
        and (o.owner_id = p_assignee_id or om.role in ('OWNER', 'ADMIN'))
    )
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
  end if;

  update public.projects
  set next_issue_number = v_number + 1
  where id = p_project_id;

  select s.id into v_initial_state
  from public.workflow_states s
  where s.project_id = p_project_id
  order by s.is_initial desc, s.position
  limit 1;

  insert into public.issues (
    project_id, issue_number, title, description, type, status_id,
    priority, severity, reporter_id, assignee_id, component_id,
    environment, steps_to_reproduce, expected_behavior, actual_behavior
  ) values (
    p_project_id, v_number, v_title, nullif(trim(coalesce(p_description, '')), ''), p_type, v_initial_state,
    coalesce(p_priority, 'P2'), coalesce(p_severity, 'MAJOR'), v_user,
    p_assignee_id, p_component_id,
    nullif(p_environment, ''), nullif(p_steps_to_reproduce, ''),
    nullif(p_expected_behavior, ''), nullif(p_actual_behavior, '')
  )
  returning id into v_issue_id;

  insert into public.issue_events (issue_id, actor_id, event_type, metadata)
  values (
    v_issue_id,
    v_user,
    'ISSUE_CREATED',
    jsonb_build_object('title', v_title, 'type', p_type, 'priority', coalesce(p_priority, 'P2'), 'severity', coalesce(p_severity, 'MAJOR'))
  );

  return v_number;
end;
$$;

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
  v_name text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION' using errcode = '22023';
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
  values (p_project_id, v_name, nullif(trim(coalesce(p_description, '')), ''), p_default_assignee_id)
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
  v_name text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION' using errcode = '22023';
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

  perform 1 from public.components c where c.id = p_component_id for update;
  update public.components
  set name = v_name,
      description = nullif(trim(coalesce(p_description, '')), ''),
      default_assignee_id = p_default_assignee_id,
      is_archived = p_is_archived
  where id = p_component_id;
end;
$$;

create or replace function public.edit_comment(p_comment_id uuid, p_body text)
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
  v_body text;
  v_old record;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null or char_length(v_body) < 1 or char_length(v_body) > 10000 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  select * into v_old from public.comments where id = p_comment_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_body = v_old.body then
    return;
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = v_old.issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

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
  if v_old.author_id = v_user then
    if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  else
    if v_role not in ('DEVELOPER', 'MAINTAINER') then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;

  perform 1 from public.comments where id = p_comment_id for update;
  update public.comments
  set body = v_body,
      edited_at = timezone('utc'::text, now())
  where id = p_comment_id;

  update public.issues set updated_at = timezone('utc'::text, now()) where id = v_old.issue_id;

  insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (
    v_old.issue_id,
    v_user,
    'COMMENT_EDITED',
    'comment_id',
    to_jsonb(v_old.id::text),
    to_jsonb(v_body),
    jsonb_build_object('comment_id', v_old.id, 'excerpt', left(v_body, 200))
  );
end;
$$;

create or replace function public.validate_component_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived boolean;
begin
  -- Permit service role / background maintenance scripts where auth.uid() is null
  if auth.uid() is null then
    return new;
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = new.project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  if new.default_assignee_id is not null and not (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = new.project_id and pm.user_id = new.default_assignee_id
    )
    or exists (
      select 1
      from public.projects p
      join public.organizations o on o.id = p.organization_id
      left join public.organization_members om
        on om.organization_id = o.id and om.user_id = new.default_assignee_id
      where p.id = new.project_id
        and (o.owner_id = new.default_assignee_id or om.role in ('OWNER', 'ADMIN'))
    )
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
  end if;

  return new;
end;
$$;

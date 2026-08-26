-- Round-3 refinements: race-free archival checks, candidate-scoped assignee
-- eligibility, no-op-safe component updates, and component column hardening.
-- Lock ordering is uniformly project-row first, then issue row.

-- R3-SQL-003: prevent relocating a component across projects (dual-maintainer
-- move would silently break issue↔component coupling and leak names).
revoke update on public.components from anon, authenticated, public;
grant update (name, description, default_assignee_id, is_archived) on public.components to authenticated;

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
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_role := public.project_role(p_project_id);
  if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Single locked read closes the archive-vs-write race window.
  select next_issue_number, is_archived
  into v_number, v_archived
  from public.projects
  where id = p_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  if p_component_id is not null and not exists (
    select 1 from public.components c
    where c.id = p_component_id and c.project_id = p_project_id and not c.is_archived
  ) then
    raise exception 'INVALID_COMPONENT' using errcode = '23503';
  end if;

  -- Assignee eligibility is a property of the CANDIDATE: explicit membership
  -- or an implicit MAINTAINER via organization ownership/admin.
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
    p_project_id, v_number, p_title, nullif(trim(coalesce(p_description, '')), ''), p_type, v_initial_state,
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
    jsonb_build_object('title', p_title, 'type', p_type, 'priority', coalesce(p_priority, 'P2'), 'severity', coalesce(p_severity, 'MAJOR'))
  );

  return v_number;
end;
$$;

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

  -- Lock project first (consistent order), then the issue row, so archival is
  -- evaluated under the same serialization as every other write.
  select is_archived into v_archived
  from public.projects
  where id = v_project_id
  for update;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  select * into v_old from public.issues where id = p_issue_id for update;

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
    -- No-op detection first so re-confirming an already-attached (possibly
    -- since-archived) component never errors.
    if coalesce(v_new_value, '') is distinct from coalesce(v_old.component_id::text, '') then
      if v_new_value is not null and not exists (
        select 1 from public.components c
        where c.id = v_new_value::uuid and c.project_id = v_project_id and not c.is_archived
      ) then
        raise exception 'INVALID_COMPONENT' using errcode = '23503';
      end if;
      update public.issues set component_id = v_new_value::uuid where id = p_issue_id;
      insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
      values (p_issue_id, v_user, 'COMPONENT_CHANGED', 'component_id',
              case when v_old.component_id is null then to_jsonb(null::text) else to_jsonb(v_old.component_id::text) end,
              to_jsonb(v_new_value));
    end if;
  end if;

  if p_updates ? 'assignee_id' then
    v_new_value := nullif(p_updates->>'assignee_id', '');
    if v_new_value is not null and not (
      exists (
        select 1 from public.project_members m
        where m.user_id = v_new_value::uuid and m.project_id = v_project_id
      )
      or exists (
        select 1
        from public.projects p
        join public.organizations o on o.id = p.organization_id
        left join public.organization_members om
          on om.organization_id = o.id and om.user_id = v_new_value::uuid
        where p.id = v_project_id
          and (o.owner_id = v_new_value::uuid or om.role in ('OWNER', 'ADMIN'))
      )
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

-- Components are archive-only and their default assignee must belong to the
-- same project or be an owner/admin of its organization.
create or replace function public.validate_component_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.is_archived
  ) then
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

revoke execute on function public.validate_component_assignment() from anon, public;
grant execute on function public.validate_component_assignment() to authenticated;

drop trigger if exists components_validate_assignment on public.components;
create trigger components_validate_assignment
before insert or update on public.components
for each row execute procedure public.validate_component_assignment();

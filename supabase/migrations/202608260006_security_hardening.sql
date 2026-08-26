-- Security & integrity hardening from the phase-4 audit.
-- Strategy: clients mutate rows only through trusted RPCs; direct table writes
-- are narrowed to safe columns; ownership truth is unified on owner_id + roles;
-- destructive cascades become restricted deletes requiring explicit offboarding.

-- SQL-001: direct issue inserts bypassed counter allocation (number squatting
-- could permanently brick create_issue) and skipped the audit event.
drop policy if exists "Reporters and above can file issues" on public.issues;

-- SQL-002/006: one deleted account must never wipe a multi-user workspace, and
-- account deletion must not silently fail either. Ownership/history references
-- become RESTRICT: offboarding requires an explicit transfer flow.
alter table public.organizations
  drop constraint organizations_owner_id_fkey;
alter table public.organizations
  add constraint organizations_owner_id_fkey
  foreign key (owner_id) references public.profiles (id) on delete restrict;

alter table public.projects
  drop constraint projects_created_by_fkey;
alter table public.projects
  add constraint projects_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete restrict;

alter table public.issues
  drop constraint issues_reporter_id_fkey;
alter table public.issues
  add constraint issues_reporter_id_fkey
  foreign key (reporter_id) references public.profiles (id) on delete restrict;

-- SQL-003/004: row policies cannot protect individual columns. Strip UPDATE
-- from authenticated wholesale, then re-grant only safe columns. The definer
-- RPCs run as the migration owner and are unaffected.
revoke update on public.organizations from anon, authenticated, public;
grant update (name, slug) on public.organizations to authenticated;

revoke update on public.projects from anon, authenticated, public;
grant update (name, slug, description, is_archived) on public.projects to authenticated;

-- SQL-005/009: unify authorization helpers. project_role must resolve the org
-- through projects before consulting is_org_admin, and is_org_admin must honor
-- organizations.owner_id exactly like is_org_member does.
create or replace function public.project_role(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select m.role from public.project_members m
      where m.project_id = p_project_id and m.user_id = auth.uid()
      limit 1
    ),
    case when public.is_org_admin(
      (select p.organization_id from public.projects p where p.id = p_project_id)
    ) then 'MAINTAINER' end
  );
$$;

create or replace function public.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_organization_id is not null and (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = p_organization_id
        and m.user_id = auth.uid()
        and m.role in ('OWNER', 'ADMIN')
    )
    or exists (
      select 1 from public.organizations o
      where o.id = p_organization_id and o.owner_id = auth.uid()
    )
  );
$$;

-- SQL-011: serialize audit capture with the field writes so old/new pairs are
-- always consistent under concurrent edits.
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

-- SQL-007: creation path must enforce the same assignee-membership rule as the
-- edit path. (Full function re-declaration keeps the diff reviewable.)
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

  if p_component_id is not null and not exists (
    select 1 from public.components c
    where c.id = p_component_id and c.project_id = p_project_id and not c.is_archived
  ) then
    raise exception 'INVALID_COMPONENT' using errcode = '23503';
  end if;

  if p_assignee_id is not null and not exists (
    select 1 from public.project_members m
    where m.user_id = p_assignee_id and m.project_id = p_project_id
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
  end if;

  select p.next_issue_number into v_number
  from public.projects p
  where p.id = p_project_id
  for update;

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

-- SQL-008: unique(project_id, issue_number) already backs an identical index.
drop index if exists public.issues_project_number_idx;

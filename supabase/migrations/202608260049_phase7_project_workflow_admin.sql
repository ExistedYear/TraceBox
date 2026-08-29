-- Phase 7 completion: RPC-only project metadata/lifecycle management and
-- atomic workflow graph publishing. Project keys are intentionally immutable.

alter table public.workflow_transitions
  add column if not exists requires_resolution boolean not null default false;

update public.workflow_transitions wt
set requires_resolution = true
from public.workflow_states target
where target.id = wt.to_state_id
  and target.category in ('RESOLVED', 'CLOSED');

create unique index if not exists workflow_states_one_initial_per_project_idx
  on public.workflow_states (project_id)
  where is_initial;

create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event_type text not null check (event_type in ('PROJECT_UPDATED', 'PROJECT_ARCHIVED', 'PROJECT_RESTORED', 'WORKFLOW_PUBLISHED')),
  old_value jsonb,
  new_value jsonb,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.project_events is 'Immutable audit history for project configuration and workflow publication.';

create index if not exists project_events_project_created_idx
  on public.project_events (project_id, created_at desc);

alter table public.project_events enable row level security;

revoke all on table public.project_events from anon, authenticated;
grant select on table public.project_events to authenticated;
revoke insert, update, delete on public.workflow_states, public.workflow_transitions from anon, authenticated, public;

create or replace function public.prevent_project_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'IMMUTABLE_AUDIT' using errcode = '42501';
end;
$$;

drop trigger if exists project_events_immutable on public.project_events;
create trigger project_events_immutable
before update or delete on public.project_events
for each row execute procedure public.prevent_project_event_mutation();

create policy "Project members can read project events"
  on public.project_events for select to authenticated
  using (public.is_project_member(project_id));

-- All project writes now go through the audited RPCs below. In particular,
-- no browser role can mutate the key or slug.
revoke update on public.projects from anon, authenticated, public;

create or replace function public.update_project_settings(
  p_project_id uuid,
  p_name text,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_project public.projects%rowtype;
  v_name text := trim(coalesce(p_name, ''));
  v_description text := nullif(trim(coalesce(p_description, '')), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  select * into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_project(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_project.is_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'VALIDATION: Project name must be 2-80 characters' using errcode = '22023'; end if;
  if v_description is not null and char_length(v_description) > 280 then raise exception 'VALIDATION: Description is too long' using errcode = '22023'; end if;

  if v_project.name = v_name and v_project.description is not distinct from v_description then return; end if;

  update public.projects set name = v_name, description = v_description where id = p_project_id;
  insert into public.project_events (project_id, actor_id, event_type, old_value, new_value)
  values (
    p_project_id,
    v_actor,
    'PROJECT_UPDATED',
    jsonb_build_object('name', v_project.name, 'description', v_project.description),
    jsonb_build_object('name', v_name, 'description', v_description)
  );
end;
$$;

create or replace function public.set_project_archived(
  p_project_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_project public.projects%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_archived is null then raise exception 'VALIDATION: Archive state is required' using errcode = '22023'; end if;

  select * into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_project(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_project.is_archived = p_archived then return; end if;

  update public.projects set is_archived = p_archived where id = p_project_id;
  insert into public.project_events (project_id, actor_id, event_type, old_value, new_value)
  values (
    p_project_id,
    v_actor,
    case when p_archived then 'PROJECT_ARCHIVED' else 'PROJECT_RESTORED' end,
    to_jsonb(v_project.is_archived),
    to_jsonb(p_archived)
  );
end;
$$;

create or replace function public.replace_project_workflow(
  p_project_id uuid,
  p_states jsonb,
  p_transitions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_archived boolean;
  v_state jsonb;
  v_transition jsonb;
  v_state_id uuid;
  v_from_id uuid;
  v_to_id uuid;
  v_client_id text;
  v_map jsonb := '{}'::jsonb;
  v_keep_ids uuid[] := '{}'::uuid[];
  v_state_count integer;
  v_transition_count integer;
  v_initial_id uuid;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if jsonb_typeof(p_states) <> 'array' or jsonb_typeof(p_transitions) <> 'array' then
    raise exception 'VALIDATION: Workflow states and transitions must be arrays' using errcode = '22023';
  end if;

  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_project(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;

  v_state_count := jsonb_array_length(p_states);
  v_transition_count := jsonb_array_length(p_transitions);
  if v_state_count not between 2 and 50 then raise exception 'VALIDATION: A workflow needs 2-50 states' using errcode = '22023'; end if;
  if v_transition_count > 500 then raise exception 'VALIDATION: Too many workflow transitions' using errcode = '22023'; end if;

  if (select count(*) from jsonb_array_elements(p_states) s where coalesce((s->>'isInitial')::boolean, false)) <> 1 then
    raise exception 'VALIDATION: A workflow must have exactly one initial state' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_states) s where coalesce((s->>'isTerminal')::boolean, false)) < 1 then
    raise exception 'VALIDATION: A workflow must have at least one terminal state' using errcode = '22023';
  end if;
  if (select count(distinct lower(trim(s->>'name'))) from jsonb_array_elements(p_states) s) <> v_state_count then
    raise exception 'VALIDATION: State names must be unique' using errcode = '22023';
  end if;
  if (select count(distinct (s->>'position')::integer) from jsonb_array_elements(p_states) s) <> v_state_count then
    raise exception 'VALIDATION: State positions must be unique' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', ws.id, 'name', ws.name, 'category', ws.category, 'position', ws.position,
    'isInitial', ws.is_initial, 'isTerminal', ws.is_terminal
  ) order by ws.position) into v_old_snapshot
  from public.workflow_states ws where ws.project_id = p_project_id;

  for v_state in select value from jsonb_array_elements(p_states)
  loop
    v_client_id := nullif(trim(coalesce(v_state->>'clientId', v_state->>'id', '')), '');
    if v_client_id is null or char_length(v_client_id) > 80 then raise exception 'VALIDATION: Every state needs a valid clientId' using errcode = '22023'; end if;
    if v_map ? v_client_id then raise exception 'VALIDATION: State clientIds must be unique' using errcode = '22023'; end if;
    if char_length(trim(coalesce(v_state->>'name', ''))) not between 1 and 40 then raise exception 'VALIDATION: State names must be 1-40 characters' using errcode = '22023'; end if;
    if coalesce(v_state->>'category', '') not in ('TRIAGE', 'OPEN', 'IN_PROGRESS', 'REVIEW', 'RESOLVED', 'CLOSED') then raise exception 'VALIDATION: Invalid state category' using errcode = '22023'; end if;
    if coalesce(v_state->>'position', '') !~ '^\d+$' or (v_state->>'position')::integer > 10000 then raise exception 'VALIDATION: State position must be 0-10000' using errcode = '22023'; end if;

    if nullif(v_state->>'id', '') is not null then
      begin v_state_id := (v_state->>'id')::uuid; exception when invalid_text_representation then raise exception 'VALIDATION: Invalid state id' using errcode = '22023'; end;
      if not exists (select 1 from public.workflow_states ws where ws.id = v_state_id and ws.project_id = p_project_id) then
        raise exception 'VALIDATION: State does not belong to this project' using errcode = '22023';
      end if;
    else
      v_state_id := gen_random_uuid();
    end if;
    v_map := v_map || jsonb_build_object(v_client_id, v_state_id::text);
    v_keep_ids := array_append(v_keep_ids, v_state_id);
  end loop;

  for v_transition in select value from jsonb_array_elements(p_transitions)
  loop
    if not (v_map ? coalesce(v_transition->>'fromClientId', '')) or not (v_map ? coalesce(v_transition->>'toClientId', '')) then
      raise exception 'VALIDATION: Transition references an unknown state' using errcode = '22023';
    end if;
    v_from_id := (v_map->>(v_transition->>'fromClientId'))::uuid;
    v_to_id := (v_map->>(v_transition->>'toClientId'))::uuid;
    if v_from_id = v_to_id then raise exception 'VALIDATION: A state cannot transition to itself' using errcode = '22023'; end if;
    if nullif(v_transition->>'requiredRole', '') is not null and v_transition->>'requiredRole' not in ('MAINTAINER', 'DEVELOPER', 'REPORTER', 'VIEWER') then
      raise exception 'VALIDATION: Invalid transition role' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct concat(t->>'fromClientId', '->', t->>'toClientId')) from jsonb_array_elements(p_transitions) t) <> v_transition_count then
    raise exception 'VALIDATION: Duplicate workflow transition' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.workflow_states ws
    join public.issues i on i.status_id = ws.id
    where ws.project_id = p_project_id and not (ws.id = any(v_keep_ids))
  ) then raise exception 'STATE_IN_USE' using errcode = '23503'; end if;

  delete from public.workflow_transitions where project_id = p_project_id;
  update public.workflow_states
  set name = '#' || left(id::text, 39), position = 1000000 + row_number_value, is_initial = false
  from (
    select id, row_number() over (order by id)::integer as row_number_value
    from public.workflow_states where project_id = p_project_id
  ) staged
  where workflow_states.id = staged.id;

  for v_state in select value from jsonb_array_elements(p_states)
  loop
    v_client_id := coalesce(v_state->>'clientId', v_state->>'id');
    v_state_id := (v_map->>v_client_id)::uuid;
    insert into public.workflow_states (id, project_id, name, category, position, color, is_initial, is_terminal)
    values (
      v_state_id,
      p_project_id,
      trim(v_state->>'name'),
      v_state->>'category',
      (v_state->>'position')::integer,
      nullif(trim(coalesce(v_state->>'color', '')), ''),
      coalesce((v_state->>'isInitial')::boolean, false),
      coalesce((v_state->>'isTerminal')::boolean, false)
    )
    on conflict (id) do update set
      name = excluded.name,
      category = excluded.category,
      position = excluded.position,
      color = excluded.color,
      is_initial = excluded.is_initial,
      is_terminal = excluded.is_terminal;
  end loop;

  delete from public.workflow_states where project_id = p_project_id and not (id = any(v_keep_ids));

  for v_transition in select value from jsonb_array_elements(p_transitions)
  loop
    v_from_id := (v_map->>(v_transition->>'fromClientId'))::uuid;
    v_to_id := (v_map->>(v_transition->>'toClientId'))::uuid;
    insert into public.workflow_transitions (project_id, from_state_id, to_state_id, required_role, requires_resolution)
    values (
      p_project_id,
      v_from_id,
      v_to_id,
      nullif(v_transition->>'requiredRole', ''),
      coalesce((v_transition->>'requiresResolution')::boolean, false)
    );
  end loop;

  select id into v_initial_id from public.workflow_states where project_id = p_project_id and is_initial;

  if exists (
    select 1 from public.workflow_states ws
    where ws.project_id = p_project_id
      and ws.id not in (
        with recursive reachable(id) as (
          select v_initial_id
          union
          select wt.to_state_id from public.workflow_transitions wt join reachable r on r.id = wt.from_state_id where wt.project_id = p_project_id
        ) select id from reachable
      )
  ) then raise exception 'VALIDATION: Every state must be reachable from the initial state' using errcode = '22023'; end if;

  if exists (
    select 1 from public.workflow_states origin
    where origin.project_id = p_project_id
      and not exists (
        with recursive reachable(id) as (
          select origin.id
          union
          select wt.to_state_id from public.workflow_transitions wt join reachable r on r.id = wt.from_state_id where wt.project_id = p_project_id
        )
        select 1 from reachable r join public.workflow_states terminal on terminal.id = r.id where terminal.is_terminal
      )
  ) then raise exception 'VALIDATION: Every state must have a path to a terminal state' using errcode = '22023'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', ws.id, 'name', ws.name, 'category', ws.category, 'position', ws.position,
    'isInitial', ws.is_initial, 'isTerminal', ws.is_terminal
  ) order by ws.position) into v_new_snapshot
  from public.workflow_states ws where ws.project_id = p_project_id;

  insert into public.project_events (project_id, actor_id, event_type, old_value, new_value, metadata)
  values (p_project_id, v_actor, 'WORKFLOW_PUBLISHED', v_old_snapshot, v_new_snapshot, jsonb_build_object('transitionCount', v_transition_count));
end;
$$;

-- Transition resolution behavior is configured per edge. Maintainer overrides
-- still fall back to category-based behavior when no configured edge exists.
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
  v_old public.issues%rowtype;
  v_target_state public.workflow_states%rowtype;
  v_transition public.workflow_transitions%rowtype;
  v_requires_resolution boolean;
  v_resolution text;
  v_resolved_at timestamptz;
  v_closed_at timestamptz;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- SECURITY DEFINER must not let a project role bypass restricted visibility
  -- or distinguish a hidden issue UUID from one that does not exist.
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER', 'REPORTER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select * into v_target_state from public.workflow_states where id = p_to_state_id and project_id = v_project_id;
  if not found then raise exception 'INVALID_STATE' using errcode = '23503'; end if;
  select * into v_old from public.issues where id = p_issue_id for update;
  if v_old.status_id = p_to_state_id and (p_resolution is null or p_resolution = v_old.resolution) then return; end if;

  if v_old.status_id <> p_to_state_id then
    select * into v_transition from public.workflow_transitions
    where project_id = v_project_id and from_state_id = v_old.status_id and to_state_id = p_to_state_id;
    if v_role <> 'MAINTAINER' and (
      not found or not (
        v_transition.required_role is null
        or v_transition.required_role = v_role
        or v_transition.required_role = 'VIEWER'
        or (v_transition.required_role = 'REPORTER' and v_role in ('DEVELOPER', 'MAINTAINER'))
        or (v_transition.required_role = 'DEVELOPER' and v_role = 'MAINTAINER')
      )
    ) then raise exception 'INVALID_TRANSITION' using errcode = '42501'; end if;
  end if;

  v_requires_resolution := case
    when v_transition.id is not null then v_transition.requires_resolution
    else v_target_state.category in ('RESOLVED', 'CLOSED')
  end;

  if v_target_state.category in ('RESOLVED', 'CLOSED') then
    if v_requires_resolution then
      v_resolution := nullif(trim(coalesce(p_resolution, v_old.resolution, 'FIXED')), '');
    else
      v_resolution := nullif(trim(coalesce(p_resolution, '')), '');
    end if;
    if v_resolution is not null and v_resolution not in ('FIXED', 'DUPLICATE', 'WONT_FIX', 'INVALID', 'CANNOT_REPRODUCE', 'WORKS_AS_EXPECTED') then
      raise exception 'VALIDATION: Invalid resolution' using errcode = '22023';
    end if;
    if v_requires_resolution and v_resolution is null then raise exception 'RESOLUTION_REQUIRED' using errcode = '22023'; end if;
    v_resolved_at := coalesce(v_old.resolved_at, v_now);
    v_closed_at := case when v_target_state.category = 'CLOSED' then v_now else null end;
  else
    v_resolution := null;
    v_resolved_at := null;
    v_closed_at := null;
  end if;

  update public.issues set status_id = p_to_state_id, resolution = v_resolution,
    resolved_at = v_resolved_at, closed_at = v_closed_at, updated_at = v_now
  where id = p_issue_id;

  if v_old.status_id <> p_to_state_id then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
    values (p_issue_id, v_user, 'STATUS_CHANGED', 'status_id', to_jsonb(v_old.status_id::text), to_jsonb(p_to_state_id::text),
      jsonb_build_object('old_state_id', v_old.status_id, 'new_state_id', p_to_state_id, 'new_category', v_target_state.category,
        'resolution', v_resolution, 'resolution_required', v_requires_resolution));
  end if;
  if coalesce(v_old.resolution, '') is distinct from coalesce(v_resolution, '') then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
    values (p_issue_id, v_user, 'RESOLUTION_CHANGED', 'resolution', to_jsonb(v_old.resolution), to_jsonb(v_resolution));
  end if;
end;
$$;

revoke execute on function public.update_project_settings(uuid, text, text), public.set_project_archived(uuid, boolean), public.replace_project_workflow(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_project_settings(uuid, text, text), public.set_project_archived(uuid, boolean), public.replace_project_workflow(uuid, jsonb, jsonb) to authenticated;

revoke execute on function public.transition_issue(uuid, uuid, text) from public, anon;
grant execute on function public.transition_issue(uuid, uuid, text) to authenticated;

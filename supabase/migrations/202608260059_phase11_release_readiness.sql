-- Phase 11: authoritative, visibility-safe release-readiness scoring and history.
-- Scores are calculated in SQL so every client sees the same rubric. Restricted
-- issues are included only when can_view_issue() permits the current caller.
-- Snapshots retain the caller-specific aggregate, so history is creator-only.

create table if not exists public.release_readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  milestone_id uuid references public.milestones(id) on delete set null,
  version_id uuid references public.versions(id) on delete set null,
  score integer not null check (score between 0 and 100),
  status text not null check (status in ('READY', 'ATTENTION', 'BLOCKED', 'NO_DATA')),
  breakdown jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists release_readiness_snapshots_project_idx
  on public.release_readiness_snapshots(project_id, created_at desc, id desc);
create index if not exists release_readiness_snapshots_creator_idx
  on public.release_readiness_snapshots(project_id, created_by, created_at desc, id desc);

alter table public.release_readiness_snapshots enable row level security;
drop policy if exists "Project members can read readiness snapshots" on public.release_readiness_snapshots;
drop policy if exists "Creators can read their readiness snapshots" on public.release_readiness_snapshots;
create policy "Creators can read their readiness snapshots"
  on public.release_readiness_snapshots for select to authenticated
  using (created_by = auth.uid() and public.is_project_member(project_id));

revoke all on public.release_readiness_snapshots from anon, authenticated, public;

create or replace function public.prevent_release_readiness_snapshot_mutation()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('tracebox.release_readiness_snapshot_write', true), '') <> 'on' then
      raise exception 'READINESS_SNAPSHOT_RPC_ONLY' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'READINESS_SNAPSHOT_IMMUTABLE' using errcode = '42501';
end;
$$;

drop trigger if exists release_readiness_snapshots_immutable on public.release_readiness_snapshots;
create trigger release_readiness_snapshots_immutable
before insert or update or delete on public.release_readiness_snapshots
for each row execute procedure public.prevent_release_readiness_snapshot_mutation();
revoke execute on function public.prevent_release_readiness_snapshot_mutation() from public, anon, authenticated;

create or replace function public.calculate_release_readiness(
  p_project_id uuid, p_milestone_id uuid default null, p_version_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_archived boolean; v_score integer;
  v_total integer; v_resolved integer; v_open integer; v_blockers integer;
  v_criticals integer; v_regressions integer; v_unassigned integer;
  v_security integer; v_overdue integer; v_result jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = p_project_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if public.project_role(p_project_id) is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_milestone_id is not null and not exists (
    select 1 from public.milestones m where m.id = p_milestone_id and m.project_id = p_project_id
  ) then raise exception 'VALIDATION: Milestone does not belong to project' using errcode = '22023'; end if;
  if p_version_id is not null and not exists (
    select 1 from public.versions v where v.id = p_version_id and v.project_id = p_project_id
  ) then raise exception 'VALIDATION: Version does not belong to project' using errcode = '22023'; end if;

  -- This CTE is the privacy boundary for every count and factor.
  with visible as (
    select i.id, i.target_milestone_id, i.assignee_id, i.type, i.priority, i.severity,
           ws.category as status_category, m.due_at
      from public.issues i
      join public.workflow_states ws on ws.id = i.status_id
      left join public.milestones m on m.id = i.target_milestone_id
     where i.project_id = p_project_id and public.can_view_issue(i.id)
       and (p_milestone_id is null or i.target_milestone_id = p_milestone_id)
       and (p_version_id is null or i.affected_version_id = p_version_id)
  )
  select count(*)::integer,
         count(*) filter (where status_category in ('RESOLVED', 'CLOSED'))::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED'))::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED') and (priority = 'P0' or severity = 'BLOCKER'))::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED') and (priority = 'P1' or severity = 'CRITICAL') and not (priority = 'P0' or severity = 'BLOCKER'))::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED') and type = 'REGRESSION')::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED') and assignee_id is null)::integer,
         count(*) filter (where status_category not in ('RESOLVED', 'CLOSED') and type = 'SECURITY')::integer,
         count(distinct target_milestone_id) filter (where status_category not in ('RESOLVED', 'CLOSED') and target_milestone_id is not null and due_at is not null and due_at < timezone('utc'::text, now()))::integer
    into v_total, v_resolved, v_open, v_blockers, v_criticals, v_regressions, v_unassigned, v_security, v_overdue
    from visible;

  if v_total = 0 then v_score := 0;
  else v_score := greatest(0, least(100,
    round((v_resolved::numeric / v_total::numeric) * 100)::integer
    - v_blockers * 25 - v_criticals * 10 - v_regressions * 15
    - v_unassigned * 5 - v_security * 10 - v_overdue * 5));
  end if;

  v_result := jsonb_build_object(
    'total', v_total, 'resolved_count', v_resolved, 'open_count', v_open,
    'blocker_count', v_blockers, 'critical_count', v_criticals,
    'regression_count', v_regressions, 'unassigned_count', v_unassigned,
    'unresolved_security_count', v_security, 'overdue_milestone_count', v_overdue,
    'score', v_score,
    'status', case when v_total = 0 then 'NO_DATA'
      when v_blockers > 0 or v_score < 60 then 'BLOCKED'
      when v_criticals > 0 or v_regressions > 0 or v_security > 0 or v_overdue > 0 or v_score < 85 then 'ATTENTION'
      else 'READY' end,
    'issues', '[]'::jsonb
  );

  -- Drilldowns are current-caller visible rows only and are never persisted.
  with visible as (
    select i.id, i.issue_number, i.title, i.type, i.priority, i.severity,
           i.assignee_id, i.target_milestone_id, i.affected_version_id,
           ws.category as status_category, ws.name as status_name, c.name as component_name,
           m.due_at
      from public.issues i
      join public.workflow_states ws on ws.id = i.status_id
      left join public.components c on c.id = i.component_id
      left join public.milestones m on m.id = i.target_milestone_id
     where i.project_id = p_project_id and public.can_view_issue(i.id)
       and (p_milestone_id is null or i.target_milestone_id = p_milestone_id)
       and (p_version_id is null or i.affected_version_id = p_version_id)
       and ws.category not in ('RESOLVED', 'CLOSED')
  )
  select v_result || jsonb_build_object('issues', coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'issueNumber', issue_number, 'title', title, 'type', type,
    'priority', priority, 'severity', severity, 'statusCategory', status_category,
    'statusName', status_name, 'assigneeId', assignee_id, 'componentName', component_name,
    'targetMilestoneId', target_milestone_id, 'affectedVersionId', affected_version_id,
    'dueAt', due_at
  ) order by issue_number), '[]'::jsonb)) into v_result
  from visible;
  return v_result;
end;
$$;

create or replace function public.save_release_readiness_snapshot(
  p_project_id uuid, p_milestone_id uuid default null, p_version_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_analysis jsonb; v_id uuid; v_archived boolean;
begin
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_analysis := public.calculate_release_readiness(p_project_id, p_milestone_id, p_version_id);
  perform set_config('tracebox.release_readiness_snapshot_write', 'on', true);
  insert into public.release_readiness_snapshots(project_id, milestone_id, version_id, score, status, breakdown, created_by)
  values (p_project_id, p_milestone_id, p_version_id, (v_analysis->>'score')::integer,
          v_analysis->>'status', v_analysis - 'issues', auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.list_release_readiness_snapshots(
  p_project_id uuid, p_milestone_id uuid default null, p_version_id uuid default null,
  p_limit integer default 30
)
returns table (id uuid, milestone_id uuid, version_id uuid, score integer, status text,
  breakdown jsonb, created_by uuid, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if public.project_role(p_project_id) is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_milestone_id is not null and not exists (
    select 1 from public.milestones m where m.id = p_milestone_id and m.project_id = p_project_id
  ) then raise exception 'VALIDATION: Milestone does not belong to project' using errcode = '22023'; end if;
  if p_version_id is not null and not exists (
    select 1 from public.versions v where v.id = p_version_id and v.project_id = p_project_id
  ) then raise exception 'VALIDATION: Version does not belong to project' using errcode = '22023'; end if;
  return query select s.id, s.milestone_id, s.version_id, s.score, s.status,
    s.breakdown, s.created_by, s.created_at
    from public.release_readiness_snapshots s where s.project_id = p_project_id
      and s.created_by = auth.uid()
      and (p_milestone_id is null or s.milestone_id = p_milestone_id)
      and (p_version_id is null or s.version_id = p_version_id)
    order by s.created_at desc, s.id desc limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

revoke execute on function public.calculate_release_readiness(uuid, uuid, uuid), public.save_release_readiness_snapshot(uuid, uuid, uuid), public.list_release_readiness_snapshots(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.calculate_release_readiness(uuid, uuid, uuid), public.save_release_readiness_snapshot(uuid, uuid, uuid), public.list_release_readiness_snapshots(uuid, uuid, uuid, integer) to authenticated;

-- Phase 11: backend-authoritative, restricted-safe report metrics.
-- SECURITY DEFINER is used for complete aggregates; every issue-derived
-- expression therefore retains an explicit can_view_issue boundary.

create or replace function public.get_issue_reports(
  p_project_id uuid,
  p_window_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_window_days integer := coalesce(p_window_days, 30);
  v_now timestamptz := timezone('utc'::text, now());
  v_start timestamptz;
  v_start_day timestamptz;
  v_end_day timestamptz;
  v_visible_count bigint;
  v_window_count bigint;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_window_days not in (0, 7, 30, 90, 365) then
    raise exception 'VALIDATION: Unsupported report window' using errcode = '22023';
  end if;

  -- Keep the all-time series finite. PostgreSQL does not accept -infinity as
  -- a generate_series timestamp on every supported version.
  if v_window_days = 0 then
    select coalesce(min(i.created_at), v_now) into v_start
    from public.issues i
    where i.project_id = p_project_id and public.can_view_issue(i.id);
  else
    v_start := v_now - make_interval(days => v_window_days);
  end if;
  v_start_day := date_trunc('day', v_start);
  v_end_day := date_trunc('day', v_now);

  select count(*) into v_visible_count from public.issues i
  where i.project_id = p_project_id and public.can_view_issue(i.id);
  select count(*) into v_window_count from public.issues i
  where i.project_id = p_project_id and public.can_view_issue(i.id)
    and i.created_at >= v_start and i.created_at <= v_now;

  return (
    with resolution_events as (
      -- One latest qualifying resolution per visible issue in the window.
      -- This is the shared source for resolved counts, duration statistics,
      -- and the resolved drilldown/CSV.
      select distinct on (i.id)
        i.id,
        i.created_at as issue_created_at,
        e.created_at as resolution_at,
        extract(epoch from (e.created_at - i.created_at)) / 86400.0 as duration_days
      from public.issues i
      join public.issue_events e on e.issue_id = i.id
      left join public.workflow_states ns on ns.id::text = e.new_value #>> '{}'
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and upper(e.event_type) = 'STATUS_CHANGED'
        and lower(coalesce(e.metadata->>'new_category', ns.category)) in ('resolved', 'closed')
        and coalesce((select lower(coalesce(prev.metadata->>'new_category', ps.category))
          from public.issue_events prev
          left join public.workflow_states ps on ps.id::text = prev.new_value #>> '{}'
          where prev.issue_id = e.issue_id and upper(prev.event_type) = 'STATUS_CHANGED'
            and (prev.created_at, prev.id) < (e.created_at, e.id)
          order by prev.created_at desc, prev.id desc limit 1), 'open') not in ('resolved', 'closed')
        and e.created_at >= v_start and e.created_at <= v_now
        and e.created_at >= i.created_at
      order by i.id, e.created_at desc, e.id desc
    )
  select jsonb_build_object(
    'window_days', v_window_days,
    'window_start', v_start,
    'window_end', v_now,
    'visible_count', v_visible_count,
    'window_issue_count', v_window_count,
    'no_data', (v_visible_count = 0),
    'created', (select count(*) from public.issues i
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now),
    -- Count issues entering a terminal state from a non-terminal state. The
    -- issue timestamp is intentionally not authoritative here: reopening an
    -- issue clears it, while the immutable status history preserves every
    -- resolution cycle.
    'resolved', (select count(*) from resolution_events),
    'backlog', (select count(*) from public.issues i
      join public.workflow_states s on s.id = i.status_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and s.category not in ('RESOLVED', 'CLOSED')),

    'resolution_duration', (select jsonb_build_object(
      'count', count(*)::integer,
      'avg_days', round((avg(r.duration_days))::numeric, 1),
      'median_days', round((percentile_cont(0.5) within group (order by r.duration_days))::numeric, 1),
      'p90_days', round((percentile_cont(0.9) within group (order by r.duration_days))::numeric, 1)
    ) from resolution_events r),
    'avg_resolution_days', (select round((avg(r.duration_days))::numeric, 1) from resolution_events r),

    'category_counts', coalesce((select jsonb_object_agg(x.category, x.total) from (
      select s.category, count(*)::integer as total from public.issues i
      join public.workflow_states s on s.id = i.status_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now group by s.category
    ) x), '{}'::jsonb),
    'priority_counts', coalesce((select jsonb_object_agg(x.priority, x.total) from (
      select i.priority, count(*)::integer as total from public.issues i
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now group by i.priority
    ) x), '{}'::jsonb),
    'component_counts', coalesce((select jsonb_agg(jsonb_build_object('id', x.component_id, 'name', x.component_name, 'count', x.total) order by x.total desc, x.component_name) from (
      select coalesce(c.id::text, '') as component_id, coalesce(c.name, 'Unassigned component') as component_name, count(*)::integer as total
      from public.issues i left join public.components c on c.id = i.component_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now group by c.id, c.name
    ) x), '[]'::jsonb),
    'by_assignee', coalesce((select jsonb_agg(jsonb_build_object('id', x.assignee_id, 'name', x.assignee_name, 'count', x.total) order by x.total desc, x.assignee_name) from (
      select coalesce(i.assignee_id::text, '') as assignee_id, coalesce(nullif(p.display_name, ''), 'Unassigned') as assignee_name, count(*)::integer as total
      from public.issues i left join public.profiles p on p.id = i.assignee_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now group by i.assignee_id, p.display_name
    ) x), '[]'::jsonb),
    'by_milestone', coalesce((select jsonb_agg(jsonb_build_object('id', x.milestone_id, 'name', x.milestone_name, 'count', x.total) order by x.total desc, x.milestone_name) from (
      select coalesce(m.id::text, '') as milestone_id, coalesce(m.name, 'No milestone') as milestone_name, count(*)::integer as total
      from public.issues i left join public.milestones m on m.id = i.target_milestone_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and i.created_at >= v_start and i.created_at <= v_now group by m.id, m.name
    ) x), '[]'::jsonb),

    -- Reconstruct historical status from immutable events; current status
    -- alone loses the active interval when an issue is later reopened.
    'historical_trend', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'created', x.created, 'resolved', x.resolved, 'backlog', x.backlog) order by x.day) from (
      with days as (
        select d as day from generate_series(v_start_day, v_end_day, interval '1 day') d
      ), visible as (
        select i.id, i.created_at, i.resolved_at, i.closed_at, s.category as current_category
        from public.issues i join public.workflow_states s on s.id = i.status_id
        where i.project_id = p_project_id and public.can_view_issue(i.id)
      ), state_at_day as (
        select d.day, v.id,
          coalesce(
            (select lower(coalesce(e.metadata->>'new_category', ns.category))
             from public.issue_events e
             left join public.workflow_states ns on ns.id::text = e.new_value #>> '{}'
             where e.issue_id = v.id and upper(e.event_type) = 'STATUS_CHANGED' and e.created_at < d.day + interval '1 day'
             order by e.created_at desc, e.id desc limit 1),
            (select lower(os.category)
             from public.issue_events e
             join public.workflow_states os on os.id::text = e.old_value #>> '{}'
             where e.issue_id = v.id and upper(e.event_type) = 'STATUS_CHANGED'
             order by e.created_at asc, e.id asc limit 1),
            lower(v.current_category)
          ) as category
        from days d cross join visible v
        where v.created_at < d.day + interval '1 day'
      )
      select d.day::date as day,
        (select count(*)::integer from visible v where v.created_at >= d.day and v.created_at < d.day + interval '1 day') as created,
        (select count(*)::integer
         from public.issue_events e
         join visible v on v.id = e.issue_id
         left join public.workflow_states ns on ns.id::text = e.new_value #>> '{}'
         where upper(e.event_type) = 'STATUS_CHANGED'
           and lower(coalesce(e.metadata->>'new_category', ns.category)) in ('resolved', 'closed')
           and coalesce((select lower(coalesce(prev.metadata->>'new_category', ps.category))
             from public.issue_events prev
             left join public.workflow_states ps on ps.id::text = prev.new_value #>> '{}'
             where prev.issue_id = e.issue_id and upper(prev.event_type) = 'STATUS_CHANGED'
               and (prev.created_at, prev.id) < (e.created_at, e.id)
             order by prev.created_at desc, prev.id desc limit 1), 'open') not in ('resolved', 'closed')
           and e.created_at >= d.day and e.created_at < d.day + interval '1 day') as resolved,
        (select count(*)::integer from state_at_day s where s.day = d.day and s.category not in ('resolved', 'closed')) as backlog
      from days d
    ) x), '[]'::jsonb),

    'drilldown', coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'issue_number', x.issue_number, 'title', x.title, 'type', x.type,
      'priority', x.priority, 'severity', x.severity, 'status', x.status_name,
      'status_category', x.status_category, 'component_name', x.component_name,
      'assignee_id', x.assignee_id, 'assignee_name', x.assignee_name,
      'milestone_id', x.milestone_id, 'milestone_name', x.milestone_name,
      'created_at', x.created_at, 'resolved_at', x.resolved_at, 'closed_at', x.closed_at
    ) order by x.updated_at desc, x.issue_number desc) from (
      select i.id, i.issue_number, i.title, i.type, i.priority, i.severity,
        s.name as status_name, s.category as status_category, c.name as component_name,
        i.assignee_id, nullif(trim(coalesce(p.display_name, '')), '') as assignee_name,
        i.target_milestone_id as milestone_id, m.name as milestone_name, i.created_at,
        i.resolved_at, i.closed_at, i.updated_at
      from public.issues i join public.workflow_states s on s.id = i.status_id
      left join public.components c on c.id = i.component_id
      left join public.profiles p on p.id = i.assignee_id
      left join public.milestones m on m.id = i.target_milestone_id
      where i.project_id = p_project_id and public.can_view_issue(i.id)
        and s.category not in ('RESOLVED', 'CLOSED')
      order by i.updated_at desc, i.issue_number desc limit 200
    ) x), '[]'::jsonb),
      'drilldowns', jsonb_build_object(
      'created', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.issue_number desc) from (
        select i.id, i.issue_number, i.title, i.type, i.priority, i.severity, s.name as status_name, s.category as status_category, c.name as component_name, i.assignee_id, nullif(trim(coalesce(p.display_name, '')), '') as assignee_name, i.target_milestone_id as milestone_id, m.name as milestone_name, i.created_at, i.resolved_at, i.closed_at
        from public.issues i join public.workflow_states s on s.id = i.status_id
        left join public.components c on c.id = i.component_id
        left join public.profiles p on p.id = i.assignee_id
        left join public.milestones m on m.id = i.target_milestone_id
        where i.project_id = p_project_id and public.can_view_issue(i.id) and i.created_at >= v_start and i.created_at <= v_now
        order by i.created_at desc, i.issue_number desc limit 200
      ) x), '[]'::jsonb),
      'resolved', coalesce((select jsonb_agg(to_jsonb(x) order by x.resolution_at desc, x.issue_number desc) from (
        select i.id, i.issue_number, i.title, i.type, i.priority, i.severity, s.name as status_name, s.category as status_category, c.name as component_name, i.assignee_id, nullif(trim(coalesce(p.display_name, '')), '') as assignee_name, i.target_milestone_id as milestone_id, m.name as milestone_name, i.created_at, r.resolution_at as resolved_at, i.closed_at, round((extract(epoch from (r.resolution_at - i.created_at)) / 86400.0)::numeric, 1) as resolution_days
        from public.issues i join public.workflow_states s on s.id = i.status_id
        left join public.components c on c.id = i.component_id
        left join public.profiles p on p.id = i.assignee_id
        left join public.milestones m on m.id = i.target_milestone_id
        join resolution_events r on r.id = i.id
        where i.project_id = p_project_id and public.can_view_issue(i.id)
        order by r.resolution_at desc, i.issue_number desc limit 200
      ) x), '[]'::jsonb),
      'backlog', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc, x.issue_number desc) from (
        select i.id, i.issue_number, i.title, i.type, i.priority, i.severity, s.name as status_name, s.category as status_category, c.name as component_name, i.assignee_id, nullif(trim(coalesce(p.display_name, '')), '') as assignee_name, i.target_milestone_id as milestone_id, m.name as milestone_name, i.created_at, i.resolved_at, i.closed_at, i.updated_at
        from public.issues i join public.workflow_states s on s.id = i.status_id
        left join public.components c on c.id = i.component_id
        left join public.profiles p on p.id = i.assignee_id
        left join public.milestones m on m.id = i.target_milestone_id
        where i.project_id = p_project_id and public.can_view_issue(i.id) and s.category not in ('RESOLVED', 'CLOSED')
        order by i.updated_at desc, i.issue_number desc limit 200
      ) x), '[]'::jsonb)
    )
  ));
end;
$$;

revoke execute on function public.get_issue_reports(uuid, integer) from anon, public;
grant execute on function public.get_issue_reports(uuid, integer) to authenticated;

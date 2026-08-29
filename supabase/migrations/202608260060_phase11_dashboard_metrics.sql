-- Migration 060: authoritative restricted-safe dashboard metrics.
-- All operational cards use one visibility-filtered aggregate so the counts
-- cannot drift from one another or count resolved/restricted work differently.
create or replace function public.get_dashboard_metrics(p_project_id uuid)
returns table (assigned_to_me bigint, awaiting_triage bigint, due_milestones bigint, open_count bigint, in_progress_count bigint, critical_count bigint, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.is_project_member(p_project_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select
    count(*) filter (where i.assignee_id = v_user and ws.category not in ('RESOLVED', 'CLOSED')),
    count(*) filter (where ws.category = 'TRIAGE'),
    count(*) filter (where m.due_at < timezone('utc'::text, now())
      and m.status in ('PLANNED', 'ACTIVE')
      and ws.category not in ('RESOLVED', 'CLOSED')),
    count(*) filter (where ws.category in ('TRIAGE', 'OPEN')),
    count(*) filter (where ws.category in ('IN_PROGRESS', 'REVIEW')),
    count(*) filter (where i.severity in ('BLOCKER', 'CRITICAL')
      and ws.category not in ('RESOLVED', 'CLOSED')),
    count(*)
  from public.issues i
  join public.workflow_states ws on ws.id = i.status_id and ws.project_id = i.project_id
  left join public.milestones m on m.id = i.target_milestone_id and m.project_id = i.project_id
  where i.project_id = p_project_id and public.can_view_issue(i.id);
end;
$$;
revoke execute on function public.get_dashboard_metrics(uuid) from anon, public;
grant execute on function public.get_dashboard_metrics(uuid) to authenticated;

-- Forward-only correction for migration 080: the product contract permits a
-- maximum blast-radius traversal depth of five hops, not three.

create or replace function public.get_issue_blast_radius_context(p_issue_id uuid, p_limit integer default 50)
returns table (issue_id uuid, issue_number bigint, title text, relationship text, direction text, depth integer)
language sql
volatile
security definer
set search_path = public
as $$
  with recursive root as (
    select i.id, i.project_id from public.issues i
     where i.id = p_issue_id
       and coalesce(i.visibility, 'PROJECT') <> 'RESTRICTED'
       and i.type <> 'SECURITY'
       and public.can_view_issue(i.id)
  ), walk(root_id, project_id, related_id, relationship, direction, depth, visited) as (
    select r.id, r.project_id,
           case when l.source_issue_id = r.id then l.target_issue_id else l.source_issue_id end,
           l.relationship,
           case when l.source_issue_id = r.id then 'OUTBOUND' else 'INBOUND' end,
           1,
           array[r.id, case when l.source_issue_id = r.id then l.target_issue_id else l.source_issue_id end]
      from root r
      join public.issue_links l on l.source_issue_id = r.id or l.target_issue_id = r.id
      join public.issues n on n.id = case when l.source_issue_id = r.id then l.target_issue_id else l.source_issue_id end
     where n.project_id = r.project_id
       and coalesce(n.visibility, 'PROJECT') <> 'RESTRICTED'
       and n.type <> 'SECURITY'
       and public.can_view_issue(n.id)
    union all
    select w.root_id, w.project_id,
           case when l.source_issue_id = w.related_id then l.target_issue_id else l.source_issue_id end,
           l.relationship,
           case when l.source_issue_id = w.related_id then 'OUTBOUND' else 'INBOUND' end,
           w.depth + 1,
           w.visited || case when l.source_issue_id = w.related_id then l.target_issue_id else l.source_issue_id end
      from walk w
      join public.issue_links l on l.source_issue_id = w.related_id or l.target_issue_id = w.related_id
      join public.issues n on n.id = case when l.source_issue_id = w.related_id then l.target_issue_id else l.source_issue_id end
     where w.depth < 5
       and not (case when l.source_issue_id = w.related_id then l.target_issue_id else l.source_issue_id end = any(w.visited))
       and n.project_id = w.project_id
       and coalesce(n.visibility, 'PROJECT') <> 'RESTRICTED'
       and n.type <> 'SECURITY'
       and public.can_view_issue(n.id)
  ), ranked as (
    select distinct on (w.related_id) w.related_id, w.relationship, w.direction, w.depth
      from walk w order by w.related_id, w.depth, w.direction, w.relationship
  )
  select i.id, i.issue_number, i.title, r.relationship, r.direction, r.depth
    from ranked r join public.issues i on i.id = r.related_id
   order by r.depth, r.direction, i.issue_number, i.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke execute on function public.get_issue_blast_radius_context(uuid, integer) from public, anon;
grant execute on function public.get_issue_blast_radius_context(uuid, integer) to authenticated;

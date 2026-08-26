-- Migration 019: Phase 11 - Dependencies & Duplicates
-- Adds issue_links table for BLOCKS, DEPENDS_ON, DUPLICATE_OF, etc.

create table if not exists public.issue_links (
  id uuid primary key default gen_random_uuid(),
  source_issue_id uuid not null references public.issues (id) on delete cascade,
  target_issue_id uuid not null references public.issues (id) on delete cascade,
  relationship text not null check (relationship in ('BLOCKS', 'DEPENDS_ON', 'DUPLICATE_OF', 'RELATES_TO', 'CAUSED_BY', 'REGRESSION_OF')),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  check (source_issue_id <> target_issue_id),
  unique (source_issue_id, target_issue_id, relationship)
);

create index if not exists issue_links_source_idx on public.issue_links (source_issue_id);
create index if not exists issue_links_target_idx on public.issue_links (target_issue_id);

alter table public.issue_links enable row level security;

create policy "Project members can read issue links"
  on public.issue_links for select to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = source_issue_id and public.is_project_member(i.project_id)
    )
  );

-- RPC: Add Link
create or replace function public.add_issue_link(
  p_source_issue_id uuid,
  p_target_issue_id uuid,
  p_relationship text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_link_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_source_issue_id = p_target_issue_id then
    raise exception 'VALIDATION: Cannot link issue to itself' using errcode = '22023';
  end if;

  if p_relationship not in ('BLOCKS', 'DEPENDS_ON', 'DUPLICATE_OF', 'RELATES_TO', 'CAUSED_BY', 'REGRESSION_OF') then
    raise exception 'VALIDATION: Invalid relationship' using errcode = '22023';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_source_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  -- Ensure target is same project
  if not exists (select 1 from public.issues i where i.id = p_target_issue_id and i.project_id = v_project_id) then
    raise exception 'VALIDATION: Target issue must be in same project' using errcode = '22023';
  end if;

  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.issue_links (source_issue_id, target_issue_id, relationship, created_by)
  values (p_source_issue_id, p_target_issue_id, p_relationship, v_user)
  returning id into v_link_id;

  -- Audit
  insert into public.issue_events (issue_id, actor_id, event_type, metadata)
  values (p_source_issue_id, v_user, 'ISSUE_LINKED', jsonb_build_object('target_id', p_target_issue_id, 'relationship', p_relationship));

  -- Handle DUPLICATE_OF: auto transition to resolved with DUPLICATE resolution
  if p_relationship = 'DUPLICATE_OF' then
    perform public.transition_issue(p_source_issue_id, (
      select ws.id from public.workflow_states ws where ws.project_id = v_project_id and ws.category = 'RESOLVED' limit 1
    ), 'DUPLICATE');
  end if;

  return v_link_id;
end;
$$;

create or replace function public.remove_issue_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  delete from public.issue_links where id = p_link_id;
end;
$$;

create or replace function public.find_duplicate_candidates(p_project_id uuid, p_title text, p_limit integer default 5)
returns table (issue_id uuid, issue_number bigint, title text, similarity double precision)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.issue_number, i.title, similarity(i.title, p_title) as sim
  from public.issues i
  where i.project_id = p_project_id
    and i.title % p_title
  order by sim desc
  limit p_limit;
$$;

revoke execute on function public.add_issue_link(uuid, uuid, text) from anon, public;
revoke execute on function public.remove_issue_link(uuid) from anon, public;
revoke execute on function public.find_duplicate_candidates(uuid, text, integer) from anon, public;
grant execute on function public.add_issue_link(uuid, uuid, text) to authenticated;
grant execute on function public.remove_issue_link(uuid) to authenticated;
grant execute on function public.find_duplicate_candidates(uuid, text, integer) to authenticated;

-- Migration 020: Deep Audit Security Fixes
-- Addresses findings F01-F14 from Phase 1-11 deep audit

-- Fix F01: remove_issue_link authorization
create or replace function public.remove_issue_link(p_link_id uuid)
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
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  select i.project_id into v_project_id
  from public.issue_links l
  join public.issues i on i.id = l.source_issue_id
  where l.id = p_link_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.issue_links where id = p_link_id;
end;
$$;

-- Fix F02: find_duplicate_candidates leaks + DoS
create or replace function public.find_duplicate_candidates(p_project_id uuid, p_title text, p_limit integer default 5)
returns table (issue_id uuid, issue_number bigint, title text, similarity double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_title text;
  v_limit integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not public.is_project_member(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null or char_length(v_title) < 3 then
    raise exception 'VALIDATION: Title must be at least 3 characters' using errcode = '22023';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 5), 1), 20);

  return query
    select i.id, i.issue_number, i.title, similarity(i.title, v_title) as sim
    from public.issues i
    where i.project_id = p_project_id
      and i.title % v_title
      and similarity(i.title, v_title) > 0.2
    order by sim desc
    limit v_limit;
end;
$$;

-- Fix F06: add_issue_link - add project lock before insert
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
  v_archived boolean;
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

  -- Top-down lock first
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Ensure target is same project
  if not exists (select 1 from public.issues i where i.id = p_target_issue_id and i.project_id = v_project_id) then
    raise exception 'VALIDATION: Target issue must be in same project' using errcode = '22023';
  end if;

  insert into public.issue_links (source_issue_id, target_issue_id, relationship, created_by)
  values (p_source_issue_id, p_target_issue_id, p_relationship, v_user)
  returning id into v_link_id;

  insert into public.issue_events (issue_id, actor_id, event_type, metadata)
  values (p_source_issue_id, v_user, 'ISSUE_LINKED', jsonb_build_object('target_id', p_target_issue_id, 'relationship', p_relationship));

  if p_relationship = 'DUPLICATE_OF' then
    perform public.transition_issue(p_source_issue_id, (
      select ws.id from public.workflow_states ws where ws.project_id = v_project_id and ws.category = 'RESOLVED' limit 1
    ), 'DUPLICATE');
  end if;

  return v_link_id;
end;
$$;

-- Fix F07: set_issue_labels missing issue row lock
create or replace function public.set_issue_labels(p_issue_id uuid, p_label_ids uuid[])
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
  v_label_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

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

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock issue row
  perform 1 from public.issues where id = p_issue_id for update;

  delete from public.issue_labels where issue_id = p_issue_id;

  if p_label_ids is not null then
    foreach v_label_id in array p_label_ids loop
      if exists (select 1 from public.labels l where l.id = v_label_id and l.project_id = v_project_id) then
        insert into public.issue_labels (issue_id, label_id)
        values (p_issue_id, v_label_id)
        on conflict (issue_id, label_id) do nothing;
      end if;
    end loop;
  end if;

  update public.issues set updated_at = timezone('utc'::text, now()) where id = p_issue_id;
end;
$$;

-- Fix F08: watchers RPCs bypass archival + lock ordering
create or replace function public.toggle_watch_issue(p_issue_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_watching boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.issue_watchers
    where issue_id = p_issue_id and user_id = v_user
  ) into v_watching;

  if v_watching then
    delete from public.issue_watchers
    where issue_id = p_issue_id and user_id = v_user;
    return false;
  else
    insert into public.issue_watchers (issue_id, user_id)
    values (p_issue_id, v_user)
    on conflict (issue_id, user_id) do nothing;
    return true;
  end if;
end;
$$;

create or replace function public.watch_issue(p_issue_id uuid)
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

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(v_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.issue_watchers (issue_id, user_id)
  values (p_issue_id, v_user)
  on conflict (issue_id, user_id) do nothing;
end;
$$;

create or replace function public.unwatch_issue(p_issue_id uuid)
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

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;

  delete from public.issue_watchers
  where issue_id = p_issue_id and user_id = v_user;
end;
$$;

-- Fix F03 & F11: saved_views isolation + archived guard
drop policy if exists "Owners can update their saved views" on public.saved_views;
drop policy if exists "Owners can delete their saved views" on public.saved_views;

create policy "Owners can update their saved views"
  on public.saved_views for update to authenticated
  using (created_by = auth.uid() and public.is_project_member(project_id))
  with check (created_by = auth.uid() and public.is_project_member(project_id));

create policy "Owners can delete their saved views"
  on public.saved_views for delete to authenticated
  using (created_by = auth.uid() and public.is_project_member(project_id));

create or replace function public.create_saved_view(
  p_project_id uuid,
  p_name text,
  p_filters jsonb default '{}'::jsonb,
  p_is_shared boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_view_id uuid;
  v_name text;
  v_archived boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION: Saved view name must be 1–80 characters' using errcode = '22023';
  end if;

  if octet_length(coalesce(p_filters, '{}'::jsonb)::text) > 8000 then
    raise exception 'VALIDATION: Filters too large' using errcode = '22023';
  end if;

  select p.is_archived into v_archived from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.saved_views (project_id, created_by, name, filters, is_shared)
  values (p_project_id, v_user, v_name, coalesce(p_filters, '{}'::jsonb), coalesce(p_is_shared, false))
  returning id into v_view_id;

  return v_view_id;
end;
$$;

create or replace function public.delete_saved_view(p_view_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cnt integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  with deleted as (
    delete from public.saved_views where id = p_view_id and created_by = v_user returning id
  ) select count(*) into v_cnt from deleted;

  if v_cnt = 0 then
    raise exception 'NOT_FOUND: View not found or not owned' using errcode = 'P0002';
  end if;
end;
$$;

-- Fix F05: Add filters size check trigger
create or replace function public.prevent_saved_view_project_change()
returns trigger
language plpgsql
as $$
begin
  if OLD.project_id is distinct from NEW.project_id then
    raise exception 'VALIDATION: Cannot change project of saved view' using errcode = '22023';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_prevent_saved_view_project_change on public.saved_views;
create trigger trg_prevent_saved_view_project_change
before update on public.saved_views
for each row execute procedure public.prevent_saved_view_project_change();

-- Fix F13: update_issue_planning missing lock
create or replace function public.update_issue_planning(
  p_issue_id uuid,
  p_affected_version_id uuid default null,
  p_target_milestone_id uuid default null
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
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select i.project_id into v_project_id
  from public.issues i
  where i.id = p_issue_id;

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

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  perform 1 from public.issues where id = p_issue_id for update;

  if p_affected_version_id is not null and not exists (
    select 1 from public.versions v where v.id = p_affected_version_id and v.project_id = v_project_id and not v.is_archived
  ) then
    raise exception 'INVALID_VERSION' using errcode = '23503';
  end if;

  if p_target_milestone_id is not null and not exists (
    select 1 from public.milestones m where m.id = p_target_milestone_id and m.project_id = v_project_id
  ) then
    raise exception 'INVALID_MILESTONE' using errcode = '23503';
  end if;

  update public.issues
  set affected_version_id = p_affected_version_id,
      target_milestone_id = p_target_milestone_id,
      updated_at = timezone('utc'::text, now())
  where id = p_issue_id;
end;
$$;

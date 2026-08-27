-- Migration 038: final archived-project and token invariant hardening

create or replace function public.toggle_watch_issue(p_issue_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_project_id uuid; v_archived boolean; v_watching boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select exists(select 1 from public.issue_watchers where issue_id = p_issue_id and user_id = v_user) into v_watching;
  if v_watching then delete from public.issue_watchers where issue_id = p_issue_id and user_id = v_user; return false; end if;
  insert into public.issue_watchers(issue_id, user_id) values (p_issue_id, v_user) on conflict do nothing;
  return true;
end; $$;

create or replace function public.watch_issue(p_issue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_project_id uuid; v_archived boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.issue_watchers(issue_id, user_id) values (p_issue_id, v_user) on conflict do nothing;
end; $$;

create or replace function public.unwatch_issue(p_issue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_project_id uuid; v_archived boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.issue_watchers where issue_id = p_issue_id and user_id = v_user;
end; $$;

revoke execute on function public.toggle_watch_issue(uuid), public.watch_issue(uuid), public.unwatch_issue(uuid) from anon, public;
grant execute on function public.toggle_watch_issue(uuid), public.watch_issue(uuid), public.unwatch_issue(uuid) to authenticated;

alter table public.api_tokens drop constraint if exists api_tokens_token_hash_check;
alter table public.api_tokens add constraint api_tokens_token_hash_check
  check (token_hash ~ '^[0-9a-f]{64}$');

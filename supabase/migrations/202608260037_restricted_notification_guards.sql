-- Migration 037: prevent restricted issue watcher/mention notification leaks

create or replace function public.toggle_watch_issue(p_issue_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_project_id uuid; v_watching boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select exists(select 1 from public.issue_watchers where issue_id = p_issue_id and user_id = v_user) into v_watching;
  if v_watching then delete from public.issue_watchers where issue_id = p_issue_id and user_id = v_user; return false; end if;
  insert into public.issue_watchers(issue_id, user_id) values (p_issue_id, v_user) on conflict do nothing;
  return true;
end; $$;

create or replace function public.watch_issue(p_issue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.issue_watchers(issue_id, user_id) values (p_issue_id, v_user) on conflict do nothing;
end; $$;

create or replace function public.unwatch_issue(p_issue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.issue_watchers where issue_id = p_issue_id and user_id = v_user;
end; $$;

revoke execute on function public.toggle_watch_issue(uuid), public.watch_issue(uuid), public.unwatch_issue(uuid) from anon, public;
grant execute on function public.toggle_watch_issue(uuid), public.watch_issue(uuid), public.unwatch_issue(uuid) to authenticated;

-- Replace mention notifications with access-aware recipient checks.
create or replace function public.on_comment_mentions_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_match text[]; v_profile record; v_issue record; v_actor uuid := auth.uid();
begin
  select i.issue_number, i.title, i.visibility, i.reporter_id, i.assignee_id, i.project_id into v_issue from public.issues i where i.id = new.issue_id;
  for v_match in select regexp_matches(new.body, '@([A-Za-z0-9_.-]+)', 'g') loop
    select p.id into v_profile from public.profiles p where lower(p.display_name) = lower(v_match[1]) limit 1;
    if found and (v_issue.visibility <> 'RESTRICTED' or v_profile.id = v_issue.reporter_id or v_profile.id = v_issue.assignee_id or exists(select 1 from public.issue_access ia where ia.issue_id = new.issue_id and ia.user_id = v_profile.id) or exists(select 1 from public.project_members pm where pm.project_id = v_issue.project_id and pm.user_id = v_profile.id and pm.role = 'MAINTAINER')) then
      perform public.dispatch_issue_notification(v_profile.id, v_actor, new.issue_id, 'MENTION', jsonb_build_object('issue_number', v_issue.issue_number, 'title', v_issue.title, 'excerpt', left(new.body, 140)));
    end if;
  end loop;
  return new;
end; $$;

-- Migration 036: assignment/status/mention notification coverage

create or replace function public.on_issue_updated_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_watcher record; v_actor uuid := auth.uid(); v_type text; v_data jsonb;
begin
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform public.dispatch_issue_notification(new.assignee_id, v_actor, new.id, 'ASSIGNED', jsonb_build_object('issue_number', new.issue_number, 'title', new.title));
  end if;
  if new.status_id is distinct from old.status_id then
    for v_watcher in select user_id from public.issue_watchers where issue_id = new.id and user_id <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid) loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.id, 'STATUS_CHANGED', jsonb_build_object('issue_number', new.issue_number, 'title', new.title));
    end loop;
  end if;
  return new;
end; $$;

drop trigger if exists trg_issue_updated_notifications on public.issues;
create trigger trg_issue_updated_notifications after update of assignee_id, status_id on public.issues for each row execute procedure public.on_issue_updated_notifications();

create or replace function public.on_comment_mentions_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_match text[]; v_profile record; v_issue record; v_actor uuid := auth.uid();
begin
  select issue_number, title into v_issue from public.issues where id = new.issue_id;
  for v_match in select regexp_matches(new.body, '@([A-Za-z0-9_.-]+)', 'g') loop
    select p.id into v_profile from public.profiles p where lower(p.display_name) = lower(v_match[1]) limit 1;
    if found then
      perform public.dispatch_issue_notification(v_profile.id, v_actor, new.issue_id, 'MENTION', jsonb_build_object('issue_number', v_issue.issue_number, 'title', v_issue.title, 'excerpt', left(new.body, 140)));
    end if;
  end loop;
  return new;
end; $$;

drop trigger if exists trg_comment_mentions_notifications on public.comments;
create trigger trg_comment_mentions_notifications after insert on public.comments for each row execute procedure public.on_comment_mentions_notifications();

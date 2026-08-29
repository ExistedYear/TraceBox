-- Phase 6: complete in-app notification delivery, preferences, and inbox paging.
-- Notifications intentionally remain in-app only. There is no email provider or
-- email delivery contract in this repository.

-- Keep notification rows safe after a recipient loses access to a restricted issue.
drop policy if exists "Users can read their own notifications" on public.notifications;
create policy "Users can read visible notifications"
  on public.notifications for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (issue_id is null or public.can_view_issue(issue_id))
  );

drop policy if exists "Users can update their own notifications" on public.notifications;
create policy "Users can update visible notifications"
  on public.notifications for update to authenticated
  using (
    (select auth.uid()) = user_id
    and (issue_id is null or public.can_view_issue(issue_id))
  )
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own notifications" on public.notifications;
create policy "Users can delete visible notifications"
  on public.notifications for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and (issue_id is null or public.can_view_issue(issue_id))
  );

-- Notification categories are deliberately in-app only. The extra categories
-- cover every retained preference-aware event in the product contract.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type in (
    'ASSIGNED', 'MENTION', 'COMMENT', 'STATUS_CHANGED',
    'ISSUE_LINKED', 'LABEL_CHANGED', 'PLANNING_CHANGED',
    'MILESTONE_CHANGED', 'WATCHED_ISSUE_UPDATED'
  )
);

alter table public.notification_preferences
  add column if not exists issue_links boolean not null default true,
  add column if not exists labels boolean not null default true,
  add column if not exists planning boolean not null default true,
  add column if not exists milestones boolean not null default true;

-- Preference mutations go through update_notification_preferences so callers
-- cannot write a partial or cross-user row through the Data API.
drop policy if exists "Users can update their notification preferences" on public.notification_preferences;
drop policy if exists "Users can insert their notification preferences" on public.notification_preferences;

create index if not exists notifications_user_cursor_idx
  on public.notifications (user_id, created_at desc, id desc);

-- A recipient may only receive a notification when they could currently view
-- the issue. Restricted issue payloads are reduced to a generic marker so a
-- later access revocation cannot expose title, body, project key, or excerpts.
create or replace function public.notification_recipient_can_view_issue(
  p_recipient_id uuid,
  p_issue_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_issue record;
begin
  if p_recipient_id is null or p_issue_id is null then
    return false;
  end if;

  select i.id, i.project_id, i.reporter_id, i.assignee_id,
         coalesce(i.visibility, 'PROJECT') as visibility,
         p.organization_id
    into v_issue
    from public.issues i
    join public.projects p on p.id = i.project_id
   where i.id = p_issue_id;
  if not found then
    return false;
  end if;

  if v_issue.visibility in ('PUBLIC', 'PROJECT') then
    return exists (
      select 1 from public.project_members pm
       where pm.project_id = v_issue.project_id and pm.user_id = p_recipient_id
    ) or exists (
      select 1 from public.organization_members om
       where om.organization_id = v_issue.organization_id
         and om.user_id = p_recipient_id
         and om.role in ('OWNER', 'ADMIN')
    );
  end if;

  return v_issue.reporter_id = p_recipient_id
      or v_issue.assignee_id = p_recipient_id
      or exists (
        select 1 from public.issue_access ia
         where ia.issue_id = p_issue_id and ia.user_id = p_recipient_id
      )
      or exists (
        select 1
          from public.project_members pm
         where pm.project_id = v_issue.project_id
           and pm.user_id = p_recipient_id
           and pm.role = 'MAINTAINER'
      )
      or exists (
        select 1 from public.organization_members om
         where om.organization_id = v_issue.organization_id
           and om.user_id = p_recipient_id
           and om.role in ('OWNER', 'ADMIN')
      );
end;
$$;

revoke execute on function public.notification_recipient_can_view_issue(uuid, uuid) from public, anon, authenticated;

create or replace function public.dispatch_issue_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_issue_id uuid,
  p_type text,
  p_data jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pref record;
  v_issue record;
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_enabled boolean := true;
begin
  if auth.uid() is null or p_recipient_id is null or p_recipient_id = p_actor_id then
    return;
  end if;
  if p_type not in (
    'ASSIGNED', 'MENTION', 'COMMENT', 'STATUS_CHANGED',
    'ISSUE_LINKED', 'LABEL_CHANGED', 'PLANNING_CHANGED',
    'MILESTONE_CHANGED', 'WATCHED_ISSUE_UPDATED'
  ) then
    raise exception 'VALIDATION: Invalid notification type' using errcode = '22023';
  end if;

  if p_issue_id is not null then
    if not public.notification_recipient_can_view_issue(p_recipient_id, p_issue_id) then
      return;
    end if;
    select visibility into v_issue from public.issues where id = p_issue_id;
    if v_issue.visibility = 'RESTRICTED' then
      v_data := jsonb_build_object('restricted', true);
    end if;
  end if;

  select * into v_pref
    from public.notification_preferences
   where user_id = p_recipient_id;
  if found then
    v_enabled := case p_type
      when 'MENTION' then v_pref.mentions
      when 'ASSIGNED' then v_pref.assignments
      when 'COMMENT' then v_pref.comments
      when 'STATUS_CHANGED' then v_pref.status_changes
      when 'WATCHED_ISSUE_UPDATED' then v_pref.watch_updates
      when 'ISSUE_LINKED' then v_pref.issue_links
      when 'LABEL_CHANGED' then v_pref.labels
      when 'PLANNING_CHANGED' then v_pref.planning
      when 'MILESTONE_CHANGED' then v_pref.milestones
      else true
    end;
  end if;

  if v_enabled then
    -- A single event is never inserted twice for the same recipient by a
    -- dispatcher call. Trigger-level callers de-duplicate their recipients.
    insert into public.notifications (user_id, actor_id, issue_id, type, data)
    values (p_recipient_id, nullif(p_actor_id, p_recipient_id), p_issue_id, p_type, v_data);
  end if;
end;
$$;

revoke execute on function public.dispatch_issue_notification(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

revoke execute on function public.on_issue_updated_notifications() from public, anon, authenticated;

-- Exact unread count and cursor-paged history. The RPC applies visibility to
-- stale restricted rows, which also keeps realtime and the inbox consistent.
create or replace function public.get_unread_notifications_count()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return (
    select count(*)::integer
      from public.notifications n
     where n.user_id = v_user
       and n.read_at is null
       and (n.issue_id is null or public.can_view_issue(n.issue_id))
  );
end;
$$;

create or replace function public.list_notifications(
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_unread_only boolean default false,
  p_limit integer default 25
)
returns table (
  id uuid,
  issue_id uuid,
  type text,
  data jsonb,
  actor_id uuid,
  actor_name text,
  issue_number bigint,
  project_key text,
  issue_title text,
  read_at timestamptz,
  created_at timestamptz,
  next_cursor_created_at timestamptz,
  next_cursor_id uuid,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  return query
  with visible as (
    select n.id, n.issue_id, n.type,
           case when coalesce(i.visibility, 'PROJECT') = 'RESTRICTED'
                then jsonb_build_object('restricted', true)
                else n.data end as safe_data,
           n.actor_id, ap.display_name as actor_name,
           i.issue_number, p.key as project_key, i.title as issue_title,
           n.read_at, n.created_at,
           row_number() over (order by n.created_at desc, n.id desc) as rn
      from public.notifications n
      left join public.profiles ap on ap.id = n.actor_id
      left join public.issues i on i.id = n.issue_id
      left join public.projects p on p.id = i.project_id
     where n.user_id = v_user
       and (p_unread_only is not true or n.read_at is null)
       and (n.issue_id is null or public.can_view_issue(n.issue_id))
       and (p_cursor_created_at is null or (n.created_at, n.id) < (p_cursor_created_at, p_cursor_id))
  ), page as (
    select * from visible where rn <= v_limit + 1
  ), boundary as (
    select created_at as boundary_created_at, id as boundary_id
      from page where rn = v_limit
  ), more as (
    select exists (select 1 from page where rn = v_limit + 1) as has_more
  )
  select v.id, v.issue_id, v.type, v.safe_data, v.actor_id, v.actor_name,
         v.issue_number, v.project_key, v.issue_title, v.read_at, v.created_at,
         b.boundary_created_at, b.boundary_id, m.has_more
    from page v cross join more m left join boundary b on true
   where v.rn <= v_limit
   order by v.created_at desc, v.id desc;
end;
$$;

-- Preferences are personal and written atomically through this RPC. No email
-- columns are exposed: delivery is explicitly in-app only.
create or replace function public.get_notification_preferences()
returns table (
  user_id uuid,
  mentions boolean,
  assignments boolean,
  comments boolean,
  status_changes boolean,
  watch_updates boolean,
  issue_links boolean,
  labels boolean,
  planning boolean,
  milestones boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return query
    select v_user, coalesce(p.mentions, true), coalesce(p.assignments, true),
           coalesce(p.comments, true), coalesce(p.status_changes, true),
           coalesce(p.watch_updates, true), coalesce(p.issue_links, true),
           coalesce(p.labels, true), coalesce(p.planning, true),
           coalesce(p.milestones, true), p.updated_at
      from (select 1) seed
      left join public.notification_preferences p on p.user_id = v_user;
end;
$$;

create or replace function public.update_notification_preferences(
  p_mentions boolean,
  p_assignments boolean,
  p_comments boolean,
  p_status_changes boolean,
  p_watch_updates boolean,
  p_issue_links boolean,
  p_labels boolean,
  p_planning boolean,
  p_milestones boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  insert into public.notification_preferences (
    user_id, mentions, assignments, comments, status_changes, watch_updates,
    issue_links, labels, planning, milestones, updated_at
  ) values (
    v_user, coalesce(p_mentions, true), coalesce(p_assignments, true),
    coalesce(p_comments, true), coalesce(p_status_changes, true),
    coalesce(p_watch_updates, true), coalesce(p_issue_links, true),
    coalesce(p_labels, true), coalesce(p_planning, true),
    coalesce(p_milestones, true), timezone('utc'::text, now())
  ) on conflict (user_id) do update set
    mentions = excluded.mentions, assignments = excluded.assignments,
    comments = excluded.comments, status_changes = excluded.status_changes,
    watch_updates = excluded.watch_updates, issue_links = excluded.issue_links,
    labels = excluded.labels, planning = excluded.planning,
    milestones = excluded.milestones, updated_at = excluded.updated_at;
end;
$$;

revoke execute on function public.get_unread_notifications_count(), public.list_notifications(timestamptz, uuid, boolean, integer), public.get_notification_preferences(), public.update_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.get_unread_notifications_count(), public.list_notifications(timestamptz, uuid, boolean, integer), public.get_notification_preferences(), public.update_notification_preferences(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- Rebuild issue lifecycle delivery in one trigger to avoid duplicate watcher
-- rows when assignment/status/planning fields change together.
create or replace function public.on_issue_updated_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watcher record;
  v_actor uuid := auth.uid();
  v_issue_data jsonb := jsonb_build_object('issue_number', new.issue_number, 'title', new.title);
  v_specific boolean := false;
begin
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform public.dispatch_issue_notification(new.assignee_id, v_actor, new.id, 'ASSIGNED', v_issue_data);
    v_specific := true;
  end if;
  if new.status_id is distinct from old.status_id then
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = new.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.id, 'STATUS_CHANGED', v_issue_data);
    end loop;
    v_specific := true;
  end if;
  if new.affected_version_id is distinct from old.affected_version_id
     or new.target_milestone_id is distinct from old.target_milestone_id then
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = new.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.id, 'PLANNING_CHANGED', v_issue_data);
    end loop;
    v_specific := true;
  end if;
  if new.target_milestone_id is distinct from old.target_milestone_id then
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = new.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.id, 'MILESTONE_CHANGED', v_issue_data);
    end loop;
  end if;

  -- Generic watched updates cover edits outside the specialized categories.
  if not v_specific and (
    new.title is distinct from old.title or new.description is distinct from old.description
    or new.priority is distinct from old.priority or new.severity is distinct from old.severity
    or new.type is distinct from old.type or new.component_id is distinct from old.component_id
  ) then
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = new.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.id, 'WATCHED_ISSUE_UPDATED', v_issue_data);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_issue_updated_notifications on public.issues;
create trigger trg_issue_updated_notifications
after update on public.issues
for each row execute procedure public.on_issue_updated_notifications();

-- Link events notify watchers of both visible endpoints, with one recipient per
-- link event. A restricted endpoint is filtered by the dispatcher.
create or replace function public.on_issue_link_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watcher record;
  v_actor uuid := auth.uid();
  v_issue_id uuid;
  v_target_id uuid;
  v_relationship text;
begin
  if tg_op = 'DELETE' then
    v_issue_id := old.source_issue_id;
    v_target_id := old.target_issue_id;
    v_relationship := old.relationship;
  else
    v_issue_id := new.source_issue_id;
    v_target_id := new.target_issue_id;
    v_relationship := new.relationship;
  end if;
  for v_watcher in
    select distinct iw.user_id
      from public.issue_watchers iw
     where iw.issue_id in (v_issue_id, v_target_id)
  loop
    perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, v_issue_id, 'ISSUE_LINKED',
      jsonb_build_object('relationship', v_relationship));
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.on_issue_link_notification() from public, anon, authenticated;

drop trigger if exists trg_issue_link_notification on public.issue_links;
create trigger trg_issue_link_notification
after insert or delete on public.issue_links
for each row execute procedure public.on_issue_link_notification();

-- Labels are changed by set_issue_labels, which replaces a set in one RPC. The
-- RPC below emits one event after the replacement, avoiding delete/insert pairs.
drop trigger if exists trg_issue_labels_insert_notification on public.issue_labels;
drop trigger if exists trg_issue_labels_delete_notification on public.issue_labels;

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
  v_watcher record;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') or not public.can_view_issue(p_issue_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform 1 from public.issues where id = p_issue_id for update;
  delete from public.issue_labels where issue_id = p_issue_id;
  if p_label_ids is not null then
    foreach v_label_id in array p_label_ids loop
      if exists (select 1 from public.labels l where l.id = v_label_id and l.project_id = v_project_id) then
        insert into public.issue_labels (issue_id, label_id) values (p_issue_id, v_label_id) on conflict do nothing;
      end if;
    end loop;
  end if;
  update public.issues set updated_at = timezone('utc'::text, now()) where id = p_issue_id;
  for v_watcher in select distinct user_id from public.issue_watchers where issue_id = p_issue_id loop
    perform public.dispatch_issue_notification(v_watcher.user_id, v_user, p_issue_id, 'LABEL_CHANGED', null);
  end loop;
end;
$$;
revoke execute on function public.set_issue_labels(uuid, uuid[]) from public, anon;
grant execute on function public.set_issue_labels(uuid, uuid[]) to authenticated;

-- Mention matching is case-insensitive but de-duplicated, and every recipient
-- still passes the restricted-access check in dispatch_issue_notification.
create or replace function public.on_comment_mentions_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match text[];
  v_profile record;
  v_issue record;
  v_actor uuid := auth.uid();
begin
  select i.issue_number, i.title into v_issue from public.issues i where i.id = new.issue_id;
  for v_match in select distinct regexp_matches(new.body, '@([A-Za-z0-9_.-]+)', 'gi') loop
    select p.id into v_profile from public.profiles p
     where lower(p.display_name) = lower(v_match[1]) limit 1;
    if found then
      perform public.dispatch_issue_notification(v_profile.id, v_actor, new.issue_id, 'MENTION',
        jsonb_build_object('issue_number', v_issue.issue_number, 'title', v_issue.title, 'excerpt', left(new.body, 140)));
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_comment_mentions_notifications on public.comments;
create trigger trg_comment_mentions_notifications
after insert or update of body on public.comments
for each row execute procedure public.on_comment_mentions_notifications();

-- Comments and comment edits both notify existing watchers. The actor is
-- auto-watched once, and the dispatcher suppresses self-notifications.
create or replace function public.on_comment_changed_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watcher record;
  v_issue record;
  v_actor uuid := auth.uid();
begin
  select i.issue_number, i.title into v_issue from public.issues i where i.id = new.issue_id;
  if not found then return new; end if;
  insert into public.issue_watchers (issue_id, user_id)
  values (new.issue_id, new.author_id)
  on conflict (issue_id, user_id) do nothing;
  for v_watcher in select distinct user_id from public.issue_watchers where issue_id = new.issue_id loop
    perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, new.issue_id, 'COMMENT',
      jsonb_build_object('excerpt', left(new.body, 140), 'issue_number', v_issue.issue_number, 'title', v_issue.title));
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_comment_created_notifications on public.comments;
create trigger trg_comment_changed_notifications
after insert or update of body on public.comments
for each row execute procedure public.on_comment_changed_notifications();

create or replace function public.on_milestone_changed_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue record;
  v_watcher record;
  v_actor uuid := auth.uid();
  v_milestone_id uuid;
begin
  if tg_op = 'DELETE' then v_milestone_id := old.id; else v_milestone_id := new.id; end if;
  for v_issue in select id, issue_number, title from public.issues where target_milestone_id = v_milestone_id loop
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = v_issue.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, v_issue.id, 'MILESTONE_CHANGED',
        jsonb_build_object('issue_number', v_issue.issue_number, 'title', v_issue.title));
    end loop;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_milestone_changed_notifications on public.milestones;
create trigger trg_milestone_changed_notifications
after insert or update or delete on public.milestones
for each row execute procedure public.on_milestone_changed_notifications();

create or replace function public.on_version_changed_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue record;
  v_watcher record;
  v_actor uuid := auth.uid();
  v_version_id uuid;
begin
  if tg_op = 'DELETE' then v_version_id := old.id; else v_version_id := new.id; end if;
  for v_issue in select id, issue_number, title from public.issues where affected_version_id = v_version_id loop
    for v_watcher in select distinct user_id from public.issue_watchers where issue_id = v_issue.id loop
      perform public.dispatch_issue_notification(v_watcher.user_id, v_actor, v_issue.id, 'PLANNING_CHANGED',
        jsonb_build_object('issue_number', v_issue.issue_number, 'title', v_issue.title));
    end loop;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_version_changed_notifications on public.versions;
create trigger trg_version_changed_notifications
after insert or update or delete on public.versions
for each row execute procedure public.on_version_changed_notifications();

revoke execute on function public.on_comment_mentions_notifications() from public, anon, authenticated;
revoke execute on function public.on_comment_changed_notifications() from public, anon, authenticated;
revoke execute on function public.on_milestone_changed_notifications() from public, anon, authenticated;
revoke execute on function public.on_version_changed_notifications() from public, anon, authenticated;

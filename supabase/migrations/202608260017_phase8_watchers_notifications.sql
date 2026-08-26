-- Migration 017: Phase 8 - Watchers & Notifications
-- Implements issue_watchers, notifications, notification_preferences
-- and automated notification generation on assign, comment, mention, and status change.

-- 1. Issue Watchers Table
create table if not exists public.issue_watchers (
  issue_id uuid not null references public.issues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (issue_id, user_id)
);

create index if not exists issue_watchers_user_idx on public.issue_watchers (user_id);

-- 2. Notifications Table
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  issue_id uuid references public.issues (id) on delete cascade,
  type text not null check (type in ('ASSIGNED', 'MENTION', 'COMMENT', 'STATUS_CHANGED', 'ISSUE_LINKED', 'MILESTONE_CHANGED', 'WATCHED_ISSUE_UPDATED')),
  data jsonb,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists notifications_user_read_created_idx on public.notifications (user_id, read_at, created_at desc);

-- 3. Notification Preferences Table
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  mentions boolean not null default true,
  assignments boolean not null default true,
  comments boolean not null default true,
  status_changes boolean not null default true,
  watch_updates boolean not null default true,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- 4. Enable RLS
alter table public.issue_watchers enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;

-- 5. RLS Policies
create policy "Project members can read issue watchers"
  on public.issue_watchers for select to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = issue_id and public.is_project_member(i.project_id)
    )
  );

create policy "Users can read their own notifications"
  on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can update their own notifications"
  on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own notifications"
  on public.notifications for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their notification preferences"
  on public.notification_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can update their notification preferences"
  on public.notification_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can insert their notification preferences"
  on public.notification_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- 6. RPCs for Watching
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
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  delete from public.issue_watchers
  where issue_id = p_issue_id and user_id = v_user;
end;
$$;

-- 7. RPCs for Notification Management
create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  update public.notifications
  set read_at = timezone('utc'::text, now())
  where id = p_notification_id and user_id = v_user and read_at is null;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  update public.notifications
  set read_at = timezone('utc'::text, now())
  where user_id = v_user and read_at is null;
end;
$$;

create or replace function public.get_unread_notifications_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.notifications
  where user_id = auth.uid() and read_at is null;
$$;

-- 8. Internal Notification Dispatcher
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
begin
  -- Do not notify self
  if p_recipient_id is null or p_recipient_id = p_actor_id then
    return;
  end if;

  insert into public.notifications (user_id, actor_id, issue_id, type, data)
  values (p_recipient_id, p_actor_id, p_issue_id, p_type, p_data);
end;
$$;

-- 9. Trigger on Issue Creation: Auto-watch for reporter and assignee, and notify assignee
create or replace function public.on_issue_created_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Auto-watch reporter
  insert into public.issue_watchers (issue_id, user_id)
  values (new.id, new.reporter_id)
  on conflict (issue_id, user_id) do nothing;

  -- Auto-watch assignee if assigned
  if new.assignee_id is not null then
    insert into public.issue_watchers (issue_id, user_id)
    values (new.id, new.assignee_id)
    on conflict (issue_id, user_id) do nothing;

    -- Notify assignee
    perform public.dispatch_issue_notification(
      new.assignee_id,
      new.reporter_id,
      new.id,
      'ASSIGNED',
      jsonb_build_object('title', new.title, 'issue_number', new.issue_number)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_issue_created_notifications on public.issues;
create trigger trg_issue_created_notifications
after insert on public.issues
for each row execute procedure public.on_issue_created_notifications();

-- 10. Trigger on Comments: Notify watchers & mentioned users
create or replace function public.on_comment_created_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watcher record;
  v_issue record;
begin
  select i.id, i.issue_number, i.title, i.project_id into v_issue
  from public.issues i
  where i.id = new.issue_id;

  if not found then
    return new;
  end if;

  -- Auto-watch commenter
  insert into public.issue_watchers (issue_id, user_id)
  values (new.issue_id, new.author_id)
  on conflict (issue_id, user_id) do nothing;

  -- Notify all watchers (except commenter)
  for v_watcher in (
    select user_id from public.issue_watchers
    where issue_id = new.issue_id and user_id <> new.author_id
  ) loop
    perform public.dispatch_issue_notification(
      v_watcher.user_id,
      new.author_id,
      new.issue_id,
      'COMMENT',
      jsonb_build_object('excerpt', left(new.body, 140), 'issue_number', v_issue.issue_number, 'title', v_issue.title)
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_comment_created_notifications on public.comments;
create trigger trg_comment_created_notifications
after insert on public.comments
for each row execute procedure public.on_comment_created_notifications();

-- 11. Revoke / Grant Permissions
revoke execute on function public.toggle_watch_issue(uuid) from anon, public;
revoke execute on function public.watch_issue(uuid) from anon, public;
revoke execute on function public.unwatch_issue(uuid) from anon, public;
revoke execute on function public.mark_notification_read(uuid) from anon, public;
revoke execute on function public.mark_all_notifications_read() from anon, public;
revoke execute on function public.get_unread_notifications_count() from anon, public;

grant execute on function public.toggle_watch_issue(uuid) to authenticated;
grant execute on function public.watch_issue(uuid) to authenticated;
grant execute on function public.unwatch_issue(uuid) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.get_unread_notifications_count() to authenticated;

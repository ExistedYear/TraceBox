-- Phase 12: stable comment mentions.
--
-- Mention recipients are selected by identity, not inferred from arbitrary
-- text. The relation keeps the exact display label used when the comment was
-- last saved, while user_id remains the durable identity for notifications.

create table if not exists public.comment_mentions (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  display_label text not null check (char_length(display_label) between 1 and 120),
  mention_token text not null check (char_length(mention_token) between 1 and 120),
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (comment_id, user_id)
);

comment on table public.comment_mentions is 'Stable comment mention identities; writes go through comment RPCs.';
comment on column public.comment_mentions.display_label is 'Exact profile display label rendered when the mention was saved.';
comment on column public.comment_mentions.mention_token is 'Canonical server-normalized token stored in the comment body.';

-- Keep the compact textarea token deterministic and Unicode-aware. The UI may
-- render this value as @<mention_token>; the relation still stores the exact
-- display label separately for history and accessible labels.
create or replace function public.normalize_mention_token(p_display_label text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(
      regexp_replace(
        regexp_replace(lower(trim(coalesce(p_display_label, ''))), '[[:space:]]+', '-', 'g'),
        '[^[:alnum:]_.-]', '', 'g'
      ),
      ''
    ),
    'member'
  )
$$;

revoke execute on function public.normalize_mention_token(text) from public, anon, authenticated;

create index if not exists comment_mentions_user_idx
  on public.comment_mentions (user_id, comment_id);

alter table public.comment_mentions enable row level security;

create policy "Users can read visible comment mentions"
  on public.comment_mentions
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.comments c
       where c.id = comment_id
         and public.can_view_issue(c.issue_id)
    )
  );

-- Mention rows are not directly writable through the Data API. The RPCs below
-- validate every selected identity and maintain the relation atomically with
-- the comment and its audit event.
revoke insert, update, delete on public.comment_mentions from anon, authenticated, public;
grant select on public.comment_mentions to authenticated;

-- A project-aware, restricted-safe identity lookup for mention autocomplete.
-- Project members and workspace owners/admins are included. When an issue is
-- supplied, candidates must also be able to view that issue.
create or replace function public.list_project_mention_candidates(
  p_project_id uuid,
  p_query text default null,
  p_limit integer default 10,
  p_issue_id uuid default null
)
returns table (user_id uuid, display_label text, mention_token text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := left(trim(coalesce(p_query, '')), 80);
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.projects p
     where p.id = p_project_id and not p.is_archived
  ) or not public.is_project_member(p_project_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_issue_id is not null and not exists (
    select 1 from public.issues i
     where i.id = p_issue_id and i.project_id = p_project_id
       and public.can_view_issue(i.id)
  ) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select p.id, p.display_name, public.normalize_mention_token(p.display_name)
    from public.profiles p
   where nullif(trim(p.display_name), '') is not null
     and (
       exists (
         select 1 from public.project_members pm
          where pm.project_id = p_project_id and pm.user_id = p.id
       )
       or exists (
         select 1
           from public.projects pr
           join public.organizations o on o.id = pr.organization_id
           left join public.organization_members om
             on om.organization_id = o.id and om.user_id = p.id
          where pr.id = p_project_id
            and (o.owner_id = p.id or om.role in ('OWNER', 'ADMIN'))
       )
     )
     and (p_issue_id is null or public.notification_recipient_can_view_issue(p.id, p_issue_id))
     and (v_query = '' or position(lower(v_query) in lower(p.display_name)) > 0)
   order by lower(p.display_name), p.id
   limit v_limit;
end;
$$;

revoke execute on function public.list_project_mention_candidates(uuid, text, integer, uuid) from public, anon;
grant execute on function public.list_project_mention_candidates(uuid, text, integer, uuid) to authenticated;

create or replace function public.add_comment_with_mentions(
  p_issue_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_body text;
  v_comment_id uuid;
  v_ids uuid[] := coalesce(p_mentioned_user_ids, '{}'::uuid[]);
  v_mention record;
  v_identity_count integer;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null or char_length(v_body) > 10000 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_ids) as selected(user_id) where selected.user_id is null) then
    raise exception 'VALIDATION: Too many or invalid mention recipients' using errcode = '22023';
  end if;
  select coalesce(array_agg(selected.user_id order by selected.user_id), '{}'::uuid[])
    into v_ids
    from (select distinct user_id from unnest(v_ids) as selected(user_id)) selected;
  if cardinality(v_ids) > 20 then
    raise exception 'VALIDATION: Too many or invalid mention recipients' using errcode = '22023';
  end if;

  select i.project_id into v_project_id
    from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select p.is_archived into v_archived
    from public.projects p where p.id = v_project_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER')
     or not public.can_view_issue(p_issue_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select count(*) into v_identity_count
    from public.profiles p where p.id = any(v_ids);
  if v_identity_count <> cardinality(v_ids) then
    raise exception 'VALIDATION: Mention recipient was not found' using errcode = '22023';
  end if;
  for v_mention in
    select p.id, p.display_name
      from public.profiles p
     where p.id = any(v_ids)
     order by p.id
  loop
    if nullif(trim(v_mention.display_name), '') is null then
      raise exception 'VALIDATION: Mention recipient has no display label' using errcode = '22023';
    end if;
    if not public.notification_recipient_can_view_issue(v_mention.id, p_issue_id) then
      raise exception 'VALIDATION: Mention recipient is not authorized for this issue' using errcode = '22023';
    end if;
    if position('@' || public.normalize_mention_token(v_mention.display_name) in lower(v_body)) = 0 then
      raise exception 'VALIDATION: Comment must visibly include every selected mention' using errcode = '22023';
    end if;
  end loop;

  insert into public.comments (issue_id, author_id, body)
  values (p_issue_id, v_user, v_body)
  returning id into v_comment_id;

  insert into public.comment_mentions (comment_id, user_id, display_label, mention_token)
  select v_comment_id, p.id, p.display_name, public.normalize_mention_token(p.display_name)
    from public.profiles p where p.id = any(v_ids);

  update public.issues
     set updated_at = timezone('utc'::text, now())
   where id = p_issue_id;
  insert into public.issue_events (issue_id, actor_id, event_type, metadata)
  values (
    p_issue_id,
    v_user,
    'COMMENT_ADDED',
    jsonb_build_object('comment_id', v_comment_id, 'excerpt', left(v_body, 200))
  );

  -- The dispatcher performs preference and restricted-visibility checks. Only
  -- rows inserted by this transaction are notified; text alone never is.
  for v_mention in
    select cm.user_id, cm.display_label, i.issue_number, i.title
      from public.comment_mentions cm
      join public.issues i on i.id = p_issue_id
     where cm.comment_id = v_comment_id
  loop
    perform public.dispatch_issue_notification(
      v_mention.user_id,
      v_user,
      p_issue_id,
      'MENTION',
      jsonb_build_object(
        'issue_number', v_mention.issue_number,
        'title', v_mention.title,
        'excerpt', left(v_body, 140),
        'mention_label', v_mention.display_label
      )
    );
  end loop;
  return v_comment_id;
end;
$$;

create or replace function public.edit_comment_with_mentions(
  p_comment_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[] default null
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
  v_body text;
  v_old record;
  v_ids uuid[];
  v_old_ids uuid[];
  v_added_ids uuid[];
  v_identity_count integer;
  v_ids_same boolean;
  v_body_changed boolean;
  v_existing_label text;
  v_mention record;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null or char_length(v_body) > 10000 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  select c.id, c.issue_id, c.author_id, c.body into v_old
    from public.comments c where c.id = p_comment_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select i.project_id into v_project_id
    from public.issues i where i.id = v_old.issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select p.is_archived into v_archived
    from public.projects p where p.id = v_project_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;
  if not public.can_view_issue(v_old.issue_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_old.author_id <> v_user then
    v_role := public.project_role(v_project_id);
    if v_role not in ('DEVELOPER', 'MAINTAINER') then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  elsif public.project_role(v_project_id) not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Lock and refresh the comment after the project lock for a consistent
  -- projects -> comments ordering and conflict-safe edits.
  select c.id, c.issue_id, c.author_id, c.body into v_old
    from public.comments c where c.id = p_comment_id for update;
  select coalesce(array_agg(cm.user_id order by cm.user_id), '{}'::uuid[])
    into v_old_ids
    from public.comment_mentions cm where cm.comment_id = p_comment_id;
  if p_mentioned_user_ids is null then
    v_ids := v_old_ids;
  else
    if exists (select 1 from unnest(p_mentioned_user_ids) as selected(user_id) where selected.user_id is null) then
      raise exception 'VALIDATION: Too many or invalid mention recipients' using errcode = '22023';
    end if;
    select coalesce(array_agg(selected.user_id order by selected.user_id), '{}'::uuid[])
      into v_ids
      from (select distinct user_id from unnest(p_mentioned_user_ids) as selected(user_id)) selected;
    if cardinality(v_ids) > 20 then
      raise exception 'VALIDATION: Too many or invalid mention recipients' using errcode = '22023';
    end if;
  end if;
  v_ids_same := v_ids = v_old_ids;
  v_body_changed := v_body is distinct from v_old.body;

  select count(*) into v_identity_count
    from public.profiles p where p.id = any(v_ids);
  if v_identity_count <> cardinality(v_ids) then
    raise exception 'VALIDATION: Mention recipient was not found' using errcode = '22023';
  end if;
  for v_mention in
    select p.id, p.display_name from public.profiles p
     where p.id = any(v_ids) order by p.id
  loop
    if nullif(trim(v_mention.display_name), '') is null then
      raise exception 'VALIDATION: Mention recipient has no display label' using errcode = '22023';
    end if;
    if not public.notification_recipient_can_view_issue(v_mention.id, v_old.issue_id) then
      raise exception 'VALIDATION: Mention recipient is not authorized for this issue' using errcode = '22023';
    end if;
    -- A profile rename may leave the old token in an existing comment. It is
    -- still a visible selected mention; retain that row and refresh its copied
    -- label below instead of forcing an edit to fail.
    v_existing_label := null;
    select cm.display_label into v_existing_label
      from public.comment_mentions cm
     where cm.comment_id = p_comment_id and cm.user_id = v_mention.id;
    if position('@' || public.normalize_mention_token(v_mention.display_name) in lower(v_body)) = 0
       and (v_existing_label is null or position('@' || public.normalize_mention_token(v_existing_label) in lower(v_body)) = 0) then
      raise exception 'VALIDATION: Comment must visibly include every selected mention' using errcode = '22023';
    end if;
  end loop;

  select coalesce(array_agg(selected.user_id order by selected.user_id), '{}'::uuid[])
    into v_added_ids
    from (
      select user_id from unnest(v_ids) as selected(user_id)
      except
      select user_id from unnest(v_old_ids) as existing(user_id)
    ) selected;

  if not v_ids_same then
    delete from public.comment_mentions cm
     where cm.comment_id = p_comment_id and not (cm.user_id = any(v_ids));
    insert into public.comment_mentions (comment_id, user_id, display_label, mention_token)
    select p_comment_id, p.id, p.display_name, public.normalize_mention_token(p.display_name)
      from public.profiles p
     where p.id = any(v_ids)
       and not exists (
         select 1 from public.comment_mentions cm
          where cm.comment_id = p_comment_id and cm.user_id = p.id
       );
  end if;
  -- Keep existing row identity (and therefore notification history) while
  -- refreshing the copied label if a profile was renamed.
  update public.comment_mentions cm
     set display_label = p.display_name,
         mention_token = public.normalize_mention_token(p.display_name)
    from public.profiles p
   where cm.comment_id = p_comment_id
     and cm.user_id = p.id
     and (cm.display_label is distinct from p.display_name
       or cm.mention_token is distinct from public.normalize_mention_token(p.display_name));

  if not v_body_changed and v_ids_same then
    return;
  end if;
  update public.comments
     set body = v_body,
         edited_at = case when v_body_changed then timezone('utc'::text, now()) else edited_at end
   where id = p_comment_id;
  update public.issues
     set updated_at = timezone('utc'::text, now())
   where id = v_old.issue_id;
  insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (
    v_old.issue_id,
    v_user,
    'COMMENT_EDITED',
    'comment_id',
    to_jsonb(v_old.id::text),
    to_jsonb(v_body),
    jsonb_build_object('comment_id', v_old.id, 'excerpt', left(v_body, 200))
  );

  -- v_added_ids was computed before relation changes, so unchanged mentions
  -- never receive duplicate notifications on edit.
  for v_mention in
    select cm.user_id, cm.display_label, i.issue_number, i.title
      from public.comment_mentions cm
      join public.issues i on i.id = v_old.issue_id
      where cm.comment_id = p_comment_id and cm.user_id = any(v_added_ids)
  loop
    perform public.dispatch_issue_notification(
      v_mention.user_id,
      v_user,
      v_old.issue_id,
      'MENTION',
      jsonb_build_object(
        'issue_number', v_mention.issue_number,
        'title', v_mention.title,
        'excerpt', left(v_body, 140),
        'mention_label', v_mention.display_label
      )
    );
  end loop;
end;
$$;

revoke execute on function public.add_comment_with_mentions(uuid, text, uuid[]) from public, anon;
revoke execute on function public.edit_comment_with_mentions(uuid, text, uuid[]) from public, anon;
grant execute on function public.add_comment_with_mentions(uuid, text, uuid[]) to authenticated;
grant execute on function public.edit_comment_with_mentions(uuid, text, uuid[]) to authenticated;

-- Legacy browser/API entry points remain compatible but delegate to the
-- identity-aware implementation. They cannot infer or notify arbitrary text.
create or replace function public.add_comment(p_issue_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.add_comment_with_mentions(p_issue_id, p_body, null::uuid[]);
end;
$$;

create or replace function public.edit_comment(p_comment_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- NULL means preserve the existing stable identities while editing text.
  perform public.edit_comment_with_mentions(p_comment_id, p_body, null::uuid[]);
end;
$$;

revoke execute on function public.add_comment(uuid, text), public.edit_comment(uuid, text) from public, anon;
grant execute on function public.add_comment(uuid, text), public.edit_comment(uuid, text) to authenticated;

-- Remove the old regex/profile-name trigger. Stable mention RPCs are the only
-- path that dispatches MENTION notifications after this migration.
drop trigger if exists trg_comment_mentions_notifications on public.comments;
drop function if exists public.on_comment_mentions_notifications();

-- Direct comment writes are RPC-only; SELECT remains governed by comments RLS.
revoke insert, update, delete on public.comments from anon, authenticated, public;

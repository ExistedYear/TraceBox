-- Phase 8: restricted security issue completion.
--
-- Restricted issue rows are already filtered by can_view_issue(). This
-- migration closes the remaining inference and mutation gaps: access changes
-- are auditable, notification payloads are metadata-safe, Storage paths are
-- issue-scoped, and browser writes remain RPC-only.

-- The existing issue_events table is the canonical immutable audit trail. Keep
-- access changes there even when they come from the atomic create RPC or from
-- membership offboarding, not only from the settings UI RPCs.
create or replace function public.record_issue_access_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_target uuid;
begin
  if tg_op = 'INSERT' then
    v_actor := new.granted_by;
    v_target := new.user_id;
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, new_value, metadata)
    values (
      new.issue_id,
      v_actor,
      'ACCESS_GRANTED',
      'issue_access',
      to_jsonb(v_target::text),
      jsonb_build_object('access_action', 'GRANTED', 'target_user_id', v_target)
    );
    return new;
  end if;

  begin
    v_actor := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  exception when invalid_text_representation then
    -- Service-role jobs can use opaque JWT subjects. Preserve the audit row
    -- with an unknown actor instead of silently dropping the event.
    v_actor := null;
  end;
  v_target := old.user_id;
  insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, metadata)
  values (
    old.issue_id,
    v_actor,
    'ACCESS_REVOKED',
    'issue_access',
    to_jsonb(v_target::text),
    jsonb_build_object('access_action', 'REVOKED', 'target_user_id', v_target)
  );
  return old;
end;
$$;

revoke execute on function public.record_issue_access_event() from public, anon, authenticated, service_role;

drop trigger if exists issue_access_audit_insert on public.issue_access;
create trigger issue_access_audit_insert
after insert on public.issue_access
for each row execute procedure public.record_issue_access_event();

drop trigger if exists issue_access_audit_delete on public.issue_access;
create trigger issue_access_audit_delete
after delete on public.issue_access
for each row execute procedure public.record_issue_access_event();

-- Preserve history for grants that predate this table-boundary trigger without
-- duplicating audit rows already written by the legacy grant RPC.
do $backfill_access_history$
declare
  v_previous_role text := current_setting('request.jwt.claim.role', true);
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into public.issue_events (issue_id, actor_id, event_type, field_name, new_value, metadata, created_at)
  select ia.issue_id, ia.granted_by, 'ACCESS_GRANTED', 'issue_access', to_jsonb(ia.user_id::text),
         jsonb_build_object('access_action', 'GRANTED', 'target_user_id', ia.user_id, 'backfilled', true), ia.created_at
    from public.issue_access ia
   where not exists (
     select 1 from public.issue_events e
      where e.issue_id = ia.issue_id
        and e.event_type = 'ACCESS_GRANTED'
        and e.new_value = to_jsonb(ia.user_id::text)
   );
  perform set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
end;
$backfill_access_history$;

-- A restricted issue can only be granted to an active project member (or an
-- organization owner/admin who has workspace-wide project access). Duplicate
-- grants are idempotent and do not create fake history entries.
create or replace function public.grant_issue_access(p_issue_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_issue record;
  v_archived boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_user_id is null then raise exception 'VALIDATION: A user is required' using errcode = '22023'; end if;

  select i.id, i.project_id, i.reporter_id, i.visibility
    into v_issue
    from public.issues i
   where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_issue.visibility <> 'RESTRICTED' then
    raise exception 'VALIDATION: Access grants require restricted visibility' using errcode = '22023';
  end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_issue.project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_actor <> v_issue.reporter_id and public.project_role(v_issue.project_id) not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.project_members pm
     where pm.project_id = v_issue.project_id and pm.user_id = p_user_id
  ) and not exists (
    select 1
      from public.projects p
      join public.organizations o on o.id = p.organization_id
      left join public.organization_members om on om.organization_id = o.id and om.user_id = p_user_id
     where p.id = v_issue.project_id
       and (o.owner_id = p_user_id or om.role in ('OWNER', 'ADMIN'))
  ) then
    raise exception 'VALIDATION: Grantee must have project access' using errcode = '22023';
  end if;

  insert into public.issue_access (issue_id, user_id, granted_by)
  values (p_issue_id, p_user_id, v_actor)
  on conflict (issue_id, user_id) do nothing;
end;
$$;

create or replace function public.revoke_issue_access(p_issue_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_issue record;
  v_archived boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select i.project_id, i.reporter_id, i.visibility into v_issue from public.issues i where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_issue.visibility <> 'RESTRICTED' then
    raise exception 'VALIDATION: Access grants require restricted visibility' using errcode = '22023';
  end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_issue.project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_actor <> v_issue.reporter_id and public.project_role(v_issue.project_id) not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  delete from public.issue_access where issue_id = p_issue_id and user_id = p_user_id;
end;
$$;

-- Reporter/admin visibility controls are allowed only for a currently visible
-- issue. Leaving restricted mode revokes explicit grants so a later re-open of
-- the issue cannot accidentally restore stale confidential access.
create or replace function public.set_issue_visibility(p_issue_id uuid, p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_issue record;
  v_archived boolean;
  v_visibility text := upper(trim(coalesce(p_visibility, 'PROJECT')));
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_visibility not in ('PROJECT', 'RESTRICTED') then raise exception 'VALIDATION: Invalid visibility' using errcode = '22023'; end if;
  select i.id, i.project_id, i.visibility, i.reporter_id into v_issue from public.issues i where i.id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_issue.project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_actor <> v_issue.reporter_id and public.project_role(v_issue.project_id) not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_issue.visibility = v_visibility then return; end if;

  update public.issues set visibility = v_visibility, updated_at = timezone('utc'::text, now()) where id = p_issue_id;
  if v_visibility <> 'RESTRICTED' then
    delete from public.issue_access where issue_id = p_issue_id;
  end if;
  insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value)
  values (p_issue_id, v_actor, 'VISIBILITY_CHANGED', 'visibility', to_jsonb(v_issue.visibility), to_jsonb(v_visibility));
end;
$$;

revoke execute on function public.grant_issue_access(uuid, uuid), public.revoke_issue_access(uuid, uuid), public.set_issue_visibility(uuid, text) from public, anon;
grant execute on function public.grant_issue_access(uuid, uuid), public.revoke_issue_access(uuid, uuid), public.set_issue_visibility(uuid, text) to authenticated;

-- Browser clients may inspect current grants only through the issue's existing
-- RLS visibility. There is no direct grant/revoke path.
revoke insert, update, delete on public.issue_access from public, anon, authenticated;
grant select on public.issue_access to authenticated;
revoke insert, update, delete on public.issue_events from public, anon, authenticated;

-- Privilege revocation is the browser boundary, while the trigger also makes
-- the audit contract true for privileged maintenance clients.
create or replace function public.prevent_issue_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'IMMUTABLE_AUDIT' using errcode = '42501';
end;
$$;
revoke execute on function public.prevent_issue_event_mutation() from public, anon, authenticated, service_role;

drop trigger if exists issue_events_immutable on public.issue_events;
create trigger issue_events_immutable
before update or delete on public.issue_events
for each row execute procedure public.prevent_issue_event_mutation();

create index if not exists issue_access_issue_created_idx on public.issue_access (issue_id, created_at desc);
create index if not exists issues_restricted_queue_idx on public.issues (project_id, updated_at desc, id) where visibility = 'RESTRICTED';

-- Safe path parser for Storage policies. Invalid or non-UUID prefixes return
-- NULL instead of producing a cast error or allowing a policy bypass.
create or replace function public.issue_id_from_storage_path(p_name text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_prefix text;
begin
  v_prefix := split_part(coalesce(p_name, ''), '/', 1);
  if v_prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return null; end if;
  return v_prefix::uuid;
exception when invalid_text_representation then return null;
end;
$$;
revoke execute on function public.issue_id_from_storage_path(text) from public, anon;
grant execute on function public.issue_id_from_storage_path(text) to authenticated;

drop policy if exists "Issue viewers can download attachments" on storage.objects;
create policy "Issue viewers can download attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and public.can_view_issue(public.issue_id_from_storage_path(name))
  );

drop policy if exists "Members can upload issue attachments" on storage.objects;
create policy "Members can upload issue attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and public.can_view_issue(public.issue_id_from_storage_path(name))
    and public.can_comment_on_issue(public.issue_id_from_storage_path(name))
  );

drop policy if exists "Owners and maintainers can delete attachments" on storage.objects;
create policy "Owners and maintainers can delete attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and public.can_view_issue(public.issue_id_from_storage_path(name))
    and exists (
      select 1 from public.issues i join public.projects p on p.id = i.project_id
       where i.id = public.issue_id_from_storage_path(name) and p.is_archived is false
    )
    and (
      owner_id = (select auth.uid()::text)
      or public.can_manage_project((select i.project_id from public.issues i where i.id = public.issue_id_from_storage_path(name)))
    )
  );

drop policy if exists "Members can update issue attachments" on storage.objects;
create policy "Members can update issue attachments"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and owner_id = (select auth.uid()::text)
    and public.can_view_issue(public.issue_id_from_storage_path(name))
    and exists (
      select 1 from public.issues i join public.projects p on p.id = i.project_id
       where i.id = public.issue_id_from_storage_path(name) and p.is_archived is false
    )
  )
  with check (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and owner_id = (select auth.uid()::text)
    and public.can_view_issue(public.issue_id_from_storage_path(name))
    and exists (
      select 1 from public.issues i join public.projects p on p.id = i.project_id
       where i.id = public.issue_id_from_storage_path(name) and p.is_archived is false
    )
  );

-- Restricted notifications are returned only while the recipient can still
-- view the issue. Preserve the key/number needed for a safe authorized link,
-- while redacting title, actor display name, and arbitrary event payload.
create or replace function public.list_notifications(
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_unread_only boolean default false,
  p_limit integer default 25
)
returns table (
  id uuid, issue_id uuid, type text, data jsonb, actor_id uuid, actor_name text,
  issue_number bigint, project_key text, issue_title text, read_at timestamptz,
  created_at timestamptz, next_cursor_created_at timestamptz, next_cursor_id uuid,
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
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return query
  with visible as (
    select n.id, n.issue_id, n.type,
           case when coalesce(i.visibility, 'PROJECT') = 'RESTRICTED' then jsonb_build_object('restricted', true) else n.data end as safe_data,
           n.actor_id, case when coalesce(i.visibility, 'PROJECT') = 'RESTRICTED' then null else ap.display_name end as safe_actor_name,
           i.issue_number as safe_issue_number,
           p.key as safe_project_key,
           case when coalesce(i.visibility, 'PROJECT') = 'RESTRICTED' then null else i.title end as safe_issue_title,
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
  ), page as (select * from visible where rn <= v_limit + 1),
  boundary as (select created_at as boundary_created_at, id as boundary_id from page where rn = v_limit),
  more as (select exists (select 1 from page where rn = v_limit + 1) as has_more)
  select v.id, v.issue_id, v.type, v.safe_data, v.actor_id, v.safe_actor_name,
         v.safe_issue_number, v.safe_project_key, v.safe_issue_title, v.read_at, v.created_at,
         b.boundary_created_at, b.boundary_id, m.has_more
    from page v cross join more m left join boundary b on true
   where v.rn <= v_limit
   order by v.created_at desc, v.id desc;
end;
$$;

revoke execute on function public.list_notifications(timestamptz, uuid, boolean, integer) from public, anon;
grant execute on function public.list_notifications(timestamptz, uuid, boolean, integer) to authenticated;

-- Notification rows are dispatcher-owned. Marking read remains available via
-- the dedicated RPCs, whose functions run with the table owner's privileges.
revoke insert, update, delete on public.notifications from public, anon, authenticated;

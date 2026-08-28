-- Phase 2: workspace membership, invitations, project access, and ownership.
-- Membership rows remain RPC-only. Invitation secrets are returned once to the
-- caller and persisted only as SHA-256 digests.

create extension if not exists pgcrypto;

create table if not exists public.membership_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid references public.projects (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  event_type text not null check (event_type in (
    'INVITATION_CREATED', 'INVITATION_REVOKED', 'INVITATION_ACCEPTED',
    'ORGANIZATION_ROLE_CHANGED', 'PROJECT_MEMBER_ADDED',
    'PROJECT_ROLE_CHANGED', 'PROJECT_MEMBER_REMOVED',
    'ORGANIZATION_MEMBER_REMOVED', 'OWNERSHIP_TRANSFERRED'
  )),
  old_role text,
  new_role text,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists membership_events_org_created_idx
  on public.membership_events (organization_id, created_at desc);
create index if not exists membership_events_project_created_idx
  on public.membership_events (project_id, created_at desc);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  project_id uuid references public.projects (id) on delete set null,
  email text not null check (email = lower(trim(email)) and char_length(email) between 3 and 320),
  organization_role text not null default 'MEMBER' check (organization_role in ('ADMIN', 'MEMBER', 'VIEWER')),
  project_role text check (project_role is null or project_role in ('MAINTAINER', 'DEVELOPER', 'REPORTER', 'VIEWER')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default (timezone('utc'::text, now()) + interval '7 days'),
  invited_by uuid not null references auth.users (id) on delete restrict,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  check (accepted_at is null or accepted_by is not null),
  check (accepted_at is null or revoked_at is null)
);

create index if not exists workspace_invitations_org_idx
  on public.workspace_invitations (organization_id, created_at desc);
create index if not exists workspace_invitations_email_idx
  on public.workspace_invitations (email, expires_at)
  where accepted_at is null and revoked_at is null;
create unique index if not exists workspace_invitations_one_pending_idx
  on public.workspace_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

comment on table public.membership_events is 'Immutable workspace and project membership audit history.';
comment on table public.workspace_invitations is 'Hashed, expiring workspace invitations; raw tokens are never stored.';

alter table public.membership_events enable row level security;
alter table public.workspace_invitations enable row level security;

-- Project access is explicit for ordinary workspace members. Organization
-- owners/admins retain workspace-wide access; existing implicit memberships are
-- backfilled before the helper changes so no one unexpectedly loses access.
insert into public.project_members (project_id, user_id, role)
select p.id, m.user_id, case when m.role = 'VIEWER' then 'VIEWER' else 'REPORTER' end
from public.projects p
join public.organization_members m on m.organization_id = p.organization_id
where m.role not in ('OWNER', 'ADMIN')
  and not exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = m.user_id);

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id and pm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.projects p
    where p.id = p_project_id and public.is_org_admin(p.organization_id)
  );
$$;
revoke execute on function public.is_project_member(uuid) from anon, public;
grant execute on function public.is_project_member(uuid) to authenticated;

drop policy if exists "Org members can read their projects" on public.projects;
create policy "Assigned members can read their projects"
  on public.projects for select to authenticated
  using (public.is_project_member(id));

create or replace function public.can_view_issue(p_issue_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_issue record; v_role text;
begin
  if v_user is null then return false; end if;
  select i.id, i.project_id, i.reporter_id, i.assignee_id, coalesce(i.visibility, 'PROJECT') as visibility into v_issue
    from public.issues i where i.id = p_issue_id;
  if not found or not public.is_project_member(v_issue.project_id) then return false; end if;
  v_role := public.project_role(v_issue.project_id);
  if v_role = 'MAINTAINER' or public.can_manage_project(v_issue.project_id) then return true; end if;
  if v_issue.visibility in ('PROJECT', 'PUBLIC') then return true; end if;
  return v_issue.reporter_id = v_user or v_issue.assignee_id = v_user
    or exists (select 1 from public.issue_access ia where ia.issue_id = p_issue_id and ia.user_id = v_user);
end;
$$;
revoke execute on function public.can_view_issue(uuid) from anon, public;
grant execute on function public.can_view_issue(uuid) to authenticated;

create or replace function public.prevent_membership_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'IMMUTABLE_AUDIT' using errcode = '42501';
end;
$$;

drop trigger if exists membership_events_immutable on public.membership_events;
create trigger membership_events_immutable
before update or delete on public.membership_events
for each row execute procedure public.prevent_membership_history_mutation();

-- The browser can read history/invitations only through RLS; all writes are
-- performed by the security-definer functions below.
create policy "Organization members can read membership history"
  on public.membership_events for select to authenticated
  using (public.is_org_member(organization_id));

create policy "Organization admins can read invitations"
  on public.workspace_invitations for select to authenticated
  using (public.is_org_admin(organization_id));

revoke insert, update, delete on public.organization_members from anon, authenticated, public;
revoke insert, update, delete on public.project_members from anon, authenticated, public;
revoke insert, update, delete on public.membership_events from anon, authenticated, public;
revoke insert, update, delete on public.workspace_invitations from anon, authenticated, public;

create or replace function public.organization_role(p_organization_id uuid, p_user_id uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when o.owner_id = p_user_id then 'OWNER' else m.role end
  from public.organizations o
  left join public.organization_members m
    on m.organization_id = o.id and m.user_id = p_user_id
  where o.id = p_organization_id
    and (o.owner_id = p_user_id or m.user_id is not null)
  limit 1;
$$;

create or replace function public.membership_role_rank(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role
    when 'OWNER' then 4 when 'ADMIN' then 3 when 'MAINTAINER' then 4
    when 'MEMBER' then 2 when 'DEVELOPER' then 3 when 'REPORTER' then 2
    when 'VIEWER' then 1 else 0 end;
$$;

revoke execute on function public.organization_role(uuid, uuid), public.membership_role_rank(text) from anon, public;
revoke execute on function public.organization_role(uuid, uuid) from authenticated;
grant execute on function public.membership_role_rank(text) to authenticated;

create or replace function public.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_organization_role text default 'MEMBER',
  p_project_id uuid default null,
  p_project_role text default null
)
returns table (id uuid, email text, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_id uuid;
  v_expires timestamptz;
  v_old_invitation uuid;
  v_project_archived boolean;
  v_actor_project_role text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_actor_role := public.organization_role(p_organization_id, v_actor);
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'VALIDATION: Invalid email address' using errcode = '22023';
  end if;
  if p_organization_role is null or p_organization_role not in ('ADMIN', 'MEMBER', 'VIEWER')
     or public.membership_role_rank(p_organization_role) > public.membership_role_rank(v_actor_role) then
    raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501';
  end if;
  if p_project_id is not null then
    select p.is_archived into v_project_archived from public.projects p
      where p.id = p_project_id and p.organization_id = p_organization_id for update;
    if not found then
      raise exception 'INVALID_PROJECT' using errcode = '23503';
    end if;
    if v_project_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
    select role into v_actor_project_role from public.project_members where project_id = p_project_id and user_id = v_actor;
    if coalesce(v_actor_role, '') not in ('OWNER', 'ADMIN') and coalesce(v_actor_project_role, '') <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
    if coalesce(v_actor_role, '') not in ('OWNER', 'ADMIN') and p_organization_role <> 'MEMBER' then raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501'; end if;
    if p_project_role is null then raise exception 'VALIDATION: Project role is required' using errcode = '22023'; end if;
    if p_project_role is null or p_project_role not in ('MAINTAINER', 'DEVELOPER', 'REPORTER', 'VIEWER')
       or public.membership_role_rank(p_project_role) > public.membership_role_rank(case when v_actor_role in ('OWNER','ADMIN') then 'MAINTAINER' else v_actor_project_role end) then
      raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501';
    end if;
  elsif p_project_role is not null then
    raise exception 'VALIDATION: Project requires a project role' using errcode = '22023';
  elsif coalesce(v_actor_role, '') not in ('OWNER', 'ADMIN') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  for v_old_invitation in
    select id from public.workspace_invitations
    where organization_id = p_organization_id and email = v_email
      and accepted_at is null and revoked_at is null
    for update
  loop
    update public.workspace_invitations set revoked_at = timezone('utc'::text, now()) where id = v_old_invitation;
    insert into public.membership_events (organization_id, actor_id, event_type, metadata)
    values (p_organization_id, v_actor, 'INVITATION_REVOKED', jsonb_build_object('invitation_id', v_old_invitation, 'reason', 'superseded'));
  end loop;

  insert into public.workspace_invitations (organization_id, project_id, email, organization_role, project_role, token_hash, invited_by)
  values (p_organization_id, p_project_id, v_email, p_organization_role, p_project_role, encode(digest(v_token, 'sha256'), 'hex'), v_actor)
  returning workspace_invitations.id, workspace_invitations.expires_at into v_id, v_expires;

  insert into public.membership_events (organization_id, project_id, actor_id, event_type, new_role, metadata)
  values (p_organization_id, p_project_id, v_actor, 'INVITATION_CREATED', coalesce(p_project_role, p_organization_role), jsonb_build_object('invitation_id', v_id, 'email', v_email));
  return query select v_id, v_email, v_token, v_expires;
end;
$$;

create or replace function public.list_organization_invitations(p_organization_id uuid)
returns table (id uuid, email text, organization_role text, project_id uuid, project_role text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.email, i.organization_role, i.project_id, i.project_role, i.expires_at, i.accepted_at, i.revoked_at, i.created_at
  from public.workspace_invitations i
  where i.organization_id = p_organization_id and public.is_org_admin(p_organization_id)
  order by i.created_at desc;
$$;

create or replace function public.list_project_invitations(p_project_id uuid)
returns table (id uuid, email text, organization_role text, project_id uuid, project_role text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.email, i.organization_role, i.project_id, i.project_role, i.expires_at, i.accepted_at, i.revoked_at, i.created_at
  from public.workspace_invitations i
  join public.projects p on p.id = i.project_id
  where i.project_id = p_project_id
    and (public.is_org_admin(p.organization_id) or exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id and pm.user_id = auth.uid() and pm.role = 'MAINTAINER'
    ))
  order by i.created_at desc;
$$;

create or replace function public.revoke_organization_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_org uuid; v_project uuid; v_actor_project_role text;
begin
  select organization_id, project_id into v_org, v_project from public.workspace_invitations where id = p_invitation_id for update;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_project is not null then select role into v_actor_project_role from public.project_members where project_id = v_project and user_id = v_actor; end if;
  if coalesce(public.organization_role(v_org, v_actor), '') not in ('OWNER','ADMIN') and coalesce(v_actor_project_role, '') <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.workspace_invitations set revoked_at = timezone('utc'::text, now()) where id = p_invitation_id and accepted_at is null and revoked_at is null;
  if found then
    insert into public.membership_events (organization_id, project_id, actor_id, event_type, metadata)
    values (v_org, v_project, v_actor, 'INVITATION_REVOKED', jsonb_build_object('invitation_id', p_invitation_id));
  end if;
end;
$$;

create or replace function public.accept_organization_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid(); v_email text; v_inv public.workspace_invitations%rowtype;
  v_old_org_role text; v_old_project_role text; v_project_archived boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select email into v_email from auth.users where id = v_actor;
  select * into v_inv from public.workspace_invitations where token_hash = encode(digest(trim(coalesce(p_token, '')), 'sha256'), 'hex') for update;
  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_inv.revoked_at is not null then raise exception 'INVITATION_REVOKED' using errcode = '42501'; end if;
  if v_inv.accepted_at is not null then raise exception 'INVITATION_USED' using errcode = '42501'; end if;
  if v_inv.expires_at <= timezone('utc'::text, now()) then raise exception 'INVITATION_EXPIRED' using errcode = '42501'; end if;
  if lower(coalesce(v_email, '')) <> v_inv.email then raise exception 'INVITATION_WRONG_ACCOUNT' using errcode = '42501'; end if;
  if v_inv.project_id is not null then
    select is_archived into v_project_archived from public.projects where id = v_inv.project_id for update;
    if not found then raise exception 'INVALID_PROJECT' using errcode = '23503'; end if;
    if v_project_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  end if;

  select role into v_old_org_role from public.organization_members
    where organization_id = v_inv.organization_id and user_id = v_actor for update;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_inv.organization_id, v_actor, v_inv.organization_role)
    on conflict (organization_id, user_id) do update set role =
    case when public.membership_role_rank(excluded.role) > public.membership_role_rank(organization_members.role)
      then excluded.role else organization_members.role end;
  if v_inv.project_id is not null then
    select role into v_old_project_role from public.project_members
      where project_id = v_inv.project_id and user_id = v_actor for update;
    insert into public.project_members (project_id, user_id, role)
    values (v_inv.project_id, v_actor, v_inv.project_role)
    on conflict (project_id, user_id) do update set role =
      case when public.membership_role_rank(excluded.role) > public.membership_role_rank(project_members.role)
        then excluded.role else project_members.role end;
  end if;
  update public.workspace_invitations set accepted_by = v_actor, accepted_at = timezone('utc'::text, now()) where id = v_inv.id;
  if v_old_org_role is not null and public.membership_role_rank(v_inv.organization_role) > public.membership_role_rank(v_old_org_role) then
    insert into public.membership_events (organization_id, actor_id, target_user_id, event_type, old_role, new_role, metadata)
    values (v_inv.organization_id, v_actor, v_actor, 'ORGANIZATION_ROLE_CHANGED', v_old_org_role, v_inv.organization_role, jsonb_build_object('invitation_id', v_inv.id, 'reason', 'accepted'));
  end if;
  if v_inv.project_id is not null and v_old_project_role is not null and public.membership_role_rank(v_inv.project_role) > public.membership_role_rank(v_old_project_role) then
    insert into public.membership_events (organization_id, project_id, actor_id, target_user_id, event_type, old_role, new_role, metadata)
    values (v_inv.organization_id, v_inv.project_id, v_actor, v_actor, 'PROJECT_ROLE_CHANGED', v_old_project_role, v_inv.project_role, jsonb_build_object('invitation_id', v_inv.id, 'reason', 'accepted'));
  end if;
  insert into public.membership_events (organization_id, project_id, actor_id, target_user_id, event_type, new_role, metadata)
  values (v_inv.organization_id, v_inv.project_id, v_actor, v_actor, 'INVITATION_ACCEPTED', coalesce(v_inv.project_role, v_inv.organization_role), jsonb_build_object('invitation_id', v_inv.id));
  return v_inv.organization_id;
end;
$$;

create or replace function public.add_project_member(p_project_id uuid, p_user_id uuid, p_role text default 'DEVELOPER')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_org uuid; v_archived boolean; v_actor_org_role text; v_actor_project_role text; v_old_role text;
begin
  select organization_id, is_archived into v_org, v_archived from public.projects where id = p_project_id for update;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if v_org is null or not exists (select 1 from public.organization_members where organization_id = v_org and user_id = p_user_id) then raise exception 'INVALID_MEMBER' using errcode = '42501'; end if;
  v_actor_org_role := public.organization_role(v_org, v_actor);
  select role into v_actor_project_role from public.project_members where project_id = p_project_id and user_id = v_actor;
  if coalesce(v_actor_org_role, '') not in ('OWNER','ADMIN') and coalesce(v_actor_project_role, '') <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('MAINTAINER','DEVELOPER','REPORTER','VIEWER') or public.membership_role_rank(p_role) > public.membership_role_rank(case when v_actor_org_role in ('OWNER','ADMIN') then 'MAINTAINER' else v_actor_project_role end) then raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501'; end if;
  select role into v_old_role from public.project_members where project_id = p_project_id and user_id = p_user_id for update;
  if v_old_role is not null and v_old_role = p_role then return; end if;
  insert into public.project_members (project_id, user_id, role) values (p_project_id, p_user_id, p_role)
  on conflict (project_id, user_id) do update set role = excluded.role;
  insert into public.membership_events (organization_id, project_id, actor_id, target_user_id, event_type, old_role, new_role)
  values (v_org, p_project_id, v_actor, p_user_id, case when v_old_role is null then 'PROJECT_MEMBER_ADDED' else 'PROJECT_ROLE_CHANGED' end, v_old_role, p_role);
end;
$$;

create or replace function public.update_organization_member_role(p_organization_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_actor_role text; v_old text;
begin
  v_actor_role := public.organization_role(p_organization_id, v_actor);
  if coalesce(v_actor_role, '') not in ('OWNER','ADMIN') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('ADMIN','MEMBER','VIEWER') or public.membership_role_rank(p_role) > public.membership_role_rank(v_actor_role) then raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501'; end if;
  select role into v_old from public.organization_members where organization_id = p_organization_id and user_id = p_user_id for update;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_user_id = (select owner_id from public.organizations where id = p_organization_id) then raise exception 'OWNER_TRANSFER_REQUIRED' using errcode = '42501'; end if;
  update public.organization_members set role = p_role where organization_id = p_organization_id and user_id = p_user_id;
  insert into public.membership_events (organization_id, actor_id, target_user_id, event_type, old_role, new_role) values (p_organization_id, v_actor, p_user_id, 'ORGANIZATION_ROLE_CHANGED', v_old, p_role);
end;
$$;

create or replace function public.update_project_member_role(p_project_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_org uuid; v_archived boolean; v_actor_org_role text; v_actor_project_role text; v_old text;
begin
  select organization_id, is_archived into v_org, v_archived from public.projects where id = p_project_id for update;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_actor_org_role := public.organization_role(v_org, v_actor);
  select role into v_actor_project_role from public.project_members where project_id = p_project_id and user_id = v_actor;
  if coalesce(v_actor_org_role, '') not in ('OWNER','ADMIN') and coalesce(v_actor_project_role, '') <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('MAINTAINER','DEVELOPER','REPORTER','VIEWER') or public.membership_role_rank(p_role) > public.membership_role_rank(case when v_actor_org_role in ('OWNER','ADMIN') then 'MAINTAINER' else v_actor_project_role end) then raise exception 'ROLE_ABOVE_AUTHORITY' using errcode = '42501'; end if;
  select role into v_old from public.project_members where project_id = p_project_id and user_id = p_user_id for update;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  update public.project_members set role = p_role where project_id = p_project_id and user_id = p_user_id;
  insert into public.membership_events (organization_id, project_id, actor_id, target_user_id, event_type, old_role, new_role) values (v_org, p_project_id, v_actor, p_user_id, 'PROJECT_ROLE_CHANGED', v_old, p_role);
end;
$$;

create or replace function public.remove_project_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_org uuid; v_archived boolean; v_actor_org_role text; v_actor_project_role text; v_old text;
begin
  select organization_id, is_archived into v_org, v_archived from public.projects where id = p_project_id for update;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_actor_org_role := public.organization_role(v_org, v_actor);
  select role into v_actor_project_role from public.project_members where project_id = p_project_id and user_id = v_actor;
  if coalesce(v_actor_org_role, '') not in ('OWNER','ADMIN') and coalesce(v_actor_project_role, '') <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select role into v_old from public.project_members where project_id = p_project_id and user_id = p_user_id for update;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  delete from public.issue_access ia using public.issues i
    where ia.issue_id = i.id and i.project_id = p_project_id and ia.user_id = p_user_id;
  delete from public.issue_watchers iw using public.issues i
    where iw.issue_id = i.id and i.project_id = p_project_id and iw.user_id = p_user_id;
  delete from public.notifications n using public.issues i
    where n.issue_id = i.id and i.project_id = p_project_id and n.user_id = p_user_id;
  delete from public.project_members where project_id = p_project_id and user_id = p_user_id;
  insert into public.membership_events (organization_id, project_id, actor_id, target_user_id, event_type, old_role) values (v_org, p_project_id, v_actor, p_user_id, 'PROJECT_MEMBER_REMOVED', v_old);
end;
$$;

create or replace function public.remove_organization_member(p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_actor_role text; v_old text; v_owner uuid;
begin
  select owner_id into v_owner from public.organizations where id = p_organization_id for update;
  v_actor_role := public.organization_role(p_organization_id, v_actor);
  if coalesce(v_actor_role, '') not in ('OWNER','ADMIN') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_user_id = v_owner then raise exception 'LAST_OWNER' using errcode = '42501'; end if;
  select role into v_old from public.organization_members where organization_id = p_organization_id and user_id = p_user_id for update;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  delete from public.issue_access ia using public.issues i, public.projects p
  where ia.issue_id = i.id and i.project_id = p.id and p.organization_id = p_organization_id and ia.user_id = p_user_id;
  delete from public.issue_watchers iw using public.issues i, public.projects p
  where iw.issue_id = i.id and i.project_id = p.id and p.organization_id = p_organization_id and iw.user_id = p_user_id;
  delete from public.notifications n using public.issues i, public.projects p
  where n.issue_id = i.id and i.project_id = p.id and p.organization_id = p_organization_id and n.user_id = p_user_id;
  delete from public.api_tokens where organization_id = p_organization_id and user_id = p_user_id;
  delete from public.project_members pm using public.projects p where pm.project_id = p.id and p.organization_id = p_organization_id and pm.user_id = p_user_id;
  delete from public.organization_members where organization_id = p_organization_id and user_id = p_user_id;
  insert into public.membership_events (organization_id, actor_id, target_user_id, event_type, old_role) values (p_organization_id, v_actor, p_user_id, 'ORGANIZATION_MEMBER_REMOVED', v_old);
end;
$$;

create or replace function public.transfer_organization_ownership(p_organization_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_old_owner uuid;
begin
  select owner_id into v_old_owner from public.organizations where id = p_organization_id for update;
  if v_old_owner is null or v_actor <> v_old_owner then raise exception 'OWNER_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.organization_members where organization_id = p_organization_id and user_id = p_new_owner_id) then raise exception 'INVALID_MEMBER' using errcode = '42501'; end if;
  if p_new_owner_id = v_old_owner then return; end if;
  update public.organizations set owner_id = p_new_owner_id where id = p_organization_id;
  update public.organization_members set role = 'ADMIN' where organization_id = p_organization_id and user_id = v_old_owner;
  update public.organization_members set role = 'OWNER' where organization_id = p_organization_id and user_id = p_new_owner_id;
  insert into public.membership_events (organization_id, actor_id, target_user_id, event_type, old_role, new_role) values (p_organization_id, v_actor, p_new_owner_id, 'OWNERSHIP_TRANSFERRED', 'OWNER', 'OWNER');
end;
$$;

revoke execute on function public.create_organization_invitation(uuid,text,text,uuid,text), public.list_organization_invitations(uuid), public.list_project_invitations(uuid), public.revoke_organization_invitation(uuid), public.accept_organization_invitation(text), public.add_project_member(uuid,uuid,text), public.update_organization_member_role(uuid,uuid,text), public.update_project_member_role(uuid,uuid,text), public.remove_project_member(uuid,uuid), public.remove_organization_member(uuid,uuid), public.transfer_organization_ownership(uuid,uuid) from anon, public;
grant execute on function public.create_organization_invitation(uuid,text,text,uuid,text), public.list_organization_invitations(uuid), public.list_project_invitations(uuid), public.revoke_organization_invitation(uuid), public.accept_organization_invitation(text), public.add_project_member(uuid,uuid,text), public.update_organization_member_role(uuid,uuid,text), public.update_project_member_role(uuid,uuid,text), public.remove_project_member(uuid,uuid), public.remove_organization_member(uuid,uuid), public.transfer_organization_ownership(uuid,uuid) to authenticated;

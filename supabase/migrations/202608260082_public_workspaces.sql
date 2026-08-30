-- Public workspace discovery and explicit self-service contribution.

alter table public.organizations
  add column if not exists is_public boolean not null default false;

alter table public.membership_events drop constraint if exists membership_events_event_type_check;
alter table public.membership_events add constraint membership_events_event_type_check check (event_type in (
  'INVITATION_CREATED', 'INVITATION_REVOKED', 'INVITATION_ACCEPTED',
  'ORGANIZATION_ROLE_CHANGED', 'PROJECT_MEMBER_ADDED', 'PROJECT_ROLE_CHANGED',
  'PROJECT_MEMBER_REMOVED', 'ORGANIZATION_MEMBER_REMOVED', 'OWNERSHIP_TRANSFERRED',
  'PUBLIC_WORKSPACE_JOINED'
));

create index if not exists organizations_public_created_idx
  on public.organizations (created_at desc, id)
  where is_public = true;

create or replace function public.list_public_organizations(p_limit integer default 50)
returns table (
  id uuid,
  name text,
  slug text,
  member_count bigint,
  project_count bigint,
  already_joined boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.slug,
         (select count(*) from public.organization_members om where om.organization_id = o.id),
         (select count(*) from public.projects p where p.organization_id = o.id and not p.is_archived),
         public.is_org_member(o.id)
    from public.organizations o
   where auth.uid() is not null and o.is_public
   order by o.created_at desc, o.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.set_organization_public(p_organization_id uuid, p_is_public boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not public.is_org_admin(p_organization_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.organizations set is_public = coalesce(p_is_public, false) where id = p_organization_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.join_public_organization(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.organizations o where o.id = p_organization_id and o.is_public) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (p_organization_id, v_user, 'MEMBER')
  on conflict (organization_id, user_id) do nothing;

  insert into public.project_members (project_id, user_id, role)
  select p.id, v_user, 'REPORTER'
    from public.projects p
   where p.organization_id = p_organization_id and not p.is_archived
  on conflict (project_id, user_id) do nothing;

  insert into public.membership_events (organization_id, actor_id, target_user_id, event_type, new_role, metadata)
  values (p_organization_id, v_user, v_user, 'PUBLIC_WORKSPACE_JOINED', 'MEMBER', jsonb_build_object('source', 'directory'));
end;
$$;

revoke execute on function public.list_public_organizations(integer), public.set_organization_public(uuid, boolean), public.join_public_organization(uuid) from public, anon;
grant execute on function public.list_public_organizations(integer), public.set_organization_public(uuid, boolean), public.join_public_organization(uuid) to authenticated;

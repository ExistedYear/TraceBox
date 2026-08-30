-- Allow a signed-in non-owner to leave a workspace without granting direct
-- membership-table writes. The workspace row is locked first to serialize
-- this operation with ownership transfer and administrator removal.

create or replace function public.leave_organization(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_role text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select o.owner_id
    into v_owner
    from public.organizations o
   where o.id = p_organization_id
   for update;

  if v_owner is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select om.role
    into v_role
    from public.organization_members om
   where om.organization_id = p_organization_id
     and om.user_id = v_user
   for update;

  if v_role is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_owner = v_user or v_role = 'OWNER' then
    raise exception 'OWNER_TRANSFER_REQUIRED' using errcode = '42501';
  end if;

  delete from public.issue_access ia
  using public.issues i, public.projects p
  where ia.issue_id = i.id
    and i.project_id = p.id
    and p.organization_id = p_organization_id
    and ia.user_id = v_user;

  delete from public.issue_watchers iw
  using public.issues i, public.projects p
  where iw.issue_id = i.id
    and i.project_id = p.id
    and p.organization_id = p_organization_id
    and iw.user_id = v_user;

  delete from public.notifications n
  using public.issues i, public.projects p
  where n.issue_id = i.id
    and i.project_id = p.id
    and p.organization_id = p_organization_id
    and n.user_id = v_user;

  delete from public.api_tokens
   where organization_id = p_organization_id
     and user_id = v_user;

  delete from public.project_members pm
  using public.projects p
  where pm.project_id = p.id
    and p.organization_id = p_organization_id
    and pm.user_id = v_user;

  delete from public.organization_members
   where organization_id = p_organization_id
     and user_id = v_user;

  insert into public.membership_events (
    organization_id,
    actor_id,
    target_user_id,
    event_type,
    old_role,
    metadata
  ) values (
    p_organization_id,
    v_user,
    v_user,
    'ORGANIZATION_MEMBER_REMOVED',
    v_role,
    jsonb_build_object('source', 'self_service')
  );
end;
$$;

revoke execute on function public.leave_organization(uuid) from public, anon;
grant execute on function public.leave_organization(uuid) to authenticated;

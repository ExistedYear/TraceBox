-- Serialize public joins with visibility changes so a user cannot join after an
-- administrator has made the workspace private.

create or replace function public.join_public_organization(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_inserted integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  perform 1
    from public.organizations o
   where o.id = p_organization_id and o.is_public
   for share;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (p_organization_id, v_user, 'MEMBER')
  on conflict (organization_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    insert into public.project_members (project_id, user_id, role)
    select p.id, v_user, 'REPORTER'
      from public.projects p
     where p.organization_id = p_organization_id and not p.is_archived
    on conflict (project_id, user_id) do nothing;

    insert into public.membership_events (organization_id, actor_id, target_user_id, event_type, new_role, metadata)
    values (p_organization_id, v_user, v_user, 'PUBLIC_WORKSPACE_JOINED', 'MEMBER', jsonb_build_object('source', 'directory'));
  end if;
end;
$$;

revoke execute on function public.join_public_organization(uuid) from public, anon;
grant execute on function public.join_public_organization(uuid) to authenticated;

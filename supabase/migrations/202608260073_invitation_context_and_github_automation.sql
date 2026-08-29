-- Return the accepted invitation's project context without changing the
-- existing UUID-returning function contract used by older clients.
create or replace function public.accept_organization_invitation_context(p_token text)
returns table (organization_id uuid, project_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_token_hash text := encode(digest(trim(coalesce(p_token, '')), 'sha256'), 'hex');
  v_organization_id uuid;
  v_project_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  -- Keep all invitation validation, membership upserts, and audit writes in
  -- the established function. The lookup runs in the same transaction.
  perform public.accept_organization_invitation(p_token);
  select invitation.organization_id, invitation.project_id
    into v_organization_id, v_project_id
    from public.workspace_invitations invitation
   where invitation.token_hash = v_token_hash
     and invitation.accepted_by = v_actor
     and invitation.accepted_at is not null;
  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;

  organization_id := v_organization_id;
  project_id := v_project_id;
  return next;
end;
$$;

revoke execute on function public.accept_organization_invitation_context(text) from anon, public;
grant execute on function public.accept_organization_invitation_context(text) to authenticated;

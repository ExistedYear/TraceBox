-- Qualify the final invitation output-column collision found by plpgsql_check.

do $$
declare
  v_definition text;
  v_fixed text;
begin
  select pg_get_functiondef('public.create_organization_invitation(uuid,text,text,uuid,text)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'update public.workspace_invitations set revoked_at = timezone(''utc''::text, now()) where id = v_old_invitation',
    'update public.workspace_invitations invitation set revoked_at = timezone(''utc''::text, now()) where invitation.id = v_old_invitation'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: create_organization_invitation update'; end if;
  execute v_fixed;
end;
$$;

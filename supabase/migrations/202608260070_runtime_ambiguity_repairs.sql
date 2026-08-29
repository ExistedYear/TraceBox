-- Finish the plpgsql_check ambiguity repairs exposed after the first runtime
-- repair pass. Guard every canonical text rewrite against silent drift.

do $$
declare
  v_definition text;
  v_fixed text;
begin
  select pg_get_functiondef('public.create_organization_invitation(uuid,text,text,uuid,text)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'select id from public.workspace_invitations' || chr(10) ||
    '    where organization_id = p_organization_id and email = v_email' || chr(10) ||
    '      and accepted_at is null and revoked_at is null',
    'select invitation.id from public.workspace_invitations invitation' || chr(10) ||
    '    where invitation.organization_id = p_organization_id and invitation.email = v_email' || chr(10) ||
    '      and invitation.accepted_at is null and invitation.revoked_at is null'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: create_organization_invitation'; end if;
  execute v_fixed;

  select pg_get_functiondef('public.replace_project_workflow(uuid,jsonb,jsonb)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'set name = ''#'' || left(id::text, 39), position = 1000000 + row_number_value, is_initial = false',
    'set name = ''#'' || left(workflow_states.id::text, 39), position = 1000000 + staged.row_number_value, is_initial = false'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: replace_project_workflow'; end if;
  execute v_fixed;

  select pg_get_functiondef('public.request_github_webhook_retry(uuid,text)'::regprocedure)
    into v_definition;
  v_fixed := replace(
    v_definition,
    'request_count = request_count + 1',
    'request_count = github_webhook_retry_requests.request_count + 1'
  );
  if v_fixed = v_definition then raise exception 'REPAIR_TARGET_MISSING: request_github_webhook_retry'; end if;
  execute v_fixed;
end;
$$;

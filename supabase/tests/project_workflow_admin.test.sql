begin;

select plan(14);

select has_function('public', 'update_project_settings', array['uuid', 'text', 'text'], 'project metadata RPC exists');
select has_function('public', 'set_project_archived', array['uuid', 'boolean'], 'project lifecycle RPC exists');
select has_function('public', 'replace_project_workflow', array['uuid', 'jsonb', 'jsonb'], 'atomic workflow RPC exists');
select has_column('public', 'workflow_transitions', 'requires_resolution', 'transition resolution behavior is persisted');
select col_type_is('public', 'workflow_transitions', 'requires_resolution', 'boolean', 'transition resolution flag is boolean');
select has_table('public', 'project_events', 'project audit table exists');
select has_trigger('public', 'project_events', 'project_events_immutable', 'project audit history is immutable');
select ok(not has_table_privilege('authenticated', 'public.projects', 'update'), 'browser cannot update projects directly');
select ok(not has_table_privilege('authenticated', 'public.workflow_states', 'insert,update,delete'), 'browser cannot mutate workflow states directly');
select ok(not has_table_privilege('authenticated', 'public.workflow_transitions', 'insert,update,delete'), 'browser cannot mutate transitions directly');

select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users (id, email) values ('11000000-0000-4000-8000-000000000001', 'workflow-owner@example.test');
insert into public.organizations (id, name, slug, owner_id)
values ('21000000-0000-4000-8000-000000000001', 'Workflow Test', 'workflow-test', '11000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role)
values ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'OWNER');
insert into public.projects (id, organization_id, name, key, slug, created_by)
values ('31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'Workflow Project', 'WF', 'workflow-project', '11000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.replace_project_workflow(
    '31000000-0000-4000-8000-000000000001',
    '[{"clientId":"open","name":"Open","category":"OPEN","position":0,"isInitial":true,"isTerminal":false},{"clientId":"closed","name":"Closed","category":"CLOSED","position":10,"isInitial":false,"isTerminal":true}]'::jsonb,
    '[{"fromClientId":"open","toClientId":"closed","requiredRole":"REPORTER","requiresResolution":true}]'::jsonb
  )$$,
  'maintainer publishes a valid workflow atomically'
);
select is((select count(*) from public.workflow_states where project_id = '31000000-0000-4000-8000-000000000001'), 2::bigint, 'published graph has both states');
select is((select count(*) from public.workflow_transitions where project_id = '31000000-0000-4000-8000-000000000001'), 1::bigint, 'published graph has its transition');
select throws_ok(
  $$select public.replace_project_workflow(
    '31000000-0000-4000-8000-000000000001',
    '[{"clientId":"open","name":"Open","category":"OPEN","position":0,"isInitial":true,"isTerminal":false},{"clientId":"review","name":"Review","category":"REVIEW","position":10,"isInitial":false,"isTerminal":false}]'::jsonb,
    '[{"fromClientId":"open","toClientId":"review","requiredRole":"REPORTER","requiresResolution":false}]'::jsonb
  )$$,
  '22023',
  null,
  'workflow without a terminal state is rejected'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select * from finish();
rollback;

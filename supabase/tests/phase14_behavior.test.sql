-- Phase 14: behavioral database/RLS coverage.
--
-- Existing phase suites cover most object existence contracts.  This suite
-- exercises the security boundaries with two organizations and authenticated
-- JWT claims so a clean migration replay catches cross-tenant regressions.
begin;

select plan(40);

select ok(not has_table_privilege('authenticated', 'public.organizations', 'insert,update,delete'), 'workspace rows are RPC-only');
select ok(not has_table_privilege('authenticated', 'public.issues', 'insert,update,delete'), 'issue rows are RPC-only');
select ok(not has_table_privilege('authenticated', 'public.api_tokens', 'insert,update,delete'), 'API tokens are RPC-only');
select ok(not has_function_privilege('anon', 'public.create_issue_complete(uuid,jsonb)', 'execute'), 'anonymous callers cannot create issues');
select ok(not has_function_privilege('anon', 'public.create_api_token(uuid,text,text,text[],timestamptz)', 'execute'), 'anonymous callers cannot create API tokens');
select ok(not has_function_privilege('authenticated', 'public.record_github_webhook(uuid,uuid,text,text,text,text,text,integer)', 'execute'), 'browser callers cannot record webhook links');
select ok(has_function_privilege('service_role', 'public.record_github_webhook(uuid,uuid,text,text,text,text,text,integer)', 'execute'), 'service role can record webhook links');
select has_policy('storage', 'objects', 'Members can upload issue attachments', 'Storage upload policy exists');
select has_policy('storage', 'objects', 'Issue viewers can download attachments', 'Storage read policy exists');
select has_function('public', 'create_issue_complete', array['uuid','jsonb'], 'atomic issue creation RPC exists');
select has_function('public', 'create_api_token', array['uuid','text','text','text[]','timestamp with time zone'], 'scoped API token RPC exists');
select has_function('public', 'transfer_organization_ownership', array['uuid','uuid'], 'ownership transfer RPC exists');
select has_function('public', 'create_organization_invitation', array['uuid','text','text','uuid','text'], 'invitation RPC exists');
select has_function('public', 'set_project_archived', array['uuid','boolean'], 'archive guard RPC exists');
select has_function('public', 'replace_project_workflow', array['uuid','jsonb','jsonb'], 'workflow validation RPC exists');

-- Seed two tenants as a privileged migration/test session.  All assertions
-- below that concern access run as authenticated users under RLS.
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users (id, email) values
  ('70000000-0000-4000-8000-000000000001', 'phase14-owner@example.test'),
  ('70000000-0000-4000-8000-000000000002', 'phase14-member@example.test'),
  ('70000000-0000-4000-8000-000000000003', 'phase14-outsider@example.test');
insert into public.organizations (id, name, slug, owner_id) values
  ('71000000-0000-4000-8000-000000000001', 'Phase 14 Workspace', 'phase14-workspace', '70000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-000000000002', 'Other Workspace', 'phase14-other', '70000000-0000-4000-8000-000000000003');
insert into public.organization_members (organization_id, user_id, role) values
  ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'OWNER'),
  ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'MEMBER'),
  ('71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003', 'OWNER');
insert into public.projects (id, organization_id, name, key, slug, created_by) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Phase 14 Project', 'P14', 'phase14-project', '70000000-0000-4000-8000-000000000001');
insert into public.project_members (project_id, user_id, role) values
  ('72000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'MAINTAINER'),
  ('72000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'REPORTER');
insert into public.workflow_states (id, project_id, name, category, position, is_initial) values
  ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Open', 'OPEN', 0, true),
  ('73000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', 'Closed', 'CLOSED', 10, false);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.projects where id = '72000000-0000-4000-8000-000000000001'), 0::bigint, 'cross-organization project rows are denied');
select throws_ok($$select public.create_issue_complete('72000000-0000-4000-8000-000000000001', '{"title":"cross tenant","description":"denied"}'::jsonb)$$, '42501', null, 'cross-organization issue creation is denied');
select throws_ok($$select public.create_api_token('71000000-0000-4000-8000-000000000001', 'outsider', repeat('a',64), array['read'])$$, '42501', null, 'cross-organization token creation is denied');
select throws_ok($$select public.transfer_organization_ownership('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002')$$, '42501', null, 'non-owner cannot transfer ownership');
select throws_ok($$select public.record_github_webhook('72000000-0000-4000-8000-000000000001', null::uuid, 'org/repo', 'PULL_REQUEST', 'https://example.test/pr/1', null, 'OPEN', 1)$$, '42501', null, 'authenticated callers cannot use webhook service boundary');

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);
select lives_ok($$select public.transfer_organization_ownership('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002')$$, 'owner can transfer ownership to a member');
select is((select owner_id from public.organizations where id = '71000000-0000-4000-8000-000000000001'), '70000000-0000-4000-8000-000000000002'::uuid, 'ownership transfer changes the workspace owner');
select is((select role from public.organization_members where organization_id = '71000000-0000-4000-8000-000000000001' and user_id = '70000000-0000-4000-8000-000000000001'), 'ADMIN', 'former owner becomes admin');
select is((select role from public.organization_members where organization_id = '71000000-0000-4000-8000-000000000001' and user_id = '70000000-0000-4000-8000-000000000002'), 'OWNER', 'new owner receives owner role');

select is(public.create_issue_complete('72000000-0000-4000-8000-000000000001', '{"title":"first","description":"first description"}'::jsonb), 1::bigint, 'first issue receives number one');
select is(public.create_issue_complete('72000000-0000-4000-8000-000000000001', '{"title":"second","description":"second description"}'::jsonb), 2::bigint, 'second issue receives the next number');
select is((select next_issue_number from public.projects where id = '72000000-0000-4000-8000-000000000001'), 3::bigint, 'issue allocator advances atomically');
select throws_ok($$select public.create_issue_complete('72000000-0000-4000-8000-000000000001', '{"title":"bad"}'::jsonb)$$, '22023', null, 'issue creation requires a description');

select isnt(public.create_api_token('71000000-0000-4000-8000-000000000001', 'read-only', repeat('b',64), array['issues:read']), null::uuid, 'authenticated member can create a scoped API token');
-- The UUID is generated; assert its durable scope and hash instead of relying
-- on the return value being stable.
select is((select scopes from public.api_tokens where user_id = '70000000-0000-4000-8000-000000000001' and name = 'read-only'), array['issues:read']::text[], 'API token scope is persisted exactly');
select throws_ok($$select public.create_api_token('71000000-0000-4000-8000-000000000001', 'invalid', repeat('c',64), array['admin'])$$, '22023', null, 'invalid API scopes are rejected by the RPC contract');

select lives_ok($$select public.create_organization_invitation('71000000-0000-4000-8000-000000000001','new-member@example.test','MEMBER',null,null)$$, 'workspace owner/admin can create an invitation');
select is((select count(*) from public.workspace_invitations where organization_id = '71000000-0000-4000-8000-000000000001' and email = 'new-member@example.test'), 1::bigint, 'invitation is persisted');
select ok((select token_hash <> 'new-member@example.test' and length(token_hash) = 64 from public.workspace_invitations where email = 'new-member@example.test'), 'invitation stores only a SHA-256 token digest');

select lives_ok($$select public.set_project_archived('72000000-0000-4000-8000-000000000001', true)$$, 'maintainer can archive a project');
select throws_ok($$select public.create_issue_complete('72000000-0000-4000-8000-000000000001', '{"title":"archived","description":"denied"}'::jsonb)$$, '42501', null, 'archived projects reject issue creation');
select lives_ok($$select public.set_project_archived('72000000-0000-4000-8000-000000000001', false)$$, 'maintainer can restore a project');

select throws_ok($$select public.replace_project_workflow('72000000-0000-4000-8000-000000000001', '[{"clientId":"only","name":"Only","category":"OPEN","position":0,"isInitial":true,"isTerminal":false}]'::jsonb, '[]'::jsonb)$$, '22023', null, 'workflow without a terminal path is rejected');
select ok((select count(*) from public.membership_events where organization_id = '71000000-0000-4000-8000-000000000001' and event_type = 'OWNERSHIP_TRANSFERRED') = 1, 'ownership transfer is audited');
select ok((select count(*) from public.issue_events where issue_id in (select id from public.issues where project_id = '72000000-0000-4000-8000-000000000001') and event_type = 'ISSUE_CREATED') = 2, 'issue creation writes immutable audit events');

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select * from finish();
rollback;

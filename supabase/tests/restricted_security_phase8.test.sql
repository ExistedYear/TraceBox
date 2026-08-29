begin;

select plan(21);

select has_table('public', 'issue_access', 'restricted access grant table exists');
select has_function('public', 'can_view_issue', array['uuid'], 'restricted visibility helper exists');
select has_function('public', 'grant_issue_access', array['uuid', 'uuid'], 'grant RPC exists');
select has_function('public', 'revoke_issue_access', array['uuid', 'uuid'], 'revoke RPC exists');
select has_function('public', 'set_issue_visibility', array['uuid', 'text'], 'visibility RPC exists');
select has_trigger('public', 'issue_access', 'issue_access_audit_insert', 'initial and granted access is audited');
select has_trigger('public', 'issue_access', 'issue_access_audit_delete', 'revoked access is audited');
select ok(not has_table_privilege('authenticated', 'public.issue_access', 'insert,update,delete'), 'browser cannot mutate access grants directly');
select ok(not has_table_privilege('authenticated', 'public.issue_events', 'insert,update,delete'), 'browser cannot mutate the immutable audit trail directly');
select ok(has_table_privilege('authenticated', 'storage.objects', 'select'), 'authenticated can use Storage policies for safe downloads');
select ok(not has_function_privilege('authenticated', 'public.record_issue_access_event()', 'execute'), 'audit trigger function is not a browser RPC');
select ok(not has_function_privilege('anon', 'public.list_notifications(timestamptz,uuid,boolean,integer)', 'execute'), 'anonymous callers cannot query notification history');

-- Exercise real allow/deny behavior under the authenticated role. Seed as a
-- privileged migration/test session, then rely exclusively on RLS policies.
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'security-owner@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'security-allowed@example.test'),
  ('10000000-0000-4000-8000-000000000003', 'security-denied@example.test');

insert into public.organizations (id, name, slug, owner_id)
values ('20000000-0000-4000-8000-000000000001', 'Security Test', 'security-test', '10000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'OWNER'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'MEMBER'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'MEMBER');
insert into public.projects (id, organization_id, name, key, slug, created_by)
values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Security Project', 'SEC', 'security-project', '10000000-0000-4000-8000-000000000001');
insert into public.project_members (project_id, user_id, role) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'MAINTAINER'),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'REPORTER'),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'REPORTER');
insert into public.workflow_states (id, project_id, name, category, position, is_initial)
values ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Open', 'OPEN', 0, true);
insert into public.issues (id, project_id, issue_number, title, type, status_id, reporter_id, visibility)
values ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1, 'Restricted test issue', 'SECURITY', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'RESTRICTED');
insert into public.issue_access (issue_id, user_id, granted_by)
values ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
insert into storage.objects (bucket_id, name, owner_id)
values ('issue-attachments', '50000000-0000-4000-8000-000000000001/evidence.txt', '10000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.issues where id = '50000000-0000-4000-8000-000000000001'), 1::bigint, 'explicit grantee can select restricted issue');
select is(public.can_view_issue('50000000-0000-4000-8000-000000000001'), true, 'explicit grantee passes visibility helper');
select is((select count(*) from public.issue_access where issue_id = '50000000-0000-4000-8000-000000000001'), 1::bigint, 'explicit grantee can read access list');
select is((select count(*) from storage.objects where name = '50000000-0000-4000-8000-000000000001/evidence.txt'), 1::bigint, 'explicit grantee can download issue attachment');
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('issue-attachments', '50000000-0000-4000-8000-000000000001/grantee.txt', '10000000-0000-4000-8000-000000000002', '{"mimetype":"text/plain"}'::jsonb)$$,
  'authorized reporter can upload to a visible active issue'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.issues where id = '50000000-0000-4000-8000-000000000001'), 0::bigint, 'ungranted member cannot select restricted issue');
select is(public.can_view_issue('50000000-0000-4000-8000-000000000001'), false, 'ungranted member fails visibility helper');
select is((select count(*) from public.issue_access where issue_id = '50000000-0000-4000-8000-000000000001'), 0::bigint, 'ungranted member cannot infer access-list rows');
select is((select count(*) from storage.objects where name = '50000000-0000-4000-8000-000000000001/evidence.txt'), 0::bigint, 'ungranted member cannot infer attachment objects');

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select * from finish();
rollback;

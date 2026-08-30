begin;

select plan(35);

select has_table('public', 'ai_analysis_cache', 'opaque AI cache table exists');
select has_table('public', 'ai_request_ledger', 'AI request ledger exists');
select has_function('public', 'claim_ai_analysis', array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'integer', 'uuid[]'], 'single-flight claim RPC exists');
select has_function('public', 'get_ai_analysis_cache', array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text'], 'authorized cache read RPC exists');
select has_function('public', 'complete_ai_analysis', array['uuid', 'jsonb', 'integer'], 'owned completion RPC exists');
select has_function('public', 'fail_ai_analysis', array['uuid', 'text'], 'owned failure RPC exists');
select has_function('public', 'cleanup_ai_analysis_cache', array['timestamptz'], 'service cleanup RPC exists');
select has_function('public', 'apply_issue_triage_updates', array['uuid', 'jsonb', 'timestamptz'], 'atomic triage apply RPC exists');
select has_function('public', 'get_issue_blast_radius_context', array['uuid', 'integer'], 'safe blast-radius context RPC exists');
select ok((select relrowsecurity from pg_class where oid = 'public.ai_analysis_cache'::regclass), 'AI cache has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.ai_request_ledger'::regclass), 'AI ledger has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.ai_analysis_cache', 'select,insert,update,delete'), 'authenticated callers cannot directly mutate or read the cache');
select ok(not has_table_privilege('authenticated', 'public.ai_request_ledger', 'select,insert,update,delete'), 'authenticated callers cannot directly mutate or read the request ledger');
select ok(not has_function_privilege('anon', 'public.cleanup_ai_analysis_cache(timestamptz)', 'execute'), 'anonymous callers cannot invoke broad cleanup');
select ok(not has_function_privilege('authenticated', 'public.cleanup_ai_analysis_cache(timestamptz)', 'execute'), 'authenticated callers cannot invoke broad cleanup');

-- Disposable two-workspace fixture. Direct setup uses a privileged migration
-- session; all assertions below switch to the authenticated role and claims.
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users (id, email) values
  ('81000000-0000-4000-8000-000000000001', 'intel-owner@example.test'),
  ('81000000-0000-4000-8000-000000000002', 'intel-peer@example.test'),
  ('81000000-0000-4000-8000-000000000003', 'intel-outsider@example.test')
on conflict (id) do nothing;
insert into public.organizations (id, name, slug, owner_id)
values ('82000000-0000-4000-8000-000000000001', 'Intelligence Test', 'intelligence-test', '81000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;
insert into public.organization_members (organization_id, user_id, role) values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'OWNER'),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'MEMBER')
on conflict do nothing;
insert into public.projects (id, organization_id, name, key, slug, created_by)
values ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'Intelligence Project', 'INT', 'intelligence-project', '81000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;
insert into public.project_members (project_id, user_id, role) values
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'MAINTAINER'),
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'DEVELOPER')
on conflict do nothing;
insert into public.workflow_states (id, project_id, name, category, position, is_initial) values
  ('84000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'Open', 'OPEN', 0, true),
  ('84000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', 'Resolved', 'RESOLVED', 1, false)
on conflict (id) do nothing;
insert into public.workflow_transitions (project_id, from_state_id, to_state_id, required_role)
values ('83000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000002', null)
on conflict do nothing;
insert into public.issues (id, project_id, issue_number, title, type, status_id, reporter_id, visibility) values
  ('85000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 1, 'Root issue', 'BUG', '84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'PROJECT'),
  ('85000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', 2, 'Safe linked issue', 'BUG', '84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'PROJECT'),
  ('85000000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000001', 3, 'Security linked issue', 'SECURITY', '84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'PROJECT'),
  ('85000000-0000-4000-8000-000000000004', '83000000-0000-4000-8000-000000000001', 4, 'Restricted linked issue', 'BUG', '84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'RESTRICTED'),
  ('85000000-0000-4000-8000-000000000005', '83000000-0000-4000-8000-000000000001', 5, 'Second safe issue', 'BUG', '84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'PROJECT')
on conflict (id) do nothing;
insert into public.issue_links (source_issue_id, target_issue_id, relationship, created_by) values
  ('85000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000002', 'RELATES_TO', '81000000-0000-4000-8000-000000000001'),
  ('85000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000003', 'BLOCKS', '81000000-0000-4000-8000-000000000001'),
  ('85000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000004', 'DEPENDS_ON', '81000000-0000-4000-8000-000000000001'),
  ('85000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000005', 'RELATES_TO', '81000000-0000-4000-8000-000000000001')
on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into public.ai_analysis_cache (viewer_id, project_id, feature, input_hash, model_version, schema_version, prompt_version, expires_at) values ('81000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('f',64), 'm', 's', 'p', now())$$,
  '42501', null, 'authenticated callers cannot insert cache rows directly'
);
select throws_ok(
  $$insert into public.ai_request_ledger (requester_id, project_id, feature, input_hash, model_version, schema_version, prompt_version, lease_until) values ('81000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('f',64), 'm', 's', 'p', now())$$,
  '42501', null, 'authenticated callers cannot insert request rows directly'
);

select is((select status from public.claim_ai_analysis(
  '83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('a', 64), 'model-1', 'schema-1', 'prompt-1', 60
)), 'CLAIMED', 'first equivalent request claims the single-flight lease');
select is((select status from public.claim_ai_analysis(
  '83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('a', 64), 'model-1', 'schema-1', 'prompt-1', 60
)), 'PENDING', 'concurrent equivalent request returns PENDING');
select set_config('tracebox.test_request_id', (select request_id::text from public.claim_ai_analysis(
  '83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('a', 64), 'model-1', 'schema-1', 'prompt-1', 60
)), true);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.complete_ai_analysis(current_setting('tracebox.test_request_id')::uuid, '{"summary":"ok"}'::jsonb, 60)$$,
  '42501', null, 'a different user cannot complete another user request'
);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.complete_ai_analysis(c.request_id, '{"summary":"ok"}'::jsonb, 60) from public.claim_ai_analysis('83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('a',64), 'model-1', 'schema-1', 'prompt-1', 60) c$$,
  'request owner can complete a bounded result'
);
select is((select count(*) from public.get_ai_analysis_cache(
  '83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('a', 64), 'model-1', 'schema-1', 'prompt-1'
)), 1::bigint, 'owner can read an unexpired authorized cache result');
select is((select status from public.claim_ai_analysis(
  '83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('a', 64), 'model-1', 'schema-1', 'prompt-1', 60
)), 'HIT', 'equivalent request returns a cache HIT');

-- A project member cannot read another viewer''s cache. A project-level
-- membership revocation and an issue restriction both invalidate live reads.
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.get_ai_analysis_cache(
  '83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('a', 64), 'model-1', 'schema-1', 'prompt-1'
)), 0::bigint, 'another project member cannot read a viewer-scoped cache');
select lives_ok(
  $$select public.complete_ai_analysis(c.request_id, '{"summary":"peer"}'::jsonb, 60) from public.claim_ai_analysis('83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('e',64), 'model-peer', 'schema-1', 'prompt-1', 60) c$$,
  'second viewer can create an independent cache entry'
);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select status from public.claim_ai_analysis('83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('c',64), 'model-1', 'schema-1', 'prompt-1', 60)$$,
  '42501', null, 'a member of another project cannot claim there'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.issues set visibility = 'RESTRICTED' where id = '85000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select count(*) from public.get_ai_analysis_cache('83000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'TRIAGE', repeat('e',64), 'model-peer', 'schema-1', 'prompt-1')$$,
  '42501', null, 'cache becomes unreadable when issue visibility is restricted'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.ai_request_ledger (requester_id, project_id, feature, input_hash, model_version, schema_version, prompt_version, status, lease_until, completed_at)
select '81000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', 'TRIAGE', lpad(to_hex(g), 64, 'b'), 'model-budget', 'schema-1', 'prompt-1', 'COMPLETED', now(), now()
from generate_series(1, 30) g;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select is((select status from public.claim_ai_analysis(
  '83000000-0000-4000-8000-000000000001', null, 'TRIAGE', repeat('d', 64), 'model-budget', 'schema-1', 'prompt-1', 60
)), 'RATE_LIMITED', 'per-user request budget returns RATE_LIMITED');

-- Deterministic context excludes security/restricted linked rows.
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.get_issue_blast_radius_context('85000000-0000-4000-8000-000000000002', 50)), 1::bigint, 'blast-radius context returns only safe linked issues');
select is((select count(*) from public.get_issue_blast_radius_context('85000000-0000-4000-8000-000000000002', 50) where issue_id in ('85000000-0000-4000-8000-000000000003', '85000000-0000-4000-8000-000000000004')), 0::bigint, 'blast-radius context omits security and restricted issues');

select lives_ok(
  $$select public.complete_ai_analysis(c.request_id, '{"summary":"release"}'::jsonb, 60) from public.claim_ai_analysis('83000000-0000-4000-8000-000000000001', null, 'RELEASE_RISK', repeat('9',64), 'model-release', 'schema-1', 'prompt-1', 60, array['85000000-0000-4000-8000-000000000005']::uuid[]) c$$,
  'project cache records every issue that contributed provider context'
);
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.issues set visibility = 'RESTRICTED' where id = '85000000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.get_ai_analysis_cache(
  '83000000-0000-4000-8000-000000000001', null, 'RELEASE_RISK', repeat('9', 64), 'model-release', 'schema-1', 'prompt-1'
)), 0::bigint, 'project cache becomes unreadable when any contributing issue becomes restricted');

-- Valid priority followed by invalid assignment must roll back as one transaction.
select throws_ok(
  $$select public.apply_issue_triage_updates('85000000-0000-4000-8000-000000000002', '{"priority":"P0","assignee_id":"81000000-0000-4000-8000-000000000003"}'::jsonb, (select updated_at from public.issues where id = '85000000-0000-4000-8000-000000000002'))$$,
  '23503', null, 'invalid assignment aborts the complete triage transaction'
);
select is((select priority from public.issues where id = '85000000-0000-4000-8000-000000000002'), 'P2', 'atomic triage failure leaves earlier priority update untouched');

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.ai_analysis_cache set expires_at = now() - interval '1 second' where feature = 'TRIAGE' and input_hash = repeat('a', 64);
select is(public.cleanup_ai_analysis_cache(now()), 1, 'service cleanup removes expired cache rows');

select * from finish();
rollback;

begin;

select plan(10);
select has_function('public', 'bulk_update_issue_fields', array['uuid', 'uuid[]', 'jsonb'], 'bulk issue update RPC exists');
select has_index('public', 'issues', 'issues_queue_reporter_created_idx', 'reporter/date queue index exists');
select has_index('public', 'issues', 'issues_queue_version_idx', 'version queue index exists');
select has_index('public', 'issues', 'issues_queue_milestone_idx', 'milestone queue index exists');
select has_index('public', 'issue_labels', 'issue_labels_issue_label_idx', 'label queue index exists');
select ok(not has_function_privilege('anon', 'public.bulk_update_issue_fields(uuid,uuid[],jsonb)', 'execute'), 'anonymous callers cannot bulk update');
select ok(has_function_privilege('authenticated', 'public.bulk_update_issue_fields(uuid,uuid[],jsonb)', 'execute'), 'authenticated callers can invoke the guarded RPC');
select ok(not has_table_privilege('authenticated', 'public.issues', 'insert,update,delete'), 'bulk mutation remains RPC-only');
select ok(not has_table_privilege('authenticated', 'public.issue_events', 'insert,update,delete'), 'bulk audit rows remain immutable');
select * from finish();
rollback;

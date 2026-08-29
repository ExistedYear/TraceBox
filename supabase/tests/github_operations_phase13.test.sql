begin;

select plan(19);

select has_table('public', 'github_webhook_retry_requests', 'idempotent retry request table exists');
select has_table('public', 'github_webhook_delivery_issues', 'optional delivery to issue linkage exists');
select has_function('public', 'get_github_operations', array['uuid'], 'operations JSON read model exists');
select has_function('public', 'list_github_webhook_deliveries', array['uuid', 'integer', 'integer'], 'delivery history RPC exists');
select has_function('public', 'request_github_webhook_retry', array['uuid', 'text'], 'row-returning retry RPC exists');
select has_function('public', 'retry_github_webhook_delivery', array['uuid', 'text'], 'boolean retry compatibility RPC exists');
select has_function('public', 'record_github_webhook_delivery_issue', array['text', 'uuid', 'uuid', 'text', 'boolean'], 'delivery issue association RPC exists');
select has_function('public', 'mark_github_webhook_delivery', array['text', 'text', 'text', 'timestamp with time zone', 'text'], 'categorized delivery marker exists');
select has_column('public', 'github_webhook_deliveries', 'failure_category', 'safe failure category column exists');
select has_column('public', 'github_webhook_deliveries', 'failed_at', 'failure timestamp exists');
select has_column('public', 'github_webhook_deliveries', 'retry_requested_at', 'retry request timestamp exists');
select has_index('public', 'github_webhook_deliveries', 'github_webhook_deliveries_history_idx', 'delivery history index exists');
select ok(not has_table_privilege('authenticated', 'public.github_webhook_retry_requests', 'select'), 'retry request rows are not directly readable');
select ok(not has_table_privilege('authenticated', 'public.github_webhook_delivery_issues', 'select'), 'delivery issue rows are not directly readable');
select ok(not has_function_privilege('anon', 'public.get_github_operations(uuid)', 'execute'), 'anonymous callers cannot read operations');
select ok(has_function_privilege('authenticated', 'public.get_github_operations(uuid)', 'execute'), 'authenticated callers can use guarded operations RPC');
select ok(has_function_privilege('authenticated', 'public.retry_github_webhook_delivery(uuid,text)', 'execute'), 'authenticated callers can use guarded retry RPC');
select ok(not has_function_privilege('anon', 'public.retry_github_webhook_delivery(uuid,text)', 'execute'), 'anonymous callers cannot retry deliveries');
select ok(position('project_role' in pg_get_functiondef('public.request_github_webhook_retry(uuid,text)'::regprocedure)) > 0, 'retry authorization is owned by the database');

select * from finish();
rollback;

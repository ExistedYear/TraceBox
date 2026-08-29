begin;

select plan(11);

select has_function('public', 'update_issue_fields', array['uuid', 'jsonb'], 'shared issue update RPC exists');
select has_function('public', 'update_issue_fields', array['uuid', 'jsonb', 'timestamptz'], 'conflict-aware issue update RPC exists');
select has_function('public', 'create_issue_complete', array['uuid', 'jsonb'], 'atomic browser create RPC exists');
select has_function('public', 'api_create_issue', array['text', 'jsonb'], 'REST create wrapper exists');
select ok(has_function_privilege('authenticated', 'public.create_issue_complete(uuid,jsonb)', 'execute'), 'authenticated reporters can call atomic create');
select ok(not has_function_privilege('anon', 'public.create_issue_complete(uuid,jsonb)', 'execute'), 'anonymous users cannot call atomic create');
select ok(not has_table_privilege('authenticated', 'public.issues', 'insert'), 'browser cannot bypass atomic issue creation');
select ok(not has_table_privilege('authenticated', 'public.issue_events', 'insert,update,delete'), 'browser cannot mutate issue audit history');
select has_trigger('public', 'issues', 'enforce_issue_visibility_on_issues', 'restricted visibility guards issue updates');
select has_trigger('public', 'issue_custom_values', 'enforce_issue_visibility_on_custom_values', 'restricted visibility guards custom values');
select has_trigger('public', 'issue_events', 'issue_events_immutable', 'issue audit history is immutable');

select * from finish();
rollback;

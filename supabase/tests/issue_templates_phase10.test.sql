begin;

select plan(11);
select has_column('public', 'issue_templates', 'is_archived', 'templates support archive/restore');
select has_table('public', 'issue_template_labels', 'templates support default labels');
select has_function('public', 'set_issue_template_labels', array['uuid', 'uuid[]'], 'label configuration RPC exists');
select has_function('public', 'set_issue_template_archived', array['uuid', 'boolean'], 'archive/restore RPC exists');
select has_function('public', 'duplicate_issue_template', array['uuid', 'text'], 'duplication RPC exists');
select has_function('public', 'create_issue_complete', array['uuid', 'jsonb'], 'creation wrapper applies template defaults');
select ok(not has_table_privilege('authenticated', 'public.issue_template_labels', 'insert,update,delete'), 'template labels remain RPC-only');
select ok(not has_function_privilege('anon', 'public.set_issue_template_archived(uuid,boolean)', 'execute'), 'anonymous users cannot archive templates');
select ok(not has_function_privilege('authenticated', 'public.create_issue_complete_base(uuid,jsonb)', 'execute'), 'authenticated users cannot bypass template validation wrapper');
select has_function('public', 'create_issue_template_complete', array['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'uuid', 'uuid[]'], 'atomic template create RPC exists');
select has_function('public', 'update_issue_template_complete', array['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'uuid', 'uuid[]'], 'atomic template update RPC exists');
select * from finish();
rollback;

begin;

select plan(20);

select has_function('public', 'create_custom_field', array['uuid', 'text', 'text', 'jsonb', 'boolean'], 'custom field creation RPC exists');
select has_function('public', 'update_custom_field', array['uuid', 'text', 'text', 'jsonb', 'boolean'], 'custom field configuration RPC exists');
select has_function('public', 'delete_custom_field', array['uuid'], 'custom field deletion RPC exists');
select has_function('public', 'set_issue_custom_value', array['uuid', 'uuid', 'jsonb'], 'single-value RPC exists');
select has_function('public', 'bulk_set_issue_custom_value', array['uuid[]', 'uuid', 'jsonb'], 'authorized bulk value RPC exists');
select has_function('public', 'validate_custom_field_value', array['uuid', 'jsonb'], 'database value validator exists');
select has_trigger('public', 'issue_custom_values', 'validate_issue_custom_value', 'all value writes are validated');
select has_trigger('public', 'custom_fields', 'validate_custom_field_definition', 'all field definitions are validated');
select ok(not has_table_privilege('authenticated', 'public.custom_fields', 'insert,update,delete'), 'custom field writes remain RPC-only');
select ok(not has_table_privilege('authenticated', 'public.issue_custom_values', 'insert,update,delete'), 'custom values remain RPC-only');
select ok(has_function_privilege('authenticated', 'public.update_custom_field(uuid,text,text,jsonb,boolean)', 'execute'), 'authenticated maintainers can call field update RPC');
select ok(not has_function_privilege('anon', 'public.update_custom_field(uuid,text,text,jsonb,boolean)', 'execute'), 'anonymous users cannot call field update RPC');
select ok(has_function_privilege('authenticated', 'public.bulk_set_issue_custom_value(uuid[],uuid,jsonb)', 'execute'), 'authenticated users can call authorized bulk RPC');
select ok(not has_function_privilege('anon', 'public.bulk_set_issue_custom_value(uuid[],uuid,jsonb)', 'execute'), 'anonymous users cannot call bulk RPC');
select ok(position('Cannot change field type after values exist' in pg_get_functiondef('public.update_custom_field(uuid,text,text,jsonb,boolean)'::regprocedure)) > 0, 'type changes with existing values are rejected');
select ok(position('Existing values use an option that would be removed' in pg_get_functiondef('public.update_custom_field(uuid,text,text,jsonb,boolean)'::regprocedure)) > 0, 'select option removal is rejected when referenced');
select ok(position('Duplicate issue IDs are not allowed' in pg_get_functiondef('public.bulk_set_issue_custom_value(uuid[],uuid,jsonb)'::regprocedure)) > 0, 'bulk updates reject duplicate IDs');
select ok(position('for update' in lower(pg_get_functiondef('public.bulk_set_issue_custom_value(uuid[],uuid,jsonb)'::regprocedure))) > 0, 'bulk updates lock project and issues');
select ok(position('CUSTOM_FIELD_UPDATED' in pg_get_functiondef('public.set_issue_custom_value(uuid,uuid,jsonb)'::regprocedure)) > 0, 'single custom updates emit audit events');
select ok(position($$om.role in ('OWNER', 'ADMIN')$$ in pg_get_functiondef('public.validate_custom_field_value(uuid,jsonb)'::regprocedure)) > 0, 'USER values accept workspace owners and admins');

select * from finish();
rollback;

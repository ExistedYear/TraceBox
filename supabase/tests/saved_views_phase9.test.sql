begin;

select plan(12);

select has_column('public', 'saved_views', 'visibility', 'saved views use explicit visibility');
select col_type_is('public', 'saved_views', 'visibility', 'text', 'visibility is persisted as text');
select has_function('public', 'create_saved_view', array['uuid', 'text', 'jsonb', 'text'], 'saved-view create RPC supports visibility');
select has_function('public', 'rename_saved_view', array['uuid', 'text'], 'saved-view rename RPC exists');
select has_function('public', 'update_saved_view_filters', array['uuid', 'jsonb'], 'saved-view filter update RPC exists');
select has_function('public', 'update_saved_view_visibility', array['uuid', 'text'], 'saved-view visibility RPC exists');
select has_function('public', 'delete_saved_view', array['uuid'], 'saved-view delete RPC exists');
select ok(has_function_privilege('authenticated', 'public.create_saved_view(uuid,text,jsonb,text)', 'execute'), 'authenticated users can create views');
select ok(not has_function_privilege('anon', 'public.create_saved_view(uuid,text,jsonb,text)', 'execute'), 'anonymous users cannot create views');
select ok(not has_table_privilege('authenticated', 'public.saved_views', 'insert,update,delete'), 'saved-view writes are RPC-only');
select ok(has_table_privilege('authenticated', 'public.saved_views', 'select'), 'authenticated users retain table SELECT for RLS-filtered views');
select ok(has_function_privilege('authenticated', 'public.update_saved_view_visibility(uuid,text)', 'execute'), 'authenticated owners can change visibility through RPC');

select * from finish();
rollback;

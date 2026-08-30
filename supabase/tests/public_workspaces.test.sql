begin;

select plan(10);

select has_column('public', 'organizations', 'is_public', 'workspace visibility column exists');
select col_not_null('public', 'organizations', 'is_public', 'workspace visibility is never null');
select col_default_is('public', 'organizations', 'is_public', 'false', 'workspaces are private by default');
select has_function('public', 'list_public_organizations', array['integer'], 'public workspace directory RPC exists');
select has_function('public', 'set_organization_public', array['uuid', 'boolean'], 'workspace publication RPC exists');
select has_function('public', 'join_public_organization', array['uuid'], 'public workspace join RPC exists');
select ok(not has_function_privilege('anon', 'public.list_public_organizations(integer)', 'execute'), 'anonymous users cannot enumerate workspaces');
select ok(not has_function_privilege('anon', 'public.join_public_organization(uuid)', 'execute'), 'anonymous users cannot join workspaces');
select ok(has_function_privilege('authenticated', 'public.join_public_organization(uuid)', 'execute'), 'authenticated users can request a public join');
select has_index('public', 'organizations', 'organizations_public_created_idx', 'public directory has a partial index');

select * from finish();
rollback;

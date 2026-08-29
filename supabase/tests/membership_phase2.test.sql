begin;

select plan(14);

select has_table('public', 'workspace_invitations', 'workspace invitations exist');
select has_table('public', 'membership_events', 'membership audit history exists');
select has_function('public', 'create_organization_invitation', array['uuid', 'text', 'text', 'uuid', 'text'], 'invitation creation RPC exists');
select has_function('public', 'accept_organization_invitation', array['text'], 'invitation acceptance RPC exists');
select has_function('public', 'add_project_member', array['uuid', 'uuid', 'text'], 'project contributor RPC exists');
select has_function('public', 'remove_organization_member', array['uuid', 'uuid'], 'workspace removal RPC exists');
select has_function('public', 'transfer_organization_ownership', array['uuid', 'uuid'], 'atomic ownership transfer RPC exists');
select has_trigger('public', 'membership_events', 'membership_events_immutable', 'membership history is immutable');
select has_trigger('public', 'workspace_invitations', 'workspace_invitations_project_organization_guard', 'invitation project references are workspace-bound');
select has_trigger('public', 'membership_events', 'membership_events_project_organization_guard', 'audit project references are workspace-bound');
select ok(not has_table_privilege('authenticated', 'public.workspace_invitations', 'insert,update,delete'), 'browser cannot mutate invitations directly');
select ok(not has_table_privilege('authenticated', 'public.organization_members', 'insert,update,delete'), 'browser cannot mutate workspace membership directly');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'insert,update,delete'), 'browser cannot mutate project membership directly');
select ok(not has_table_privilege('authenticated', 'public.membership_events', 'insert,update,delete'), 'browser cannot mutate membership audit history');

select * from finish();
rollback;

begin;

select plan(13);

select has_function('public', 'get_unread_notifications_count', array[]::text[], 'exact unread-count RPC exists');
select has_function('public', 'list_notifications', array['timestamptz', 'uuid', 'boolean', 'integer'], 'cursor inbox RPC exists');
select has_function('public', 'get_notification_preferences', array[]::text[], 'preference read RPC exists');
select has_function('public', 'update_notification_preferences', array['boolean', 'boolean', 'boolean', 'boolean', 'boolean', 'boolean', 'boolean', 'boolean', 'boolean'], 'all-category preference RPC exists');
select ok(has_function_privilege('authenticated', 'public.list_notifications(timestamptz,uuid,boolean,integer)', 'execute'), 'authenticated users can list their inbox');
select ok(not has_function_privilege('anon', 'public.list_notifications(timestamptz,uuid,boolean,integer)', 'execute'), 'anonymous users cannot list notifications');
select ok(not has_table_privilege('authenticated', 'public.notifications', 'insert,update,delete'), 'notification rows are dispatcher/RPC owned');
select ok(not has_table_privilege('authenticated', 'public.notification_preferences', 'insert,update,delete'), 'preference rows are RPC owned');
select has_trigger('public', 'issues', 'trg_issue_updated_notifications', 'issue changes emit preference-aware notifications');
select has_trigger('public', 'comments', 'trg_comment_mentions_notifications', 'comment mentions emit notifications');
select has_trigger('public', 'comments', 'trg_comment_changed_notifications', 'comment changes emit notifications');
select has_trigger('public', 'milestones', 'trg_milestone_changed_notifications', 'milestones emit notifications');
select has_trigger('public', 'versions', 'trg_version_changed_notifications', 'versions emit notifications');

select * from finish();
rollback;

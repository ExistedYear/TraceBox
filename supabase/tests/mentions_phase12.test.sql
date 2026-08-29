begin;

select plan(15);

select has_table('public', 'comment_mentions', 'stable comment mention relation exists');
select has_column('public', 'comment_mentions', 'display_label', 'mention rows retain display labels');
select has_column('public', 'comment_mentions', 'mention_token', 'mention rows retain canonical server tokens');
select has_index('public', 'comment_mentions', 'comment_mentions_user_idx', 'recipient lookup is indexed');
select has_function('public', 'normalize_mention_token', array['text'], 'mention token normalization exists');
select has_function('public', 'list_project_mention_candidates', array['uuid', 'text', 'integer', 'uuid'], 'member-aware search RPC exists');
select has_function('public', 'add_comment_with_mentions', array['uuid', 'text', 'uuid[]'], 'atomic add comment wrapper exists');
select has_function('public', 'edit_comment_with_mentions', array['uuid', 'text', 'uuid[]'], 'atomic edit comment wrapper exists');
select ok(not has_function_privilege('anon', 'public.list_project_mention_candidates(uuid,text,integer,uuid)', 'execute'), 'anonymous users cannot search identities');
select ok(has_function_privilege('authenticated', 'public.list_project_mention_candidates(uuid,text,integer,uuid)', 'execute'), 'authenticated users can search identities');
select ok(not has_table_privilege('authenticated', 'public.comment_mentions', 'insert,update,delete'), 'mention rows remain RPC-only');
select ok(has_table_privilege('authenticated', 'public.comment_mentions', 'select'), 'visible mention rows can be selected');
select ok(position('notification_recipient_can_view_issue' in pg_get_functiondef('public.add_comment_with_mentions(uuid,text,uuid[])'::regprocedure)) > 0, 'add validates recipient issue visibility');
select ok(position('v_added_ids' in pg_get_functiondef('public.edit_comment_with_mentions(uuid,text,uuid[])'::regprocedure)) > 0, 'edit tracks only newly added recipients');
select hasnt_trigger('public', 'comments', 'trg_comment_mentions_notifications', 'legacy text-derived mention trigger is removed');

select * from finish();
rollback;

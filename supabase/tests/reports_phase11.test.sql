begin;

select plan(6);
select has_function('public', 'get_issue_reports', array['uuid', 'integer'], 'reports RPC exists');
select ok(has_function_privilege('authenticated', 'public.get_issue_reports(uuid,integer)', 'execute'), 'authenticated can invoke reports RPC');
select ok(not has_function_privilege('anon', 'public.get_issue_reports(uuid,integer)', 'execute'), 'anonymous callers cannot invoke reports RPC');
select ok(not has_function_privilege('public', 'public.get_issue_reports(uuid,integer)', 'execute'), 'public callers cannot invoke reports RPC');
select ok((select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_issue_reports') like '%can_view_issue%', 'reports apply issue visibility boundary');
select ok((select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_issue_reports') like '%generate_series(v_start_day, v_end_day%', 'report trend uses finite bounds');
select * from finish();
rollback;

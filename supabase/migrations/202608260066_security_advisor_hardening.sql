-- Resolve actionable hosted security-advisor findings without weakening the
-- intentional RPC authorization model. Trigger functions are never public API
-- endpoints, and API token primitives are server-only implementation details.

alter function public.membership_role_rank(text) set search_path = public;

revoke execute on function public.authenticate_api_token(text) from public, anon, authenticated;
revoke execute on function public.touch_api_token(text) from public, anon, authenticated;
grant execute on function public.authenticate_api_token(text) to service_role;
grant execute on function public.touch_api_token(text) to service_role;

do $$
declare
  v_function record;
begin
  for v_function in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      v_function.nspname,
      v_function.proname,
      v_function.arguments
    );
  end loop;
end;
$$;

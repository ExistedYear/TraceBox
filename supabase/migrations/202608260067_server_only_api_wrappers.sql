-- Public REST routes authenticate bearer tokens in server-only Next.js code
-- and invoke these wrappers with the service-role client. Browser sessions do
-- not need a second direct PostgREST entry point for token-hash mutations.

revoke execute on function public.api_create_issue(text, jsonb) from public, anon, authenticated;
revoke execute on function public.api_update_issue(text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.api_add_comment(text, uuid, text) from public, anon, authenticated;

grant execute on function public.api_create_issue(text, jsonb) to service_role;
grant execute on function public.api_update_issue(text, uuid, jsonb) to service_role;
grant execute on function public.api_add_comment(text, uuid, text) to service_role;

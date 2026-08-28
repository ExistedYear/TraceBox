-- Migration 041: accept both current and legacy PostgREST service-role context.
-- Modern PostgREST exposes JWT claims through request.jwt.claims, while older
-- deployments exposed one GUC per claim. Opaque Supabase secret keys can rely
-- on PostgREST's selected role instead of a JWT claim.

create or replace function public.is_service_role_request()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(nullif(current_setting('request.jwt.claim.role', true), '') = 'service_role', false)
    or coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role', false)
    or coalesce(nullif(current_setting('role', true), '') = 'service_role', false);
$$;

comment on function public.is_service_role_request() is
  'Returns true for service-role PostgREST requests across legacy JWT, JSON claims, and opaque secret-key authentication.';

-- Keep existing function bodies and grants intact while replacing the obsolete
-- single-GUC check in every active service-only GitHub function and in the
-- issue-owned mutation trigger they invoke.
do $migration$
declare
  v_signature text;
  v_function regprocedure;
  v_definition text;
  v_rewritten text;
begin
  foreach v_signature in array array[
    'public.enforce_issue_visibility_access()',
    'public.record_github_webhook(uuid,uuid,text,text,text,text,text,integer)',
    'public.resolve_issue_from_github(uuid,uuid,text)',
    'public.upsert_github_installation(uuid,bigint,bigint,text,text,text,jsonb,text,uuid)',
    'public.upsert_github_repository(uuid,bigint,text,text,text,boolean,boolean,text,text,boolean)',
    'public.set_github_installation_status(bigint,text)',
    'public.set_github_repository_access(bigint,boolean,boolean)',
    'public.record_github_webhook_delivery(text,text,text,bigint,bigint,jsonb)',
    'public.mark_github_webhook_delivery(text,text,text)',
    'public.upsert_github_artifact(uuid,text,text,bigint,text,integer,text,text,text,text,boolean,boolean,text,text,text,timestamptz,timestamptz)',
    'public.link_github_artifact(uuid,uuid,text,text)',
    'public.resolve_issue_from_github(uuid,uuid,uuid,text)'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'Required function is missing: %', v_signature;
    end if;

    v_definition := pg_get_functiondef(v_function);
    v_rewritten := replace(
      replace(
        v_definition,
        'coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role''',
        'not public.is_service_role_request()'
      ),
      'coalesce(current_setting(''request.jwt.claim.role'', true), '''') = ''service_role''',
      'public.is_service_role_request()'
    );

    if v_rewritten = v_definition then
      raise exception 'Legacy service-role check was not found in: %', v_signature;
    end if;

    execute v_rewritten;
  end loop;
end;
$migration$;

-- The predicate reveals no data and must remain callable from invoker-security
-- triggers. Privileged mutations remain protected by the existing RPC grants.
revoke execute on function public.is_service_role_request() from public;
grant execute on function public.is_service_role_request() to anon, authenticated, service_role;

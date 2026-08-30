-- Local/demo-only account. These public credentials are intentionally weak and
-- must never be copied to a production Supabase project.
do $$
declare
  v_user uuid := '10000000-0000-4000-8000-000000000123';
  v_org uuid := '20000000-0000-4000-8000-000000000123';
  v_project uuid;
  v_first uuid;
  v_second uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'demo@123.com', crypt('demo123', gen_salt('bf')), timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"TraceBox Demo"}'::jsonb,
    timezone('utc', now()), timezone('utc', now()), '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    '30000000-0000-4000-8000-000000000123', v_user::text, v_user,
    jsonb_build_object('sub', v_user::text, 'email', 'demo@123.com', 'email_verified', true),
    'email', timezone('utc', now()), timezone('utc', now()), timezone('utc', now())
  ) on conflict (provider_id, provider) do nothing;

  insert into public.organizations (id, name, slug, owner_id, is_public)
  values (v_org, 'TraceBox Demo Workspace', 'tracebox-demo', v_user, true)
  on conflict (id) do update set is_public = true;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, v_user, 'OWNER') on conflict (organization_id, user_id) do nothing;

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  select id into v_project from public.projects where organization_id = v_org and key = 'DEMO';
  if v_project is null then
    select public.create_project(v_org, 'Demo Engineering', 'DEMO', 'A realistic workspace for testing TraceBox.') into v_project;
  end if;

  if not exists (select 1 from public.issues where project_id = v_project) then
    perform public.create_issue(v_project, 'Checkout fails after an expired session', 'REGRESSION',
    'Customers returning to checkout after an idle tab see an error instead of a refreshed session.', null, 'P0', 'CRITICAL', v_user,
    'Production-like Chrome session', '1. Sign in\n2. Open checkout\n3. Wait for the session to expire\n4. Submit payment',
    'The session refreshes and checkout continues.', 'Checkout stops with an authentication error.');
  perform public.create_issue(v_project, 'Keep queue filters when opening issue details', 'BUG',
    'Returning from an issue should preserve the queue filters and page.', null, 'P1', 'MAJOR', v_user,
    'Desktop and mobile', '1. Filter the queue\n2. Open an issue\n3. Return to the queue',
    'The filtered queue is restored.', 'The unfiltered first page opens.');
  perform public.create_issue(v_project, 'Add release health summary', 'ENHANCEMENT',
    'Show a compact summary of blockers and readiness factors for the active release.', null, 'P2', 'MINOR', v_user);

  select id into v_first from public.issues where project_id = v_project and issue_number = 1;
  select id into v_second from public.issues where project_id = v_project and issue_number = 2;
  perform public.add_comment(v_first, 'Demo note: this issue includes enough detail to exercise triage and report-quality scoring.');
    perform public.add_issue_link(v_first, v_second, 'BLOCKS');
  end if;
end $$;

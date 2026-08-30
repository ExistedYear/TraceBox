-- TraceBox production demo cleanup
--
-- This file is intentionally safe by default: it ends with ROLLBACK.
-- Review the printed target rows and every assertion first. To perform the wipe,
-- change only the final ROLLBACK to COMMIT and run the complete file once in the
-- Supabase SQL editor as the project owner. Do not run individual statements.
--
-- Exact target:
--   auth user: 10000000-0000-4000-8000-000000000123 / demo@123.com
--   workspace: 20000000-0000-4000-8000-000000000123 / tracebox-demo

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

select id, email, created_at
from auth.users
where id = '10000000-0000-4000-8000-000000000123'::uuid
  and lower(email) = 'demo@123.com';

select id, slug, owner_id, created_at
from public.organizations
where id = '20000000-0000-4000-8000-000000000123'::uuid
  and slug = 'tracebox-demo'
  and owner_id = '10000000-0000-4000-8000-000000000123'::uuid;

do $$
declare
  v_user constant uuid := '10000000-0000-4000-8000-000000000123';
  v_org constant uuid := '20000000-0000-4000-8000-000000000123';
begin
  if not exists (
    select 1 from auth.users
    where id = v_user and lower(email) = 'demo@123.com'
  ) then
    raise exception 'Refusing cleanup: exact demo Auth user was not found';
  end if;

  if not exists (
    select 1 from public.organizations
    where id = v_org and slug = 'tracebox-demo' and owner_id = v_user
  ) then
    raise exception 'Refusing cleanup: exact demo workspace was not found';
  end if;

  if exists (
    select 1 from public.organizations
    where owner_id = v_user and id <> v_org
  ) then
    raise exception 'Refusing cleanup: demo user owns another workspace';
  end if;

  if exists (
    select 1 from public.organization_members
    where user_id = v_user and organization_id <> v_org
  ) then
    raise exception 'Refusing cleanup: demo user belongs to another workspace';
  end if;

  if exists (
    select 1
    from public.organization_members
    where organization_id = v_org and user_id <> v_user
  ) then
    raise exception 'Refusing cleanup: another user belongs to the demo workspace';
  end if;
end
$$;

-- Immutable history normally protects application audit records. The cleanup
-- transaction disables only those named guards, deletes only rows owned by the
-- exact demo workspace, and restores the guards before the transaction ends.
alter table public.issue_events disable trigger issue_events_immutable;
alter table public.project_events disable trigger project_events_immutable;
alter table public.membership_events disable trigger membership_events_immutable;
alter table public.release_readiness_snapshots disable trigger release_readiness_snapshots_immutable;

delete from public.issue_events
where issue_id in (
  select i.id
  from public.issues i
  join public.projects p on p.id = i.project_id
  where p.organization_id = '20000000-0000-4000-8000-000000000123'::uuid
);

delete from public.project_events
where project_id in (
  select id from public.projects
  where organization_id = '20000000-0000-4000-8000-000000000123'::uuid
);

delete from public.release_readiness_snapshots
where project_id in (
  select id from public.projects
  where organization_id = '20000000-0000-4000-8000-000000000123'::uuid
);

delete from public.membership_events
where organization_id = '20000000-0000-4000-8000-000000000123'::uuid;

delete from public.organization_invitations
where organization_id = '20000000-0000-4000-8000-000000000123'::uuid;

delete from public.organizations
where id = '20000000-0000-4000-8000-000000000123'::uuid
  and slug = 'tracebox-demo'
  and owner_id = '10000000-0000-4000-8000-000000000123'::uuid;

delete from auth.users
where id = '10000000-0000-4000-8000-000000000123'::uuid
  and lower(email) = 'demo@123.com';

alter table public.issue_events enable trigger issue_events_immutable;
alter table public.project_events enable trigger project_events_immutable;
alter table public.membership_events enable trigger membership_events_immutable;
alter table public.release_readiness_snapshots enable trigger release_readiness_snapshots_immutable;

do $$
begin
  if exists (
    select 1 from auth.users
    where id = '10000000-0000-4000-8000-000000000123'::uuid
  ) or exists (
    select 1 from public.organizations
    where id = '20000000-0000-4000-8000-000000000123'::uuid
  ) then
    raise exception 'Cleanup did not remove both exact targets';
  end if;
end
$$;

-- SAFE DEFAULT. Replace this one word with COMMIT only after reviewing the
-- target rows and assertions above.
rollback;

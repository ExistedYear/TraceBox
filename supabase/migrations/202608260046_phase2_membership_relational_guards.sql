-- Phase 2 completion: enforce the organization/project relationship at the
-- table boundary as defense in depth for invitation and membership history.

create or replace function public.enforce_membership_project_organization()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.organization_id = new.organization_id
  ) then
    raise exception 'INVALID_PROJECT_ORGANIZATION' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists membership_events_project_organization_guard on public.membership_events;
create trigger membership_events_project_organization_guard
before insert or update of organization_id, project_id on public.membership_events
for each row execute procedure public.enforce_membership_project_organization();

drop trigger if exists workspace_invitations_project_organization_guard on public.workspace_invitations;
create trigger workspace_invitations_project_organization_guard
before insert or update of organization_id, project_id on public.workspace_invitations
for each row execute procedure public.enforce_membership_project_organization();

revoke execute on function public.enforce_membership_project_organization() from public, anon, authenticated;

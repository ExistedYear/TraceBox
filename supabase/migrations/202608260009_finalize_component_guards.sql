-- Final audit fixes: organization creation is RPC-only, and component writes
-- serialize on their project's row so archive state cannot race issue writes.

drop policy if exists "Authenticated users can create organizations they own" on public.organizations;

create or replace function public.validate_component_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = new.project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  if new.default_assignee_id is not null and not (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = new.project_id and pm.user_id = new.default_assignee_id
    )
    or exists (
      select 1
      from public.projects p
      join public.organizations o on o.id = p.organization_id
      left join public.organization_members om
        on om.organization_id = o.id and om.user_id = new.default_assignee_id
      where p.id = new.project_id
        and (o.owner_id = new.default_assignee_id or om.role in ('OWNER', 'ADMIN'))
    )
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '23503';
  end if;

  return new;
end;
$$;

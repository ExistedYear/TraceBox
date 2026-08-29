-- Phase 9: saved-view lifecycle, explicit sharing visibility, and stable links.
-- PRIVATE is owner-only, PROJECT is visible to project members, and
-- ORGANIZATION is visible to members of the owning workspace who can access
-- the project. Saved-view writes are RPC-only.

drop function if exists public.create_saved_view(uuid, text, jsonb, boolean);
drop function if exists public.update_saved_view_sharing(uuid, boolean);

-- Remove every legacy policy that references is_shared before retiring the
-- column. PostgreSQL correctly blocks a column drop while policy expressions
-- still depend on it.
drop policy if exists "Project members can read saved views" on public.saved_views;
drop policy if exists "Project members can create saved views" on public.saved_views;
drop policy if exists "Owners can update/delete their saved views" on public.saved_views;
drop policy if exists "Owners can update their saved views" on public.saved_views;
drop policy if exists "Owners can delete their saved views" on public.saved_views;

alter table public.saved_views add column if not exists visibility text;
update public.saved_views
   set visibility = case when is_shared then 'PROJECT' else 'PRIVATE' end
 where visibility is null;
alter table public.saved_views alter column visibility set default 'PRIVATE';
alter table public.saved_views alter column visibility set not null;
alter table public.saved_views drop constraint if exists saved_views_visibility_check;
alter table public.saved_views add constraint saved_views_visibility_check
  check (visibility in ('PRIVATE', 'PROJECT', 'ORGANIZATION'));
alter table public.saved_views drop column if exists is_shared;

create index if not exists saved_views_visibility_project_idx
  on public.saved_views (project_id, visibility, created_at desc);

create policy "Authorized members can read saved views"
  on public.saved_views for select to authenticated
  using (
    public.is_project_member(project_id)
    and (
      (visibility = 'PRIVATE' and created_by = (select auth.uid()))
      or visibility = 'PROJECT'
      or (
        visibility = 'ORGANIZATION'
        and exists (
          select 1 from public.projects p
          join public.organization_members om on om.organization_id = p.organization_id
         where p.id = saved_views.project_id
           and om.user_id = (select auth.uid())
        )
      )
    )
  );

create or replace function public.create_saved_view(
  p_project_id uuid,
  p_name text,
  p_filters jsonb default '{}'::jsonb,
  p_visibility text default 'PRIVATE'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_view_id uuid;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_visibility text := upper(trim(coalesce(p_visibility, 'PRIVATE')));
  v_archived boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_name is null or char_length(v_name) > 80 then raise exception 'VALIDATION: Saved view name must be 1–80 characters' using errcode = '22023'; end if;
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then raise exception 'VALIDATION: Saved view filters must be an object' using errcode = '22023'; end if;
  if v_visibility not in ('PRIVATE', 'PROJECT', 'ORGANIZATION') then raise exception 'VALIDATION: Invalid saved view visibility' using errcode = '22023'; end if;
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_visibility = 'ORGANIZATION' and not public.can_manage_project(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.saved_views (project_id, created_by, name, filters, visibility)
  values (p_project_id, v_user, v_name, p_filters, v_visibility)
  returning id into v_view_id;
  return v_view_id;
end;
$$;

create or replace function public.rename_saved_view(p_view_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_name is null or char_length(v_name) > 80 then raise exception 'VALIDATION: Saved view name must be 1–80 characters' using errcode = '22023'; end if;
  update public.saved_views sv set name = v_name, updated_at = now()
   where sv.id = p_view_id and sv.created_by = v_user
     and public.is_project_member(sv.project_id)
     and exists (select 1 from public.projects p where p.id = sv.project_id and not p.is_archived);
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.update_saved_view_filters(p_view_id uuid, p_filters jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then raise exception 'VALIDATION: Saved view filters must be an object' using errcode = '22023'; end if;
  update public.saved_views sv set filters = p_filters, updated_at = now()
   where sv.id = p_view_id and sv.created_by = v_user
     and public.is_project_member(sv.project_id)
     and exists (select 1 from public.projects p where p.id = sv.project_id and not p.is_archived);
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.update_saved_view_visibility(p_view_id uuid, p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_visibility text := upper(trim(coalesce(p_visibility, 'PRIVATE')));
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_visibility not in ('PRIVATE', 'PROJECT', 'ORGANIZATION') then raise exception 'VALIDATION: Invalid saved view visibility' using errcode = '22023'; end if;
  select sv.project_id, p.is_archived into v_project_id, v_archived
    from public.saved_views sv join public.projects p on p.id = sv.project_id
   where sv.id = p_view_id and sv.created_by = v_user;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.is_project_member(v_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_visibility = 'ORGANIZATION' and not public.can_manage_project(v_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.saved_views set visibility = v_visibility, updated_at = now() where id = p_view_id;
end;
$$;

create or replace function public.delete_saved_view(p_view_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  delete from public.saved_views sv
   where sv.id = p_view_id and sv.created_by = v_user
     and public.is_project_member(sv.project_id)
     and exists (select 1 from public.projects p where p.id = sv.project_id and not p.is_archived);
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

revoke execute on function public.create_saved_view(uuid, text, jsonb, text), public.rename_saved_view(uuid, text), public.update_saved_view_filters(uuid, jsonb), public.update_saved_view_visibility(uuid, text), public.delete_saved_view(uuid) from public, anon;
grant execute on function public.create_saved_view(uuid, text, jsonb, text), public.rename_saved_view(uuid, text), public.update_saved_view_filters(uuid, jsonb), public.update_saved_view_visibility(uuid, text), public.delete_saved_view(uuid) to authenticated;

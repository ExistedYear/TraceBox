-- Close tenant-directory and GitHub catalog disclosure paths left by the
-- original broad SELECT policies. Catalog managers may inspect repositories
-- before binding them; ordinary project members see only repositories already
-- bound to a project they belong to.

create or replace function public.can_view_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and (
      p_user_id = auth.uid()
      or exists (
        select 1
        from public.organization_members mine
        join public.organization_members theirs
          on theirs.organization_id = mine.organization_id
        where mine.user_id = auth.uid()
          and theirs.user_id = p_user_id
      )
    );
$$;

revoke all on function public.can_view_profile(uuid) from public, anon;
grant execute on function public.can_view_profile(uuid) to authenticated;

drop policy if exists "Authenticated users can read profiles" on public.profiles;
drop policy if exists "Users can read shared workspace profiles" on public.profiles;
create policy "Users can read shared workspace profiles"
  on public.profiles
  for select
  to authenticated
  using (public.can_view_profile(id));

create or replace function public.can_view_github_catalog(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and (
      public.is_org_admin(p_organization_id)
      or exists (
        select 1
        from public.projects p
        where p.organization_id = p_organization_id
          and public.project_role(p.id) = 'MAINTAINER'
      )
    );
$$;

create or replace function public.can_view_github_installation(p_installation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.github_installations gi
    where gi.id = p_installation_id
      and (
        public.can_view_github_catalog(gi.organization_id)
        or exists (
          select 1
          from public.github_repositories gr
          join public.project_github_repositories pgr
            on pgr.github_repository_id = gr.id
          where gr.installation_id = gi.id
            and public.is_project_member(pgr.project_id)
        )
      )
  );
$$;

create or replace function public.can_view_github_repository(p_repository_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.github_repositories gr
    join public.github_installations gi on gi.id = gr.installation_id
    where gr.id = p_repository_id
      and (
        public.can_view_github_catalog(gi.organization_id)
        or exists (
          select 1
          from public.project_github_repositories pgr
          where pgr.github_repository_id = gr.id
            and public.is_project_member(pgr.project_id)
        )
      )
  );
$$;

revoke all on function public.can_view_github_catalog(uuid) from public, anon;
revoke all on function public.can_view_github_installation(uuid) from public, anon;
revoke all on function public.can_view_github_repository(uuid) from public, anon;
grant execute on function public.can_view_github_catalog(uuid) to authenticated;
grant execute on function public.can_view_github_installation(uuid) to authenticated;
grant execute on function public.can_view_github_repository(uuid) to authenticated;

drop policy if exists "Organization members can read GitHub installations" on public.github_installations;
drop policy if exists "Authorized users can read GitHub installations" on public.github_installations;
create policy "Authorized users can read GitHub installations"
  on public.github_installations
  for select
  to authenticated
  using (public.can_view_github_installation(id));

drop policy if exists "Organization members can read GitHub repositories" on public.github_repositories;
drop policy if exists "Authorized users can read GitHub repositories" on public.github_repositories;
create policy "Authorized users can read GitHub repositories"
  on public.github_repositories
  for select
  to authenticated
  using (public.can_view_github_repository(id));

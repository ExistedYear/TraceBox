-- Migration 034: final security, storage, integrity, and index hardening

-- Candidate search must not disclose restricted issue titles or IDs.
create or replace function public.find_duplicate_candidates(p_project_id uuid, p_title text, p_limit integer default 5)
returns table (issue_id uuid, issue_number bigint, title text, similarity double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if v_title is null or char_length(v_title) < 3 then raise exception 'VALIDATION: Title must be at least 3 characters' using errcode = '22023'; end if;
  return query
    select i.id, i.issue_number, i.title, similarity(i.title, v_title)
    from public.issues i
    where i.project_id = p_project_id
      and public.can_view_issue(i.id)
      and i.title % v_title
      and similarity(i.title, v_title) > 0.2
    order by similarity(i.title, v_title) desc
    limit v_limit;
end;
$$;

-- Restricted access grants are only meaningful for restricted issues and same-project members.
create or replace function public.grant_issue_access(p_issue_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_issue record; v_archived boolean; v_role text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select id, project_id, reporter_id, visibility into v_issue from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_issue.project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if v_issue.visibility <> 'RESTRICTED' then raise exception 'VALIDATION: Access grants require restricted visibility' using errcode = '22023'; end if;
  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') and v_issue.reporter_id <> v_user then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if not exists (select 1 from public.project_members pm where pm.project_id = v_issue.project_id and pm.user_id = p_user_id) then raise exception 'VALIDATION: Grantee must be a project member' using errcode = '22023'; end if;
  insert into public.issue_access(issue_id, user_id, granted_by) values (p_issue_id, p_user_id, v_user) on conflict do nothing;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, new_value) values (p_issue_id, v_user, 'ACCESS_GRANTED', 'issue_access', to_jsonb(p_user_id::text));
end; $$;

create or replace function public.revoke_issue_access(p_issue_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_issue record; v_archived boolean; v_role text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id, reporter_id into v_issue from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_issue.project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') and v_issue.reporter_id <> v_user then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.issue_access where issue_id = p_issue_id and user_id = p_user_id;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value) values (p_issue_id, v_user, 'ACCESS_REVOKED', 'issue_access', to_jsonb(p_user_id::text));
end; $$;

create or replace function public.set_issue_visibility(p_issue_id uuid, p_visibility text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_issue record; v_archived boolean; v_role text; v_visibility text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_visibility := upper(trim(coalesce(p_visibility, 'PROJECT')));
  if v_visibility not in ('PUBLIC', 'PROJECT', 'RESTRICTED') then raise exception 'VALIDATION: Invalid visibility' using errcode = '22023'; end if;
  select id, project_id, visibility, reporter_id into v_issue from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_issue.project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') and v_issue.reporter_id <> v_user then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.issues set visibility = v_visibility, updated_at = timezone('utc'::text, now()) where id = p_issue_id;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value) values (p_issue_id, v_user, 'VISIBILITY_CHANGED', 'visibility', to_jsonb(v_issue.visibility), to_jsonb(v_visibility));
end; $$;

revoke execute on function public.grant_issue_access(uuid, uuid), public.revoke_issue_access(uuid, uuid), public.set_issue_visibility(uuid, text) from anon, public;
grant execute on function public.grant_issue_access(uuid, uuid), public.revoke_issue_access(uuid, uuid), public.set_issue_visibility(uuid, text) to authenticated;

-- Storage policies must enforce issue visibility, membership, and active projects.
drop policy if exists "Members can upload issue attachments" on storage.objects;
create policy "Members can upload issue attachments" on storage.objects for insert to authenticated
with check (
  bucket_id = 'issue-attachments'
  and (storage.foldername(name))[1] is not null
  and public.can_view_issue(((storage.foldername(name))[1])::uuid)
  and public.can_comment_on_issue(((storage.foldername(name))[1])::uuid)
);
drop policy if exists "Owners and maintainers can delete attachments" on storage.objects;
create policy "Owners and maintainers can delete attachments" on storage.objects for delete to authenticated
using (
  bucket_id = 'issue-attachments'
  and public.can_view_issue(((storage.foldername(name))[1])::uuid)
  and exists (select 1 from public.issues i join public.projects p on p.id = i.project_id where i.id = ((storage.foldername(name))[1])::uuid and not p.is_archived)
  and (owner_id = (select auth.uid()::text) or public.can_manage_project((select i.project_id from public.issues i where i.id = ((storage.foldername(name))[1])::uuid)))
);

-- Supporting indexes for foreign-key deletes and webhook lookups.
create index if not exists idx_components_default_assignee_id on public.components(default_assignee_id);
create index if not exists idx_workflow_transitions_from_state_id on public.workflow_transitions(from_state_id);
create index if not exists idx_workflow_transitions_to_state_id on public.workflow_transitions(to_state_id);
create index if not exists idx_issue_templates_default_component_id on public.issue_templates(default_component_id);
create index if not exists idx_issue_access_granted_by on public.issue_access(granted_by);
create index if not exists idx_issue_github_links_created_by on public.issue_github_links(created_by);
create index if not exists idx_project_integrations_lookup on public.project_integrations(provider, repo_full_name, is_enabled);
create index if not exists idx_issue_custom_values_field_id on public.issue_custom_values(custom_field_id);

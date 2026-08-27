-- Migration 035: API wrapper correctness, integration management, and metadata integrity

-- Correct API create argument order and bind token to its organization.
create or replace function public.api_create_issue(p_token_hash text, p_payload jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_token record; v_org uuid; v_project_org uuid; v_issue_number integer;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not ('write' = any(v_token.scopes)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_org := nullif(p_payload->>'project_id', '')::uuid;
  select organization_id into v_project_org from public.projects where id = v_org and not is_archived;
  if v_project_org is null or v_project_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  v_issue_number := public.create_issue(
    v_org,
    p_payload->>'title',
    coalesce(p_payload->>'type', 'BUG'),
    p_payload->>'description',
    coalesce(p_payload->>'priority', 'P2'),
    coalesce(p_payload->>'severity', 'MAJOR'),
    nullif(p_payload->>'component_id', '')::uuid,
    nullif(p_payload->>'assignee_id', '')::uuid,
    p_payload->>'environment',
    p_payload->>'steps_to_reproduce',
    p_payload->>'expected_behavior',
    p_payload->>'actual_behavior'
  );
  perform public.touch_api_token(p_token_hash);
  return v_issue_number;
end; $$;

create or replace function public.api_update_issue(p_token_hash text, p_issue_id uuid, p_updates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_token record; v_project_org uuid;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not ('write' = any(v_token.scopes)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select p.organization_id into v_project_org from public.issues i join public.projects p on p.id = i.project_id where i.id = p_issue_id and not p.is_archived;
  if v_project_org is null or v_project_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  perform public.update_issue_fields(p_issue_id, p_updates);
  perform public.touch_api_token(p_token_hash);
end; $$;

revoke execute on function public.api_create_issue(text, jsonb), public.api_update_issue(text, uuid, jsonb) from anon, public;
grant execute on function public.api_create_issue(text, jsonb), public.api_update_issue(text, uuid, jsonb) to authenticated, service_role;

-- Prevent cross-project default components in templates.
create or replace function public.validate_issue_template_component()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.default_component_id is not null and not exists (
    select 1 from public.components c where c.id = new.default_component_id and c.project_id = new.project_id
  ) then
    raise exception 'VALIDATION: Template component must belong to the template project' using errcode = '22023';
  end if;
  return new;
end; $$;
drop trigger if exists issue_template_component_project on public.issue_templates;
create trigger issue_template_component_project before insert or update on public.issue_templates for each row execute procedure public.validate_issue_template_component();

-- Make GitHub webhook retries idempotent for the same issue/link URL.
create unique index if not exists issue_github_links_natural_idx
  on public.issue_github_links(issue_id, repo_name, link_type, (coalesce(number, -1)), url);

-- Authenticated project managers can configure GitHub repository integrations.
create or replace function public.upsert_github_integration(p_project_id uuid, p_repo_full_name text, p_auto_resolve_enabled boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_archived boolean; v_role text; v_id uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.project_integrations(provider, project_id, repo_full_name, auto_resolve_enabled, is_enabled)
  values ('GITHUB', p_project_id, trim(p_repo_full_name), coalesce(p_auto_resolve_enabled, true), true)
  on conflict (project_id, provider) do update set repo_full_name = excluded.repo_full_name, auto_resolve_enabled = excluded.auto_resolve_enabled, is_enabled = true, updated_at = timezone('utc'::text, now())
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.remove_github_integration(p_project_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_archived boolean;
begin
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.project_integrations where project_id = p_project_id and provider = 'GITHUB';
end; $$;
revoke execute on function public.upsert_github_integration(uuid, text, boolean), public.remove_github_integration(uuid) from anon, public;
grant execute on function public.upsert_github_integration(uuid, text, boolean), public.remove_github_integration(uuid) to authenticated;

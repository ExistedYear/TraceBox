-- Migration 039: production-validation fixes for API, GitHub, links, and custom fields

-- Correct the positional call into create_issue. The previous wrapper passed
-- priority and severity into component_id and priority respectively.
create or replace function public.api_create_issue(p_token_hash text, p_payload jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_token record; v_project_id uuid; v_project_org uuid; v_issue_number integer;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not (('write' = any(v_token.scopes)) or ('issues:write' = any(v_token.scopes))) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  v_project_id := nullif(p_payload->>'project_id', '')::uuid;
  select organization_id into v_project_org from public.projects where id = v_project_id and not is_archived;
  if v_project_org is null or v_project_org <> v_token.organization_id then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  v_issue_number := public.create_issue(
    v_project_id,
    p_payload->>'title',
    coalesce(p_payload->>'type', 'BUG'),
    p_payload->>'description',
    nullif(p_payload->>'component_id', '')::uuid,
    coalesce(p_payload->>'priority', 'P2'),
    coalesce(p_payload->>'severity', 'MAJOR'),
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
  if not found or not (('write' = any(v_token.scopes)) or ('issues:write' = any(v_token.scopes))) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select p.organization_id into v_project_org from public.issues i join public.projects p on p.id = i.project_id where i.id = p_issue_id and not p.is_archived;
  if v_project_org is null or v_project_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  perform public.update_issue_fields(p_issue_id, p_updates);
  perform public.touch_api_token(p_token_hash);
end; $$;

-- API comment wrapper keeps token impersonation and comment audit behavior in SQL.
create or replace function public.api_add_comment(p_token_hash text, p_issue_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_token record; v_project_org uuid; v_comment_id uuid;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not (('write' = any(v_token.scopes)) or ('comments:write' = any(v_token.scopes))) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select p.organization_id into v_project_org from public.issues i join public.projects p on p.id = i.project_id where i.id = p_issue_id and not p.is_archived;
  if v_project_org is null or v_project_org <> v_token.organization_id then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  v_comment_id := public.add_comment(p_issue_id, p_body);
  perform public.touch_api_token(p_token_hash);
  return v_comment_id;
end; $$;

revoke execute on function public.api_add_comment(text, uuid, text) from anon, public;
grant execute on function public.api_add_comment(text, uuid, text) to authenticated, service_role;

-- Support both legacy broad scopes and the documented resource scopes.
alter table public.api_tokens drop constraint if exists api_tokens_scopes_check;
alter table public.api_tokens add constraint api_tokens_scopes_check check (
  cardinality(scopes) between 1 and 8
  and scopes <@ array['read', 'write', 'projects:read', 'issues:read', 'issues:write', 'comments:write', 'milestones:read', 'search:read']::text[]
);

-- Store canonical repository names for reliable webhook matching.
create or replace function public.upsert_github_integration(p_project_id uuid, p_repo_full_name text, p_auto_resolve_enabled boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_archived boolean; v_role text; v_id uuid; v_repo text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_repo := lower(trim(coalesce(p_repo_full_name, '')));
  if v_repo !~ '^[^/[:space:]]+/[^/[:space:]]+$' then raise exception 'VALIDATION: Use owner/repository format' using errcode = '22023'; end if;
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.project_integrations(provider, project_id, repo_full_name, auto_resolve_enabled, is_enabled)
  values ('GITHUB', p_project_id, v_repo, coalesce(p_auto_resolve_enabled, true), true)
  on conflict (project_id, provider) do update set repo_full_name = excluded.repo_full_name, auto_resolve_enabled = excluded.auto_resolve_enabled, is_enabled = true, updated_at = timezone('utc'::text, now())
  returning id into v_id;
  return v_id;
end; $$;

-- Upsert webhook metadata so OPEN links become MERGED/CLOSED instead of staying stale.
create or replace function public.record_github_webhook(
  p_project_id uuid,
  p_issue_id uuid,
  p_repo_name text,
  p_link_type text,
  p_url text,
  p_title text default null,
  p_status text default 'OPEN',
  p_number integer default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_link_id uuid; v_old_status text; v_repo text := lower(trim(p_repo_name));
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_link_type not in ('PULL_REQUEST', 'COMMIT', 'BRANCH') or upper(coalesce(p_status, 'OPEN')) not in ('OPEN', 'MERGED', 'CLOSED', 'DRAFT') then raise exception 'VALIDATION' using errcode = '22023'; end if;
  if not exists (select 1 from public.projects where id = p_project_id and not is_archived) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.issues where id = p_issue_id and project_id = p_project_id) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select status into v_old_status from public.issue_github_links
  where issue_id = p_issue_id and lower(repo_name) = v_repo and link_type = p_link_type and coalesce(number, -1) = coalesce(p_number, -1) and url = trim(p_url)
  limit 1;
  insert into public.issue_github_links(issue_id, repo_name, link_type, number, url, title, status, created_by)
  values (p_issue_id, v_repo, p_link_type, p_number, trim(p_url), nullif(trim(p_title), ''), upper(coalesce(p_status, 'OPEN')), null)
  on conflict (issue_id, repo_name, link_type, (coalesce(number, -1)), url)
  do update set title = excluded.title, status = excluded.status
  returning id into v_link_id;
  if v_old_status is null then
    insert into public.issue_events(issue_id, actor_id, event_type, field_name, new_value, metadata)
    values (p_issue_id, null, 'GITHUB_LINKED', 'github_link', to_jsonb(trim(p_url)), jsonb_build_object('repo', v_repo, 'type', p_link_type, 'number', p_number, 'status', upper(coalesce(p_status, 'OPEN')), 'source', 'github_webhook'));
  elsif v_old_status is distinct from upper(coalesce(p_status, 'OPEN')) then
    insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
    values (p_issue_id, null, 'GITHUB_UPDATED', 'github_status', to_jsonb(v_old_status), to_jsonb(upper(coalesce(p_status, 'OPEN'))), jsonb_build_object('repo', v_repo, 'number', p_number, 'url', trim(p_url), 'source', 'github_webhook'));
  end if;
  return v_link_id;
end; $$;

-- Service-role-only resolution used when a merged PR contains a closing keyword.
create or replace function public.resolve_issue_from_github(p_project_id uuid, p_issue_id uuid, p_repo_name text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_issue record; v_state_id uuid; v_now timestamptz := timezone('utc'::text, now());
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.project_integrations pi
    where pi.project_id = p_project_id and pi.provider = 'GITHUB' and pi.is_enabled and pi.auto_resolve_enabled and lower(pi.repo_full_name) = lower(trim(p_repo_name))
  ) then return false; end if;
  select * into v_issue from public.issues where id = p_issue_id and project_id = p_project_id for update;
  if not found or v_issue.resolution is not null then return false; end if;
  select id into v_state_id from public.workflow_states where project_id = p_project_id and category = 'RESOLVED' order by position limit 1;
  if v_state_id is null or v_state_id = v_issue.status_id then return false; end if;
  update public.issues set status_id = v_state_id, resolution = 'FIXED', resolved_at = v_now, closed_at = null, updated_at = v_now where id = p_issue_id;
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (p_issue_id, null, 'STATUS_CHANGED', 'status_id', to_jsonb(v_issue.status_id::text), to_jsonb(v_state_id::text), jsonb_build_object('old_state_id', v_issue.status_id, 'new_state_id', v_state_id, 'new_category', 'RESOLVED', 'resolution', 'FIXED', 'source', 'github_webhook'));
  insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (p_issue_id, null, 'RESOLUTION_CHANGED', 'resolution', to_jsonb(v_issue.resolution), to_jsonb('FIXED'::text), jsonb_build_object('source', 'github_webhook'));
  return true;
end; $$;

revoke execute on function public.resolve_issue_from_github(uuid, uuid, text) from anon, authenticated, public;
grant execute on function public.resolve_issue_from_github(uuid, uuid, text) to service_role;

-- Issue links are general issue edits and require Developer/Maintainer access.
create or replace function public.add_issue_link(p_source_issue_id uuid, p_target_issue_id uuid, p_relationship text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_project_id uuid; v_archived boolean; v_link_id uuid; v_role text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_source_issue_id = p_target_issue_id then raise exception 'VALIDATION: Cannot link issue to itself' using errcode = '22023'; end if;
  if p_relationship not in ('BLOCKS', 'DEPENDS_ON', 'DUPLICATE_OF', 'RELATES_TO', 'CAUSED_BY', 'REGRESSION_OF') then raise exception 'VALIDATION: Invalid relationship' using errcode = '22023'; end if;
  select i.project_id into v_project_id from public.issues i where i.id = p_source_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') or not public.can_view_issue(p_source_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if not exists (select 1 from public.issues i where i.id = p_target_issue_id and i.project_id = v_project_id and public.can_view_issue(i.id)) then raise exception 'VALIDATION: Target issue must be visible in the same project' using errcode = '22023'; end if;
  insert into public.issue_links(source_issue_id, target_issue_id, relationship, created_by) values (p_source_issue_id, p_target_issue_id, p_relationship, v_user) returning id into v_link_id;
  insert into public.issue_events(issue_id, actor_id, event_type, metadata) values (p_source_issue_id, v_user, 'ISSUE_LINKED', jsonb_build_object('target_id', p_target_issue_id, 'relationship', p_relationship));
  if p_relationship = 'DUPLICATE_OF' then
    perform public.transition_issue(p_source_issue_id, (select ws.id from public.workflow_states ws where ws.project_id = v_project_id and ws.category = 'RESOLVED' order by position limit 1), 'DUPLICATE');
  end if;
  return v_link_id;
end; $$;

-- Validate custom-field configuration and values at the database boundary.
create or replace function public.create_custom_field(p_project_id uuid, p_name text, p_field_type text, p_config jsonb default '{}'::jsonb, p_is_required boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_archived boolean; v_role text; v_name text; v_field_id uuid; v_config jsonb := coalesce(p_config, '{}'::jsonb);
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_name := nullif(trim(p_name), '');
  if v_name is null or char_length(v_name) > 80 then raise exception 'VALIDATION: Custom field name must be 1-80 characters' using errcode = '22023'; end if;
  if p_field_type not in ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'USER') then raise exception 'VALIDATION: Invalid custom field type' using errcode = '22023'; end if;
  if p_field_type in ('SINGLE_SELECT', 'MULTI_SELECT') and (jsonb_typeof(v_config->'options') <> 'array' or jsonb_array_length(v_config->'options') = 0) then raise exception 'VALIDATION: Select fields require options' using errcode = '22023'; end if;
  select is_archived into v_archived from public.projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role <> 'MAINTAINER' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.custom_fields(project_id, name, field_type, config, is_required) values (p_project_id, v_name, p_field_type, v_config, coalesce(p_is_required, false)) returning id into v_field_id;
  return v_field_id;
end; $$;

create or replace function public.set_issue_custom_value(p_issue_id uuid, p_custom_field_id uuid, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_issue record; v_archived boolean; v_role text; v_field record; v_item jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select project_id into v_issue from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_issue.project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(v_issue.project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') or not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select * into v_field from public.custom_fields where id = p_custom_field_id and project_id = v_issue.project_id;
  if not found then raise exception 'VALIDATION: Custom field does not belong to this project' using errcode = '23503'; end if;
  if p_value is null or jsonb_typeof(p_value) = 'null' or p_value = '""'::jsonb then
    if v_field.is_required then raise exception 'VALIDATION: Required custom field cannot be empty' using errcode = '22023'; end if;
    delete from public.issue_custom_values where issue_id = p_issue_id and custom_field_id = p_custom_field_id;
    return;
  end if;
  if (v_field.field_type in ('TEXT', 'DATE', 'SINGLE_SELECT', 'USER') and jsonb_typeof(p_value) <> 'string')
    or (v_field.field_type = 'NUMBER' and jsonb_typeof(p_value) <> 'number')
    or (v_field.field_type = 'BOOLEAN' and jsonb_typeof(p_value) <> 'boolean')
    or (v_field.field_type = 'MULTI_SELECT' and jsonb_typeof(p_value) <> 'array') then raise exception 'VALIDATION: Custom field value has the wrong type' using errcode = '22023'; end if;
  if v_field.field_type = 'DATE' then perform trim(both '"' from p_value::text)::date; end if;
  if v_field.field_type = 'USER' and not exists (select 1 from public.project_members pm where pm.project_id = v_issue.project_id and pm.user_id = trim(both '"' from p_value::text)::uuid) then raise exception 'VALIDATION: User must be a project member' using errcode = '22023'; end if;
  if v_field.field_type = 'SINGLE_SELECT' and not (v_field.config->'options' @> jsonb_build_array(trim(both '"' from p_value::text))) then raise exception 'VALIDATION: Invalid select option' using errcode = '22023'; end if;
  if v_field.field_type = 'MULTI_SELECT' then
    for v_item in select value from jsonb_array_elements(p_value) loop
      if jsonb_typeof(v_item) <> 'string' or not (v_field.config->'options' @> jsonb_build_array(trim(both '"' from v_item::text))) then raise exception 'VALIDATION: Invalid multi-select option' using errcode = '22023'; end if;
    end loop;
  end if;
  insert into public.issue_custom_values(issue_id, custom_field_id, value) values (p_issue_id, p_custom_field_id, p_value)
  on conflict (issue_id, custom_field_id) do update set value = excluded.value;
end; $$;

-- Owners can toggle whether a saved view is visible to the project.
create or replace function public.update_saved_view_sharing(p_view_id uuid, p_is_shared boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_count integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  update public.saved_views set is_shared = coalesce(p_is_shared, false) where id = p_view_id and created_by = v_user;
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end; $$;
revoke execute on function public.update_saved_view_sharing(uuid, boolean) from anon, public;
grant execute on function public.update_saved_view_sharing(uuid, boolean) to authenticated;

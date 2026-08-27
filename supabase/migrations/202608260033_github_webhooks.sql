-- Migration 033: GitHub webhook ingestion and safe server-side link recording

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
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link_id uuid;
begin
  -- This function is intentionally callable only by the server-side service role.
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id and not is_archived) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.issues where id = p_issue_id and project_id = p_project_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- The webhook has no authenticated TraceBox actor; audit actor_id remains null.
  insert into public.issue_github_links (issue_id, repo_name, link_type, number, url, title, status, created_by)
  values (p_issue_id, trim(p_repo_name), p_link_type, p_number, trim(p_url), nullif(trim(p_title), ''), coalesce(p_status, 'OPEN'), null)
  on conflict do nothing
  returning id into v_link_id;

  if v_link_id is not null then
    insert into public.issue_events (issue_id, actor_id, event_type, field_name, new_value, metadata)
    values (p_issue_id, null, 'GITHUB_LINKED', 'github_link', to_jsonb(trim(p_url)), jsonb_build_object('repo', trim(p_repo_name), 'type', p_link_type, 'number', p_number, 'source', 'github_webhook'));
  end if;
  return v_link_id;
end;
$$;

revoke execute on function public.record_github_webhook(uuid, uuid, text, text, text, text, text, integer) from anon, authenticated, public;
grant execute on function public.record_github_webhook(uuid, uuid, text, text, text, text, text, integer) to service_role;

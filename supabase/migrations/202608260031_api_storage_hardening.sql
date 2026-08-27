-- Migration 031: API token authentication and private attachment storage hardening

-- Private bucket. Storage object policies below enforce issue-level access.
insert into storage.buckets (id, name, public, file_size_limit)
values ('issue-attachments', 'issue-attachments', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- Attachment storage paths must be issue-id prefixed.
create policy "Members can upload issue attachments"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'issue-attachments'
    and (storage.foldername(name))[1] is not null
    and public.can_comment_on_issue((storage.foldername(name))[1]::uuid)
  );

create policy "Issue viewers can download attachments"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'issue-attachments'
    and (storage.foldername(name))[1] is not null
    and public.can_view_issue((storage.foldername(name))[1]::uuid)
  );

create policy "Owners and maintainers can delete attachments"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'issue-attachments'
    and (
      owner_id = (select auth.uid()::text)
      or public.can_manage_project((select i.project_id from public.issues i where i.id = (storage.foldername(name))[1]::uuid))
    )
  );

-- Enforce storage path ownership at the metadata boundary.
create or replace function public.add_attachment(
  p_issue_id uuid,
  p_filename text,
  p_storage_path text,
  p_mime_type text default null,
  p_size_bytes bigint default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_role text;
  v_filename text;
  v_storage_path text;
  v_attachment_id uuid;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  v_filename := nullif(trim(p_filename), '');
  v_storage_path := nullif(trim(p_storage_path), '');
  if v_filename is null or char_length(v_filename) > 255 then
    raise exception 'VALIDATION: Filename is required and must be <= 255 characters' using errcode = '22023';
  end if;
  if v_storage_path is null or v_storage_path !~ ('^' || p_issue_id::text || '/[^/]+$') then
    raise exception 'VALIDATION: Storage path must be scoped to the issue' using errcode = '22023';
  end if;
  if p_size_bytes < 0 or p_size_bytes > 52428800 then
    raise exception 'VALIDATION: File size must be between 0 and 50MB' using errcode = '22023';
  end if;
  select project_id into v_project_id from public.issues where id = p_issue_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select is_archived into v_archived from public.projects where id = v_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_role := public.project_role(v_project_id);
  if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  insert into public.attachments (issue_id, uploader_id, filename, storage_path, mime_type, size_bytes, created_at)
  values (p_issue_id, v_user, v_filename, v_storage_path, nullif(trim(p_mime_type), ''), p_size_bytes, v_now)
  returning id into v_attachment_id;
  update public.issues set updated_at = v_now where id = p_issue_id;
  insert into public.issue_events (issue_id, actor_id, event_type, field_name, new_value, metadata)
  values (p_issue_id, v_user, 'ATTACHMENT_ADDED', 'attachment', to_jsonb(v_filename), jsonb_build_object('attachment_id', v_attachment_id, 'filename', v_filename, 'mime_type', p_mime_type, 'size_bytes', p_size_bytes));
  return v_attachment_id;
end;
$$;

revoke execute on function public.add_attachment(uuid, text, text, text, bigint) from anon, public;
grant execute on function public.add_attachment(uuid, text, text, text, bigint) to authenticated;

-- Token lookup for API routes. Only a SHA-256 hash is accepted; plaintext tokens are never stored.
create or replace function public.authenticate_api_token(p_token_hash text)
returns table (token_id uuid, user_id uuid, organization_id uuid, scopes text[])
language sql
security definer
stable
set search_path = public
as $$
  select t.id, t.user_id, t.organization_id, t.scopes
  from public.api_tokens t
  where t.token_hash = p_token_hash
    and (t.expires_at is null or t.expires_at > timezone('utc'::text, now()))
$$;

revoke execute on function public.authenticate_api_token(text) from public;
grant execute on function public.authenticate_api_token(text) to anon, authenticated;

create or replace function public.touch_api_token(p_token_hash text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.api_tokens
  set last_used_at = timezone('utc'::text, now())
  where token_hash = p_token_hash
    and (expires_at is null or expires_at > timezone('utc'::text, now()));
$$;

revoke execute on function public.touch_api_token(text) from public;
grant execute on function public.touch_api_token(text) to anon, authenticated;

-- API mutation wrappers establish the token owner as the transaction-local auth subject,
-- then reuse the existing RPC authorization and audit logic.
create or replace function public.api_create_issue(p_token_hash text, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
  v_issue_number integer;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not ('write' = any(v_token.scopes)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  v_issue_number := public.create_issue(
    (p_payload->>'project_id')::uuid,
    p_payload->>'title', p_payload->>'type', p_payload->>'description',
    p_payload->>'priority', p_payload->>'severity', nullif(p_payload->>'component_id','')::uuid,
    nullif(p_payload->>'assignee_id','')::uuid, p_payload->>'environment',
    p_payload->>'steps_to_reproduce', p_payload->>'expected_behavior', p_payload->>'actual_behavior'
  );
  perform public.touch_api_token(p_token_hash);
  return v_issue_number;
end;
$$;

revoke execute on function public.api_create_issue(text, jsonb) from anon, public;
grant execute on function public.api_create_issue(text, jsonb) to authenticated;

create or replace function public.api_update_issue(p_token_hash text, p_issue_id uuid, p_updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token record;
begin
  select * into v_token from public.authenticate_api_token(p_token_hash) limit 1;
  if not found or not ('write' = any(v_token.scopes)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  perform set_config('request.jwt.claim.sub', v_token.user_id::text, true);
  perform public.update_issue_fields(p_issue_id, p_updates);
  perform public.touch_api_token(p_token_hash);
end;
$$;

revoke execute on function public.api_update_issue(text, uuid, jsonb) from anon, public;
grant execute on function public.api_update_issue(text, uuid, jsonb) to authenticated;

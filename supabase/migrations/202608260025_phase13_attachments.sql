-- Migration 025: Phase 13 - Attachments
-- Table, RLS, Storage Bucket, RPCs, and Realtime publication for issue file attachments

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  uploader_id uuid not null references auth.users (id) on delete restrict,
  filename text not null check (char_length(trim(filename)) between 1 and 255),
  storage_path text not null check (char_length(trim(storage_path)) between 1 and 1000),
  mime_type text,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 52428800), -- 50MB max
  created_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.attachments is 'File and image attachments uploaded to issues.';

create index if not exists idx_attachments_issue_id on public.attachments(issue_id, created_at);
create index if not exists idx_attachments_uploader_id on public.attachments(uploader_id);

alter table public.attachments enable row level security;

-- Project members can view attachments of issues in accessible projects
create policy "Project members can read attachments"
  on public.attachments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = attachments.issue_id
        and public.is_project_member(i.project_id)
    )
  );

-- RPC: add_attachment
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
  if v_filename is null then
    raise exception 'VALIDATION: Filename is required' using errcode = '22023';
  end if;

  v_storage_path := nullif(trim(p_storage_path), '');
  if v_storage_path is null then
    raise exception 'VALIDATION: Storage path is required' using errcode = '22023';
  end if;

  if p_size_bytes < 0 or p_size_bytes > 52428800 then
    raise exception 'VALIDATION: File size must be between 0 and 50MB' using errcode = '22023';
  end if;

  select project_id into v_project_id
  from public.issues
  where id = p_issue_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Lock project row
  select is_archived into v_archived
  from public.projects
  where id = v_project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('REPORTER', 'DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.attachments (
    issue_id,
    uploader_id,
    filename,
    storage_path,
    mime_type,
    size_bytes,
    created_at
  ) values (
    p_issue_id,
    v_user,
    v_filename,
    v_storage_path,
    nullif(trim(p_mime_type), ''),
    p_size_bytes,
    v_now
  ) returning id into v_attachment_id;

  -- Update issue updated_at
  update public.issues
  set updated_at = v_now
  where id = p_issue_id;

  -- Insert audit event
  insert into public.issue_events (
    issue_id,
    actor_id,
    event_type,
    field_name,
    new_value,
    metadata
  ) values (
    p_issue_id,
    v_user,
    'ATTACHMENT_ADDED',
    'attachment',
    to_jsonb(v_filename),
    jsonb_build_object(
      'attachment_id', v_attachment_id,
      'filename', v_filename,
      'mime_type', p_mime_type,
      'size_bytes', p_size_bytes
    )
  );

  return v_attachment_id;
end;
$$;

revoke execute on function public.add_attachment(uuid, text, text, text, bigint) from anon, public;
grant execute on function public.add_attachment(uuid, text, text, text, bigint) to authenticated;

-- RPC: delete_attachment
create or replace function public.delete_attachment(
  p_attachment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_att record;
  v_archived boolean;
  v_role text;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select a.*, i.project_id
  into v_att
  from public.attachments a
  join public.issues i on i.id = a.issue_id
  where a.id = p_attachment_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select is_archived into v_archived
  from public.projects
  where id = v_att.project_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  v_role := public.project_role(v_att.project_id);
  if v_att.uploader_id <> v_user and v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.attachments
  where id = p_attachment_id;

  -- Insert audit event
  insert into public.issue_events (
    issue_id,
    actor_id,
    event_type,
    field_name,
    old_value,
    metadata
  ) values (
    v_att.issue_id,
    v_user,
    'ATTACHMENT_DELETED',
    'attachment',
    to_jsonb(v_att.filename),
    jsonb_build_object(
      'attachment_id', p_attachment_id,
      'filename', v_att.filename,
      'storage_path', v_att.storage_path
    )
  );
end;
$$;

revoke execute on function public.delete_attachment(uuid) from anon, public;
grant execute on function public.delete_attachment(uuid) to authenticated;

-- Realtime publication for attachments
alter publication supabase_realtime add table public.attachments;

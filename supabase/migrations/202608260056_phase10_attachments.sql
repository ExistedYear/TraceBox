-- Migration 056: attachment upload/recovery hardening.
-- Keep validation in a trigger so RPC and any privileged maintenance path share
-- the same MIME and path contract.

create or replace function public.validate_attachment_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_mime text := lower(trim(coalesce(new.mime_type, '')));
begin
  if v_mime not in (
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
    'text/plain', 'text/csv', 'text/markdown', 'application/json',
    'application/pdf', 'application/zip', 'application/gzip',
    'application/x-tar'
  ) then
    raise exception 'VALIDATION: Unsupported attachment MIME type' using errcode = '22023';
  end if;
  if new.storage_path !~ '^[0-9a-fA-F-]{36}/[^/]{1,255}$' then
    raise exception 'VALIDATION: Invalid attachment storage path' using errcode = '22023';
  end if;
  if new.size_bytes < 0 or new.size_bytes > 52428800 then
    raise exception 'VALIDATION: File size must be between 0 and 50MB' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_attachment_metadata on public.attachments;
create trigger validate_attachment_metadata
before insert or update on public.attachments
for each row execute procedure public.validate_attachment_metadata();

-- Validate the actual Supabase Storage Content-Type metadata; absent metadata
-- is rejected so a client cannot claim an allowed MIME only in the DB row.
drop policy if exists "Members can upload issue attachments" on storage.objects;
create policy "Members can upload issue attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'issue-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    and public.can_view_issue(public.issue_id_from_storage_path(name))
    and public.can_comment_on_issue(public.issue_id_from_storage_path(name))
    and metadata is not null
    and lower(coalesce(metadata->>'mimetype', '')) in (
      'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
      'text/plain', 'text/csv', 'text/markdown', 'application/json',
      'application/pdf', 'application/zip', 'application/gzip', 'application/x-tar'
    )
  );

-- Service-role cleanup uses this allowlisted RPC to identify DB rows whose
-- object has disappeared. It never exposes issue metadata to browser clients.
create or replace function public.list_missing_attachment_objects()
returns table (attachment_id uuid, storage_path text)
language sql
security definer
set search_path = public
as $$
  select a.id, a.storage_path
  from public.attachments a
  where not exists (select 1 from storage.objects o where o.bucket_id = 'issue-attachments' and o.name = a.storage_path);
$$;

revoke execute on function public.list_missing_attachment_objects() from anon, authenticated, public;
grant execute on function public.list_missing_attachment_objects() to service_role;

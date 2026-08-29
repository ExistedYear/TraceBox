-- Migration 063: personal account metadata and public profile avatars.
-- Migration 062 is reserved for the mentions workstream.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = excluded.allowed_mime_types;

-- Profile avatars are intentionally public, but only authenticated owners may
-- create, replace, or remove an object. A UUID-prefixed path prevents a user
-- from writing into another user's avatar namespace.
drop policy if exists "Public profile avatars can be viewed" on storage.objects;
create policy "Public profile avatars can be viewed"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'profile-avatars'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)$'
  );

drop policy if exists "Users can upload their profile avatars" on storage.objects;
create policy "Users can upload their profile avatars"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)$'
    and metadata is not null
    and lower(coalesce(metadata->>'mimetype', '')) in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  );

drop policy if exists "Users can replace their profile avatars" on storage.objects;
create policy "Users can replace their profile avatars"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)$'
    and metadata is not null
    and lower(coalesce(metadata->>'mimetype', '')) in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  );

drop policy if exists "Users can delete their profile avatars" on storage.objects;
create policy "Users can delete their profile avatars"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- Profile mutations go through this contract so the caller cannot attach an
-- arbitrary tracking URL. Existing OAuth/provider avatars remain valid when
-- the user only changes their display name; new avatar URLs must be in the
-- TraceBox public bucket and scoped to the current user's UUID.
drop policy if exists "Users can update their own profile" on public.profiles;
revoke insert, update, delete on public.profiles from anon, authenticated;

create or replace function public.update_current_profile(
  p_display_name text,
  p_avatar_url text
)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing_avatar text;
  v_display_name text := nullif(trim(p_display_name), '');
  v_avatar_url text := nullif(trim(p_avatar_url), '');
  v_avatar_pattern text;
  v_avatar_path text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if v_display_name is null or char_length(v_display_name) > 120 then
    raise exception 'VALIDATION: Display name is required and must be <= 120 characters' using errcode = '22023';
  end if;

  select p.avatar_url into v_existing_avatar
  from public.profiles p
  where p.id = v_user
  for update;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_avatar_pattern := '^(https://[a-z0-9-]+\.supabase\.co|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)/storage/v1/object/public/profile-avatars/' || v_user::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)(\?.*)?$';
  if v_avatar_url is not null
     and v_avatar_url is distinct from v_existing_avatar
     and v_avatar_url !~* v_avatar_pattern then
    raise exception 'VALIDATION: Avatar must be a TraceBox profile image' using errcode = '22023';
  end if;
  if v_avatar_url is not null and v_avatar_url is distinct from v_existing_avatar then
    v_avatar_path := substring(v_avatar_url from '/storage/v1/object/public/profile-avatars/([^?]+)');
    if v_avatar_path is null or not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'profile-avatars' and o.name = v_avatar_path
    ) then
      raise exception 'VALIDATION: Avatar object was not found' using errcode = '22023';
    end if;
  end if;

  update public.profiles
  set display_name = v_display_name,
      avatar_url = v_avatar_url
  where profiles.id = v_user;

  return query
  select p.id, p.display_name, p.avatar_url, p.updated_at
  from public.profiles p
  where p.id = v_user;
end;
$$;

revoke execute on function public.update_current_profile(text, text) from public, anon;
grant execute on function public.update_current_profile(text, text) to authenticated;

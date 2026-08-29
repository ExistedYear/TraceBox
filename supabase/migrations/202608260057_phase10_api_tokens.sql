-- Migration 057: API-token lifecycle and developer experience.
-- Tokens remain organization-scoped; API authorization additionally checks the
-- owner's live project memberships. No project restriction is invented here.

create or replace function public.validate_api_token_metadata()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION: Token hash must be a SHA-256 digest' using errcode = '22023';
  end if;
  if new.expires_at is not null and new.expires_at <= timezone('utc'::text, now()) then
    raise exception 'VALIDATION: Token expiration must be in the future' using errcode = '22023';
  end if;
  if new.scopes is null or cardinality(new.scopes) = 0 or not (new.scopes <@ array['read','write','projects:read','issues:read','issues:write','comments:write','milestones:read','search:read','integrations:read','github_links:read','github_links:write']::text[]) then
    raise exception 'VALIDATION: Invalid API token scopes' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_api_token_metadata on public.api_tokens;
create trigger validate_api_token_metadata before insert or update on public.api_tokens
for each row execute procedure public.validate_api_token_metadata();

create or replace function public.rotate_api_token(
  p_token_id uuid,
  p_token_hash text,
  p_expires_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_old record; v_new uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into v_old from public.api_tokens where id = p_token_id and user_id = v_user for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_org_member(v_old.organization_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.api_tokens(user_id, organization_id, name, token_hash, scopes, expires_at)
  values (v_user, v_old.organization_id, v_old.name, p_token_hash, v_old.scopes, p_expires_at)
  returning id into v_new;
  delete from public.api_tokens where id = p_token_id and user_id = v_user;
  return v_new;
end;
$$;

revoke execute on function public.rotate_api_token(uuid, text, timestamptz) from anon, public;
grant execute on function public.rotate_api_token(uuid, text, timestamptz) to authenticated;

create or replace function public.revoke_api_token(p_token_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_deleted integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  delete from public.api_tokens where id = p_token_id and user_id = v_user;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

revoke execute on function public.revoke_api_token(uuid) from anon, public;
grant execute on function public.revoke_api_token(uuid) to authenticated;

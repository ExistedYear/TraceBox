-- Migration 018: Phase 10 - Search + Saved Views
-- Adds pg_trgm, saved_views table, and FTS indexes for issues

create extension if not exists pg_trgm;

-- Saved Views Table
create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  filters jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists saved_views_project_idx on public.saved_views (project_id);
create index if not exists saved_views_created_by_idx on public.saved_views (created_by);

create trigger saved_views_set_updated_at
before update on public.saved_views
for each row execute procedure public.set_updated_at();

-- FTS & Trigram Indexes for Issues
create index if not exists issues_title_trgm_idx on public.issues using gin (title gin_trgm_ops);
create index if not exists issues_description_trgm_idx on public.issues using gin (description gin_trgm_ops);
create index if not exists issues_search_tsv_idx on public.issues using gin (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
);

-- Enable RLS for saved_views
alter table public.saved_views enable row level security;

create policy "Project members can read saved views"
  on public.saved_views for select to authenticated
  using (
    public.is_project_member(project_id)
    and (is_shared = true or created_by = auth.uid())
  );

create policy "Project members can create saved views"
  on public.saved_views for insert to authenticated
  with check (
    public.is_project_member(project_id) and created_by = auth.uid()
  );

create policy "Owners can update/delete their saved views"
  on public.saved_views for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "Owners can delete their saved views"
  on public.saved_views for delete to authenticated
  using (created_by = auth.uid());

-- RPCs for Saved Views
create or replace function public.create_saved_view(
  p_project_id uuid,
  p_name text,
  p_filters jsonb default '{}'::jsonb,
  p_is_shared boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_view_id uuid;
  v_name text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'VALIDATION: Saved view name must be 1–80 characters' using errcode = '22023';
  end if;

  if not public.is_project_member(p_project_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.saved_views (project_id, created_by, name, filters, is_shared)
  values (p_project_id, v_user, v_name, coalesce(p_filters, '{}'::jsonb), coalesce(p_is_shared, false))
  returning id into v_view_id;

  return v_view_id;
end;
$$;

create or replace function public.delete_saved_view(p_view_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  delete from public.saved_views where id = p_view_id and created_by = v_user;
end;
$$;

revoke execute on function public.create_saved_view(uuid, text, jsonb, boolean) from anon, public;
revoke execute on function public.delete_saved_view(uuid) from anon, public;
grant execute on function public.create_saved_view(uuid, text, jsonb, boolean) to authenticated;
grant execute on function public.delete_saved_view(uuid) to authenticated;

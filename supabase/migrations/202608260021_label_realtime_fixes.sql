-- Migration 021: Label color hardening + Realtime publication

-- Fix label color XSS: enforce hex pattern at DB level
alter table public.labels drop constraint if exists labels_color_check;
alter table public.labels add constraint labels_color_check check (color ~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');

-- Harden RPCs to validate color
create or replace function public.create_label(
  p_project_id uuid,
  p_name text,
  p_color text default '#6366f1',
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_archived boolean;
  v_label_id uuid;
  v_name text;
  v_color text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 50 then raise exception 'VALIDATION: Label name must be 1–50 characters' using errcode = '22023'; end if;
  v_color := coalesce(nullif(trim(p_color), ''), '#6366f1');
  if v_color !~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' then raise exception 'VALIDATION: Invalid color' using errcode = '22023'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_manage_project(p_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.labels (project_id, name, color, description) values (p_project_id, v_name, v_color, nullif(trim(coalesce(p_description, '')), '')) returning id into v_label_id;
  return v_label_id;
end;
$$;

create or replace function public.update_label(
  p_label_id uuid,
  p_name text,
  p_color text default '#6366f1',
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_archived boolean;
  v_name text;
  v_color text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 50 then raise exception 'VALIDATION: Label name must be 1–50 characters' using errcode = '22023'; end if;
  v_color := coalesce(nullif(trim(p_color), ''), '#6366f1');
  if v_color !~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' then raise exception 'VALIDATION: Invalid color' using errcode = '22023'; end if;
  select l.project_id into v_project_id from public.labels l where l.id = p_label_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  if not public.can_manage_project(v_project_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.labels set name = v_name, color = v_color, description = nullif(trim(coalesce(p_description, '')), '') where id = p_label_id;
end;
$$;

-- Enable Realtime for key tables
do $$
begin
  -- Add tables to supabase_realtime publication if not already added
  begin
    alter publication supabase_realtime add table public.comments;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.issues;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.issue_watchers;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.issue_links;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.issue_events;
  exception when duplicate_object then null;
  end;
end $$;

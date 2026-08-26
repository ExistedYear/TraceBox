-- Phase 5: comments + activity timeline.
-- Schema §6.14 and plan §18/§19. Comments are project-member readable,
-- RPC-only writes, with immutable COMMENT_ADDED / COMMENT_EDITED audit events.
-- Activity timeline is a merged view of issue_events + comments ordered by time.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 10000),
  edited_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.comments is 'Issue comments; writes go through trusted RPCs.';

create index if not exists comments_issue_created_idx on public.comments (issue_id, created_at);
create index if not exists comments_author_idx on public.comments (author_id);

create trigger comments_set_updated_at
before update on public.comments
for each row execute procedure public.set_updated_at();

alter table public.comments enable row level security;

-- Helper: can the current user comment on this issue?
-- Reporter+ in the issue's project, and project not archived.
create or replace function public.can_comment_on_issue(p_issue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.issues i
    join public.projects p on p.id = i.project_id
    where i.id = p_issue_id
      and not p.is_archived
      and public.project_role(i.project_id) in ('REPORTER', 'DEVELOPER', 'MAINTAINER')
  );
$$;

revoke execute on function public.can_comment_on_issue(uuid) from anon, public;
grant execute on function public.can_comment_on_issue(uuid) to authenticated;

create policy "Project members can read comments"
  on public.comments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = issue_id and public.is_project_member(i.project_id)
    )
  );

-- Tighten column grants for direct client updates (definer RPCs bypass these).
revoke update on public.comments from anon, authenticated, public;
grant update (body) on public.comments to authenticated;

-- Close direct INSERT/DELETE via RLS: no insert/delete policies remain.
-- Clients must call add_comment / edit_comment.

create or replace function public.add_comment(p_issue_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_body text;
  v_comment_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null or char_length(v_body) < 1 or char_length(v_body) > 10000 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = p_issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.is_archived into v_archived from public.projects p where p.id = v_project_id for update;
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

  -- Serialize comment writes against issue field writes on the same project row.
  -- Already locked projects row above.

  insert into public.comments (issue_id, author_id, body)
  values (p_issue_id, v_user, v_body)
  returning id into v_comment_id;

  -- Touch the parent issue so "recently updated" sorting reflects new activity.
  update public.issues set updated_at = timezone('utc'::text, now()) where id = p_issue_id;

  insert into public.issue_events (issue_id, actor_id, event_type, metadata)
  values (
    p_issue_id,
    v_user,
    'COMMENT_ADDED',
    jsonb_build_object('comment_id', v_comment_id, 'excerpt', left(v_body, 200))
  );

  return v_comment_id;
end;
$$;

create or replace function public.edit_comment(p_comment_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_archived boolean;
  v_body text;
  v_old record;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null or char_length(v_body) < 1 or char_length(v_body) > 10000 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  -- Resolve the target comment and its project without locks first.
  select * into v_old from public.comments where id = p_comment_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_body = v_old.body then
    return;
  end if;

  select i.project_id into v_project_id from public.issues i where i.id = v_old.issue_id;
  if v_project_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Lock project row first (consistent hierarchy: projects -> issues -> components -> comments).
  select p.is_archived into v_archived
  from public.projects p
  where p.id = v_project_id
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archived then
    raise exception 'PROJECT_ARCHIVED' using errcode = '42501';
  end if;

  -- Only the author or a Developer/Maintainer may edit. Reporters may edit only their own.
  if v_old.author_id <> v_user then
    v_role := public.project_role(v_project_id);
    if v_role not in ('DEVELOPER', 'MAINTAINER') then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;

  -- Lock comment row under the project lock.
  perform 1 from public.comments where id = p_comment_id for update;
  update public.comments
  set body = v_body,
      edited_at = timezone('utc'::text, now())
  where id = p_comment_id;

  update public.issues set updated_at = timezone('utc'::text, now()) where id = v_old.issue_id;

  insert into public.issue_events (issue_id, actor_id, event_type, field_name, old_value, new_value, metadata)
  values (
    v_old.issue_id,
    v_user,
    'COMMENT_EDITED',
    'comment_id',
    to_jsonb(v_old.id::text),
    to_jsonb(v_body),
    jsonb_build_object('comment_id', v_old.id, 'excerpt', left(v_body, 200))
  );
end;
$$;

revoke execute on function public.add_comment(uuid, text), public.edit_comment(uuid, text) from anon, public;
grant execute on function public.add_comment(uuid, text), public.edit_comment(uuid, text) to authenticated;

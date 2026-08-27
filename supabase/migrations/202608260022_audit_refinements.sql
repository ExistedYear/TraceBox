-- Migration 022: Final Audit Refinements
-- 1. create_organization: input trimming & caller profile upsert
-- 2. dispatch_issue_notification: check notification_preferences
-- 3. can_transition_issue: support VIEWER required_role in transition hierarchy
-- 4. prevent_saved_view_project_change: set search_path = public

create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_organization_id uuid;
  v_name text;
  v_slug text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  v_slug := nullif(lower(trim(coalesce(p_slug, ''))), '');

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'VALIDATION: Organization name must be 2–60 characters' using errcode = '22023';
  end if;

  if v_slug is null or char_length(v_slug) < 2 or char_length(v_slug) > 60 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'VALIDATION: Invalid workspace slug' using errcode = '22023';
  end if;

  -- Ensure caller profile exists
  insert into public.profiles (id, display_name)
  values (v_user, coalesce(auth.jwt()->>'display_name', split_part(coalesce(auth.jwt()->>'email', 'user'), '@', 1)))
  on conflict (id) do nothing;

  insert into public.organizations (name, slug, owner_id)
  values (v_name, v_slug, v_user)
  returning id into v_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, v_user, 'OWNER');

  return v_organization_id;
end;
$$;

create or replace function public.dispatch_issue_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_issue_id uuid,
  p_type text,
  p_data jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pref record;
  v_enabled boolean := true;
begin
  -- Do not notify self
  if p_recipient_id is null or p_recipient_id = p_actor_id then
    return;
  end if;

  -- Check user notification preferences if set
  select * into v_pref from public.notification_preferences where user_id = p_recipient_id;
  if found then
    if p_type = 'MENTION' and not v_pref.mentions then v_enabled := false; end if;
    if p_type = 'ASSIGNED' and not v_pref.assignments then v_enabled := false; end if;
    if p_type = 'COMMENT' and not v_pref.comments then v_enabled := false; end if;
    if p_type = 'STATUS_CHANGED' and not v_pref.status_changes then v_enabled := false; end if;
    if p_type = 'WATCHED_ISSUE_UPDATED' and not v_pref.watch_updates then v_enabled := false; end if;
  end if;

  if v_enabled then
    insert into public.notifications (user_id, actor_id, issue_id, type, data)
    values (p_recipient_id, p_actor_id, p_issue_id, p_type, p_data);
  end if;
end;
$$;

create or replace function public.can_transition_issue(p_issue_id uuid, p_to_state_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_project_id uuid;
  v_current_state_id uuid;
  v_is_archived boolean;
begin
  if v_user is null then
    return false;
  end if;

  select i.project_id, i.status_id, p.is_archived
  into v_project_id, v_current_state_id, v_is_archived
  from public.issues i
  join public.projects p on p.id = i.project_id
  where i.id = p_issue_id;

  if not found or v_is_archived then
    return false;
  end if;

  v_role := public.project_role(v_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER', 'REPORTER') then
    return false;
  end if;

  -- Same state is a no-op / allowed
  if v_current_state_id = p_to_state_id then
    return true;
  end if;

  -- Maintainers can override transitions
  if v_role = 'MAINTAINER' then
    return exists (
      select 1 from public.workflow_states ws
      where ws.id = p_to_state_id and ws.project_id = v_project_id
    );
  end if;

  -- Check workflow_transitions table
  return exists (
    select 1 from public.workflow_transitions wt
    where wt.project_id = v_project_id
      and wt.from_state_id = v_current_state_id
      and wt.to_state_id = p_to_state_id
      and (
        wt.required_role is null
        or wt.required_role = v_role
        or wt.required_role = 'VIEWER'
        or (wt.required_role = 'REPORTER' and v_role in ('DEVELOPER', 'MAINTAINER'))
        or (wt.required_role = 'DEVELOPER' and v_role = 'MAINTAINER')
      )
  );
end;
$$;

create or replace function public.prevent_saved_view_project_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if OLD.project_id is distinct from NEW.project_id then
    raise exception 'VALIDATION: Cannot change project of saved view' using errcode = '22023';
  end if;
  return NEW;
end;
$$;

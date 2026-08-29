-- Phase 9: issue queue filtering, indexes, and authorized bulk updates.
-- Queue reads remain RLS-backed. Bulk writes are RPC-only and lock the project
-- before issues in UUID order so a multi-row operation is atomic and observable.

create index if not exists issues_queue_reporter_created_idx
  on public.issues (project_id, reporter_id, created_at desc, id);
create index if not exists issues_queue_version_idx
  on public.issues (project_id, affected_version_id, updated_at desc, id);
create index if not exists issues_queue_milestone_idx
  on public.issues (project_id, target_milestone_id, updated_at desc, id);
create index if not exists issue_labels_issue_label_idx
  on public.issue_labels (issue_id, label_id);

create or replace function public.bulk_update_issue_fields(
  p_project_id uuid,
  p_issue_ids uuid[],
  p_updates jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_archived boolean;
  v_issue record;
  v_count integer := 0;
  v_expected integer;
  v_core jsonb;
  v_version uuid;
  v_milestone uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_project_id is null or p_issue_ids is null or coalesce(array_length(p_issue_ids, 1), 0) = 0 then
    raise exception 'VALIDATION: Select at least one issue' using errcode = '22023';
  end if;
  if array_length(p_issue_ids, 1) > 100 then
    raise exception 'VALIDATION: Bulk updates are limited to 100 issues' using errcode = '22023';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'object' or p_updates = '{}'::jsonb then
    raise exception 'VALIDATION: An update object with at least one supported field is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_updates) key(name)
    where name not in ('priority', 'severity', 'type', 'assignee_id', 'component_id', 'affected_version_id', 'target_milestone_id')
  ) then
    raise exception 'VALIDATION: Unsupported bulk issue update field' using errcode = '22023';
  end if;

  select p.is_archived into v_archived
  from public.projects p
  where p.id = p_project_id
  for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_archived then raise exception 'PROJECT_ARCHIVED' using errcode = '42501'; end if;
  v_role := public.project_role(p_project_id);
  if v_role not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select count(*)::integer, count(distinct issue_id)::integer
    into v_expected, v_count
  from unnest(p_issue_ids) issue_id;
  if v_expected <> v_count then
    raise exception 'VALIDATION: Duplicate issue selection' using errcode = '22023';
  end if;
  select count(*)::integer into v_count
  from public.issues i
  where i.project_id = p_project_id
    and i.id = any(p_issue_ids)
    and public.can_view_issue(i.id);
  if v_count <> v_expected then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_updates ? 'priority' and (jsonb_typeof(p_updates->'priority') <> 'string' or p_updates->>'priority' not in ('P0','P1','P2','P3','P4')) then
    raise exception 'VALIDATION: Invalid priority' using errcode = '22023';
  end if;
  if p_updates ? 'severity' and (jsonb_typeof(p_updates->'severity') <> 'string' or p_updates->>'severity' not in ('BLOCKER','CRITICAL','MAJOR','MINOR','TRIVIAL')) then
    raise exception 'VALIDATION: Invalid severity' using errcode = '22023';
  end if;
  if p_updates ? 'type' and (jsonb_typeof(p_updates->'type') <> 'string' or p_updates->>'type' not in ('BUG','ENHANCEMENT','TASK','SECURITY','PERFORMANCE','REGRESSION')) then
    raise exception 'VALIDATION: Invalid issue type' using errcode = '22023';
  end if;
  begin
    if p_updates ? 'assignee_id' and jsonb_typeof(p_updates->'assignee_id') <> 'null' then v_version := (p_updates->>'assignee_id')::uuid; end if;
    if p_updates ? 'component_id' and jsonb_typeof(p_updates->'component_id') <> 'null' then v_version := (p_updates->>'component_id')::uuid; end if;
    if p_updates ? 'affected_version_id' and jsonb_typeof(p_updates->'affected_version_id') <> 'null' then v_version := (p_updates->>'affected_version_id')::uuid; end if;
    if p_updates ? 'target_milestone_id' and jsonb_typeof(p_updates->'target_milestone_id') <> 'null' then v_milestone := (p_updates->>'target_milestone_id')::uuid; end if;
  exception when invalid_text_representation then
    raise exception 'VALIDATION: Invalid UUID' using errcode = '22023';
  end;
  if p_updates ? 'component_id' and jsonb_typeof(p_updates->'component_id') <> 'null' and not exists (select 1 from public.components c where c.id = (p_updates->>'component_id')::uuid and c.project_id = p_project_id and not c.is_archived) then
    raise exception 'INVALID_COMPONENT' using errcode = '23503';
  end if;
  if p_updates ? 'assignee_id' and jsonb_typeof(p_updates->'assignee_id') <> 'null' and not (
    exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = (p_updates->>'assignee_id')::uuid)
    or exists (select 1 from public.projects p join public.organizations o on o.id = p.organization_id left join public.organization_members om on om.organization_id = o.id and om.user_id = (p_updates->>'assignee_id')::uuid where p.id = p_project_id and (o.owner_id = (p_updates->>'assignee_id')::uuid or om.role in ('OWNER','ADMIN')))
  ) then raise exception 'INVALID_ASSIGNEE' using errcode = '23503'; end if;
  if p_updates ? 'affected_version_id' and jsonb_typeof(p_updates->'affected_version_id') <> 'null' and not exists (select 1 from public.versions v where v.id = (p_updates->>'affected_version_id')::uuid and v.project_id = p_project_id and not v.is_archived) then
    raise exception 'INVALID_VERSION' using errcode = '23503';
  end if;
  if p_updates ? 'target_milestone_id' and jsonb_typeof(p_updates->'target_milestone_id') <> 'null' and not exists (select 1 from public.milestones m where m.id = (p_updates->>'target_milestone_id')::uuid and m.project_id = p_project_id) then
    raise exception 'INVALID_MILESTONE' using errcode = '23503';
  end if;

  v_core := p_updates - 'affected_version_id' - 'target_milestone_id';
  for v_issue in
    select i.id, i.affected_version_id, i.target_milestone_id
    from public.issues i
    where i.project_id = p_project_id and i.id = any(p_issue_ids)
    order by i.id
    for update
  loop
    if v_core <> '{}'::jsonb then perform public.update_issue_fields(v_issue.id, v_core); end if;
    if p_updates ? 'affected_version_id' and v_issue.affected_version_id is distinct from nullif(p_updates->>'affected_version_id', '')::uuid then
      update public.issues set affected_version_id = nullif(p_updates->>'affected_version_id', '')::uuid where id = v_issue.id;
      insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value) values (v_issue.id, v_user, 'VERSION_CHANGED', 'affected_version_id', to_jsonb(v_issue.affected_version_id::text), to_jsonb(nullif(p_updates->>'affected_version_id', '')));
    end if;
    if p_updates ? 'target_milestone_id' and v_issue.target_milestone_id is distinct from nullif(p_updates->>'target_milestone_id', '')::uuid then
      update public.issues set target_milestone_id = nullif(p_updates->>'target_milestone_id', '')::uuid where id = v_issue.id;
      insert into public.issue_events(issue_id, actor_id, event_type, field_name, old_value, new_value) values (v_issue.id, v_user, 'MILESTONE_CHANGED', 'target_milestone_id', to_jsonb(v_issue.target_milestone_id::text), to_jsonb(nullif(p_updates->>'target_milestone_id', '')));
    end if;
  end loop;
  return v_expected;
end;
$$;

revoke execute on function public.bulk_update_issue_fields(uuid, uuid[], jsonb) from anon, public;
grant execute on function public.bulk_update_issue_fields(uuid, uuid[], jsonb) to authenticated;

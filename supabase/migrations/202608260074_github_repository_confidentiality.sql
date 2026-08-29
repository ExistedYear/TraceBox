-- Migration 074: keep the GitHub operations read model within the same
-- repository/installation confidentiality boundary as the repository picker.
-- Maintainers may inspect the organization catalog; Developers only see
-- project-bound repositories and installations that own those repositories.

create or replace function public.get_github_operations(p_project_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_is_maintainer boolean;
  v_deliveries jsonb;
  v_counts jsonb;
begin
  if auth.uid() is null or public.project_role(p_project_id) not in ('DEVELOPER', 'MAINTAINER') then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select organization_id into v_org
  from public.projects
  where id = p_project_id and not is_archived;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_is_maintainer := public.project_role(p_project_id) = 'MAINTAINER';

  with scoped as (
    select d.*
    from public.github_webhook_deliveries d
    where exists (
      select 1 from public.github_installations gi
      where gi.organization_id = v_org
        and gi.github_installation_id = d.github_installation_id
        and d.github_repository_id is null
        and (
          v_is_maintainer
          or exists (
            select 1
            from public.project_github_repositories pgr
            join public.github_repositories gr on gr.id = pgr.github_repository_id
            where pgr.project_id = p_project_id
              and gr.installation_id = gi.id
          )
        )
    )
    or exists (
      select 1
      from public.project_github_repositories pgr
      join public.github_repositories gr on gr.id = pgr.github_repository_id
      where pgr.project_id = p_project_id
        and gr.github_repository_id = d.github_repository_id
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', s.delivery_id,
    'event_name', s.event_name,
    'action', s.action,
    'github_installation_id', s.github_installation_id,
    'github_repository_id', s.github_repository_id,
    'status', s.status,
    'attempt_count', s.attempt_count,
    'error', null,
    'received_at', s.received_at,
    'last_attempt_at', s.last_attempt_at,
    'next_retry_at', s.next_retry_at,
    'processed_at', s.processed_at,
    'failure_category', case when s.status = 'FAILED' then s.failure_category else null end,
    'retry_eligible', (s.status = 'FAILED' and s.attempt_count < 8 and s.payload_cleared_at is null and s.payload <> '{}'::jsonb),
    'affected_issues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'issue_key', p.key || '-' || i.issue_number,
        'relationship', di.relationship,
        'resolution_applied', di.resolution_applied
      ) order by p.key, i.issue_number, di.relationship)
      from public.github_webhook_delivery_issues di
      join public.issues i on i.id = di.issue_id
      join public.projects p on p.id = i.project_id
      where di.delivery_id = s.id
        and i.project_id = p_project_id
        and public.can_view_issue(i.id)
    ), '[]'::jsonb)
  ) order by s.received_at desc, s.id desc), '[]'::jsonb)
  into v_deliveries
  from (select * from scoped order by received_at desc, id desc limit 100) s;

  with scoped as (
    select d.status, d.attempt_count, d.payload_cleared_at, d.payload
    from public.github_webhook_deliveries d
    where exists (
      select 1 from public.github_installations gi
      where gi.organization_id = v_org
        and gi.github_installation_id = d.github_installation_id
        and d.github_repository_id is null
        and (
          v_is_maintainer
          or exists (
            select 1
            from public.project_github_repositories pgr
            join public.github_repositories gr on gr.id = pgr.github_repository_id
            where pgr.project_id = p_project_id
              and gr.installation_id = gi.id
          )
        )
    )
    or exists (
      select 1
      from public.project_github_repositories pgr
      join public.github_repositories gr on gr.id = pgr.github_repository_id
      where pgr.project_id = p_project_id
        and gr.github_repository_id = d.github_repository_id
    )
  )
  select jsonb_build_object(
    'processed', count(*) filter (where status = 'PROCESSED'),
    'failed', count(*) filter (where status = 'FAILED'),
    'terminal', count(*) filter (where status = 'FAILED' and (attempt_count >= 8 or payload_cleared_at is not null or payload = '{}'::jsonb)),
    'retryable', count(*) filter (where status = 'FAILED' and attempt_count < 8 and payload_cleared_at is null and payload <> '{}'::jsonb)
  ) into v_counts
  from scoped;

  return jsonb_build_object(
    'health', null,
    'legacy_repo', (
      select pi.repo_full_name
      from public.project_integrations pi
      where pi.project_id = p_project_id and pi.provider = 'GITHUB' and pi.is_enabled
      order by pi.updated_at desc
      limit 1
    ),
    'installations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', gi.id,
        'github_installation_id', gi.github_installation_id,
        'github_account_login', gi.github_account_login,
        'github_account_type', gi.github_account_type,
        'status', gi.status,
        'permissions', gi.permissions,
        'last_verified_at', gi.last_verified_at
      ) order by gi.updated_at desc)
      from public.github_installations gi
      where gi.organization_id = v_org
        and (
          v_is_maintainer
          or exists (
            select 1
            from public.project_github_repositories pgr
            join public.github_repositories gr on gr.id = pgr.github_repository_id
            where pgr.project_id = p_project_id
              and gr.installation_id = gi.id
          )
        )
    ), '[]'::jsonb),
    'repositories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', gr.id,
        'installation_id', gr.installation_id,
        'github_repository_id', gr.github_repository_id,
        'full_name', gr.full_name,
        'private', gr.private,
        'archived', gr.archived,
        'default_branch', gr.default_branch,
        'html_url', gr.html_url,
        'is_accessible', gr.is_accessible,
        'last_synced_at', gr.last_synced_at,
        'is_primary', pgr.is_primary,
        'target_branches', pgr.target_branches,
        'auto_resolve_enabled', pgr.auto_resolve_enabled,
        'last_webhook_at', last_delivery.received_at,
        'last_webhook_status', last_delivery.status,
        'last_webhook_failure_category', case when last_delivery.status = 'FAILED' then last_delivery.failure_category else null end,
        'configuration_error', case
          when gi.status <> 'ACTIVE' then 'INSTALLATION_' || gi.status
          when not gr.is_accessible then 'REPOSITORY_INACCESSIBLE'
          when gr.archived then 'REPOSITORY_ARCHIVED'
          else null
        end
      ) order by pgr.is_primary desc, gr.full_name)
      from public.project_github_repositories pgr
      join public.github_repositories gr on gr.id = pgr.github_repository_id
      join public.github_installations gi on gi.id = gr.installation_id
      left join lateral (
        select d.received_at, d.status, d.failure_category
        from public.github_webhook_deliveries d
        where d.github_repository_id = gr.github_repository_id
        order by d.received_at desc, d.id desc
        limit 1
      ) last_delivery on true
      where pgr.project_id = p_project_id
    ), '[]'::jsonb),
    'deliveries', v_deliveries,
    'counts', v_counts,
    'configuration_errors', coalesce((
      select jsonb_agg(distinct configuration_error)
      from (
        select case
          when gi.status <> 'ACTIVE' then 'INSTALLATION_' || gi.status
          when not gr.is_accessible then 'REPOSITORY_INACCESSIBLE'
          when gr.archived then 'REPOSITORY_ARCHIVED'
          else null
        end as configuration_error
        from public.project_github_repositories pgr
        join public.github_repositories gr on gr.id = pgr.github_repository_id
        join public.github_installations gi on gi.id = gr.installation_id
        where pgr.project_id = p_project_id
      ) errors
      where configuration_error is not null
    ), '[]'::jsonb),
    'canonical_model', 'GITHUB_APP',
    'compatibility_model', 'LEGACY_COMPATIBILITY'
  );
end;
$$;

revoke execute on function public.get_github_operations(uuid) from anon, public;
grant execute on function public.get_github_operations(uuid) to authenticated;

-- Migration 032: enforce restricted issue access on every issue-owned mutation

create or replace function public.enforce_issue_visibility_access()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_issue_id uuid;
  v_target_issue_id uuid;
  v_service_role boolean := coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
begin
  if v_service_role then
    return new;
  end if;
  if tg_table_name = 'issues' then
    v_issue_id := coalesce(new.id, old.id);
    if not public.can_view_issue(v_issue_id) then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  elsif tg_table_name = 'issue_links' then
    v_issue_id := coalesce(new.source_issue_id, old.source_issue_id);
    v_target_issue_id := coalesce(new.target_issue_id, old.target_issue_id);
    if not public.can_view_issue(v_issue_id) or not public.can_view_issue(v_target_issue_id) then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  else
    v_issue_id := coalesce(new.issue_id, old.issue_id);
    if not public.can_view_issue(v_issue_id) then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- These triggers protect privileged RPCs as well as any future write path.
drop trigger if exists enforce_issue_visibility_on_issues on public.issues;
create trigger enforce_issue_visibility_on_issues
before update on public.issues
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_issue_events on public.issue_events;
create trigger enforce_issue_visibility_on_issue_events
before insert on public.issue_events
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_issue_labels on public.issue_labels;
create trigger enforce_issue_visibility_on_issue_labels
before insert or update on public.issue_labels
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_issue_watchers on public.issue_watchers;
create trigger enforce_issue_visibility_on_issue_watchers
before insert or update on public.issue_watchers
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_issue_links on public.issue_links;
create trigger enforce_issue_visibility_on_issue_links
before insert or update on public.issue_links
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_comments on public.comments;
create trigger enforce_issue_visibility_on_comments
before insert or update on public.comments
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_attachments on public.attachments;
create trigger enforce_issue_visibility_on_attachments
before insert or update on public.attachments
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_github_links on public.issue_github_links;
create trigger enforce_issue_visibility_on_github_links
before insert or update on public.issue_github_links
for each row execute procedure public.enforce_issue_visibility_access();

drop trigger if exists enforce_issue_visibility_on_custom_values on public.issue_custom_values;
create trigger enforce_issue_visibility_on_custom_values
before insert or update on public.issue_custom_values
for each row execute procedure public.enforce_issue_visibility_access();

-- Correct the original policy names from migrations 004, 016, 017.
drop policy if exists "Project members can read the audit trail" on public.issue_events;
create policy "Project members and grantees can read issue events"
  on public.issue_events for select to authenticated
  using (public.can_view_issue(issue_id));

drop policy if exists "Project members can read issue watchers" on public.issue_watchers;
create policy "Project members and grantees can read issue watchers"
  on public.issue_watchers for select to authenticated
  using (public.can_view_issue(issue_id));

drop policy if exists "Project members can read issue labels" on public.issue_labels;
create policy "Project members and grantees can read issue labels"
  on public.issue_labels for select to authenticated
  using (public.can_view_issue(issue_id));

drop policy if exists "Project members can read issue links" on public.issue_links;
create policy "Project members and grantees can read issue links"
  on public.issue_links for select to authenticated
  using (public.can_view_issue(source_issue_id) and public.can_view_issue(target_issue_id));

-- Permit only safe token scopes and cap their number.
alter table public.api_tokens drop constraint if exists api_tokens_scopes_check;
alter table public.api_tokens add constraint api_tokens_scopes_check
  check (cardinality(scopes) between 1 and 2 and scopes <@ array['read', 'write']::text[]);

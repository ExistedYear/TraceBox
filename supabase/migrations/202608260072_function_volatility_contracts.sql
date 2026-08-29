-- Match optimizer volatility declarations to the visibility/auth helpers each
-- read model invokes. VOLATILE is the safe contract when a function depends on
-- request-local identity or helpers that PostgreSQL classifies as volatile.

alter function public.get_github_operations(uuid) volatile;
alter function public.get_unread_notifications_count() volatile;
alter function public.list_notifications(timestamptz, uuid, boolean, integer) volatile;
alter function public.get_issue_reports(uuid, integer) volatile;
alter function public.get_dashboard_metrics(uuid) volatile;
alter function public.list_project_audit_events(uuid, integer, integer, uuid, text, uuid, timestamptz, timestamptz) volatile;
alter function public.list_project_mention_candidates(uuid, text, integer, uuid) volatile;
alter function public.redact_audit_json(jsonb) stable;

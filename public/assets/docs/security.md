# TraceBox security summary

Source: the repository `SECURITY.md` policy and README.

- Authentication and session refresh use Supabase Auth.
- Restricted issues use one visibility boundary across issues, comments, files, notifications, reports, APIs, and realtime updates.
- Attachments are private and use short-lived signed URLs.
- Service-role, GitHub App, webhook, cron, and AI credentials remain server-only.
- Privileged changes go through narrow SQL functions with explicit authorization checks.
- Audit history is immutable from browser roles.

Report vulnerabilities privately through the process in `SECURITY.md`. Do not open a public issue for an unpatched vulnerability.

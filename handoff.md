# TraceBox Handoff

## Current implementation

TraceBox implements the roadmap in `docs/tracebox-main-plan.md` through Phase 20:

1. Organizations and projects
2. Components and default workflow
3. Atomic issue creation and audit history
4. Issue table, filtering, sorting, pagination, and inline editing
5. Comments and unified activity timeline
6. Assignment, workflow transitions, resolutions, and reopen
7. Labels, versions, milestones, and planning metadata
8. Watchers and notifications
9. Supabase Realtime subscriptions
10. Search and saved views
11. Issue links and duplicate detection
12. Triage Inbox with inline classification and keyboard shortcuts
13. Private Supabase Storage attachments with signed downloads and image previews
14. Reports, MTTR, issue aging, and component/priority breakdowns
15. Explainable release readiness scoring and risk lists
16. Command palette, issue search, and global keyboard shortcuts
17. Issue templates and template selection during issue creation
18. Restricted security issues with explicit access grants and RLS
19. GitHub App installation verification, repository bindings, PR/commit artifacts, link validation, signed durable webhooks, and reconciliation
20. Custom fields, issue custom values, API tokens, and scoped REST API routes

Database state is represented by migrations `202608260001` through `202608260040`. `supabase/full_schema.sql` is regenerated from all migration files in lexical order.

## Important runtime configuration

Required local/Vercel variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-or-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
GITHUB_WEBHOOK_SECRET=<server-only-webhook-signing-secret>
GITHUB_APP_ID=<github-app-id>
GITHUB_APP_SLUG=<github-app-slug>
GITHUB_APP_CLIENT_ID=<github-app-client-id>
GITHUB_APP_CLIENT_SECRET=<server-only-github-app-client-secret>
GITHUB_APP_PRIVATE_KEY=<server-only-github-app-private-key>
GITHUB_APP_CALLBACK_URL=<exact-github-app-callback-url>
GITHUB_API_VERSION=2022-11-28
CRON_SECRET=<server-only-vercel-cron-secret>
```

`SUPABASE_SERVICE_ROLE_KEY` is used only in the server-side API/webhook helper. Never expose it through `NEXT_PUBLIC_*`, client bundles, logs, Git, or API responses.

## Verification performed in this checkout

TypeScript:  npx tsc --noEmit — passed
Tests:       112/112 passed across 15 test files
Lint:        0 errors; 3 existing warnings (ESLint export, TanStack Table, and React Hook Form compatibility)
Build:       npm run build with placeholder public Supabase variables — passed
Migration check: 40 files contiguous and `supabase/full_schema.sql` synchronized
```

Static source audits found and fixed migration syntax, API issue argument ordering, granular API scopes, restricted issue leaks, API token authorization, webhook key association and status updates, optional GitHub merge resolution, storage authorization, triage action permissions, report denominators, notification mutation handling, issue-link validation, typed custom-field validation, password recovery, Markdown rendering, theme handling, and responsive table layout issues.

The local-only `qa/live/` Playwright suite was added for hosted checks. It is ignored by Git and must be configured separately with disposable API, OAuth, and webhook test credentials. A pre-deployment probe against `https://trace-box.vercel.app` found that the existing production deployment predates this release: `/forgot-password`, `/api/v1/milestones`, and `/api/v1/search` returned `404`, while the existing API auth boundary returned `401` as expected.

## Deployment checklist

1. Create/link the intended Supabase project.
2. Apply all migrations `001`–`040` in order from `supabase/full_schema.sql` or the individual files.
3. Verify the private `issue-attachments` Storage bucket and policies.
4. Verify `supabase_realtime` publication tables.
5. Configure Supabase Auth Site URL and callback URLs.
6. Configure Vercel public variables plus the server-only service-role, GitHub App, webhook, and cron variables.
7. Configure the GitHub App callback at `/api/github/callback`, read-only permissions, and App webhook at `/api/webhooks/github`.
8. Run `qa/live/` against the deployed URL for public routes, OAuth redirect, API scopes/pagination, and webhook signatures.
9. Run the live flow: signup → workspace → project → issue → triage → comments/attachments → planning → GitHub App install → repository binding → verified GitHub link → reports/readiness → logout.
10. Set `CRON_SECRET`, verify the Vercel cron invokes `/api/github/reconcile`, and regenerate database types from the live schema if the deployed schema differs.

Detailed external setup, migration order, reset guidance, Storage, Auth, Realtime, Vercel, GitHub, API token, and end-to-end instructions are in `deployment.md`.

## Migration discipline

Never rewrite an applied migration. Add a new timestamped migration for every schema correction. Keep RLS enabled. Keep service-role access server-only. `supabase/full_schema.sql` must be regenerated whenever migration files change.

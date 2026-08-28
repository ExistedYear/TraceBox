# TraceBox Handoff

## Current implementation

TraceBox implements the roadmap in `docs/archive/tracebox-main-plan.md` through Phase 20:

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
19. GitHub App installation verification through the supported user-installation list endpoint, repository bindings, PR/commit artifacts, link validation, signed durable webhooks, and reconciliation
20. Custom fields, issue custom values, API tokens, and scoped REST API routes

The GitHub integrations settings page now presents the approved command-center layout: connection metrics, Active / Needs attention / History tabs, verified installation health, sanitized webhook delivery history, inaccessible/archived repository warnings, GitHub installation management links, repository sync, primary selection, and per-repository target-branch/auto-resolution saves. Existing maintainer/developer permissions are preserved; developers retain read/search/link access while installation and binding mutations remain maintainer-only.

Database state is represented by migrations `202608260001` through `202608260045`. `supabase/full_schema.sql` is regenerated from all migration files in lexical order. Migration 041 makes service-role SQL guards compatible with legacy JWT claims, PostgREST JSON claims, and opaque Supabase secret-key requests. Migration 042 adds the PR picker/CI data model, derived-link reconciliation, atomic webhook replay state, payload cleanup, and explicit Maintainer-only primary repository management. Migration 043 applies the same compatibility guard to new RPCs, bounds failed retries, removes conflicting derived links, and requires an active installation for primary selection. Migration 044 aligns browser and REST issue updates on a shared validated contract. Migration 045 adds explicit project membership, hashed invitations, membership audit history, role management, and ownership transfer.

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
Tests:       128/128 passed across 18 test files
Lint:        0 errors; 3 existing warnings (ESLint export, TanStack Table, and React Hook Form compatibility)
Build:       npm run build with placeholder public Supabase variables — passed
Migration check: 45 files contiguous and `supabase/full_schema.sql` synchronized
Database types: committed types include the current 45-migration schema; regenerate after applying migrations 044–045 to a local or linked database

The hosted GitHub flow was manually verified on 2026-08-28: a private repository was installed, discovered, bound to a project using key `BUG`, and a PR containing `Fixes BUG-1` was linked by webhook and changed the issue to `RESOLVED / FIXED` after merging into `main`. Public deployment probes also returned `200` for `/` and `/login`, `405` for an unsupported webhook `GET`, and `401` for an unsigned webhook `POST`.

The ignored `qa/live/` Playwright suite remains local-only. It was not fully run from this checkout because no ignored `qa/live/.env` credentials were present and the runner lacked the Chromium `libnspr4.so` dependency. Run it from a normal workstation with the deployment URL, disposable API token, and matching webhook secret configured locally.

Static source audits found and fixed migration syntax, API issue argument ordering, granular API scopes, restricted issue leaks, API token authorization, webhook key association and status updates, optional GitHub merge resolution, storage authorization, triage action permissions, report denominators, notification mutation handling, issue-link validation, typed custom-field validation, password recovery, Markdown rendering, theme handling, sidebar layout, and responsive table layout issues.

The local-only `qa/live/` Playwright suite was added for hosted checks. It is ignored by Git and must be configured separately with disposable API, OAuth, and webhook test credentials. Do not commit its `.env`, browser state, reports, or test-results. Earlier pre-deployment probes found an older deployment; the current public probes and the hosted GitHub PR flow now pass, while the full multi-user/API/browser suite remains outstanding.

## Deployment checklist

1. Create/link the intended Supabase project.
2. Apply all migrations `001`–`045` in order from `supabase/full_schema.sql` or the individual files.
3. Verify the private `issue-attachments` Storage bucket and policies.
4. Verify `supabase_realtime` publication tables.
5. Configure Supabase Auth Site URL and callback URLs.
6. Configure Vercel public variables plus the server-only service-role, GitHub App, webhook, and cron variables.
7. Configure the GitHub App callback at `/api/github/callback`, read-only permissions for Metadata, Pull requests, Contents, Checks, and Commit statuses, and App webhook events for `pull_request`, `push`, `installation`, `installation_repositories`, `installation_target`, `repository`, `check_run`, `check_suite`, and `status` at `/api/webhooks/github`. Callback verification uses the user-token `GET /user/installations` list; do not implement or configure a nonexistent `/user/installations/{id}` endpoint.
8. Run `qa/live/` against the deployed URL for public routes, OAuth redirect, API scopes/pagination, and webhook signatures.
9. Run the live flow: signup → workspace → project → issue → triage → comments/attachments → planning → GitHub App install → repository binding → verified GitHub link → reports/readiness → logout. The GitHub install/bind/PR-link/merge-resolution segment has been verified; the remaining phases still need broader live coverage.
10. Set `CRON_SECRET`, verify the Vercel cron invokes `/api/github/reconcile` (repository reconciliation plus webhook replay/cleanup), and regenerate database types from the live schema if the deployed schema differs. Migrations 042–045 are required for the current GitHub, issue-update, and membership paths.

Detailed external setup, migration order, reset guidance, Storage, Auth, Realtime, Vercel, GitHub, API token, and end-to-end instructions are in `docs/deployment.md`.

### Vercel Git deployment troubleshooting

The production URL may continue serving an older successful deployment even when GitHub shows a newer commit. Confirm the new commit appears on the connected GitHub repository, then check Vercel project Git settings for the exact repository `ExistedYear/TraceBox`, production branch `main`, Vercel GitHub App access to the repository, an empty ignored-build-step setting, and disabled verified-commit enforcement unless commits are signed. A GitHub Actions `Quality` success is independent of Vercel's deployment check. If no Vercel deployment row is created for a pushed commit, resolve the Git connection before investigating build logs.

## Migration discipline

Never rewrite an applied migration. Add a new timestamped migration for every schema correction. Keep RLS enabled. Keep service-role access server-only. `supabase/full_schema.sql` must be regenerated whenever migration files change.

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
21. Trace Intelligence: deterministic report quality, advisory triage and duplicate explanations, natural-language filter parsing, release-risk briefs, and a permission-filtered blast-radius graph

Database state is represented by migrations `202608260001` through `202608260084`. `supabase/full_schema.sql` is regenerated from all migration files in lexical order. Migration 080 adds the Trace Intelligence boundaries, 081 corrects blast-radius depth, 082 adds public workspaces, 083 makes public joining idempotent without role downgrade, and 084 serializes joins with visibility changes. Supabase records migration versions but does not re-run an applied file after that file is edited.

Completion-plan Phases 2–14 are source-complete: contributor and ownership journeys, honest failure states, full issue creation/editing, realtime queue/detail consistency, notification settings/inbox, project/workflow administration, restricted security controls, advanced queue/saved-view lifecycle, transactional duplicate triage and command workflows, resource/API workflows, analytics/readiness/audit, stable mentions/account management, GitHub operational visibility, and the committed integration/browser verification harness are implemented. Disposable database execution is verified in CI; hosted multi-user/realtime/browser validation remains a distinct external release check.

The submission README contains the product overview, full feature catalog, architecture, live deployment, technology summary, verification boundary, and Trace Intelligence safety model. `docs/last_day_plan.md` remains the retained implementation specification; `docs/last-day-plan-audit.md` records the actual shipped boundary and corrections.

The GitHub integrations settings page uses the command-center layout with connection metrics, Active/Needs attention/History tabs, verified installation health, sanitized project-scoped webhook history, inaccessible/archived repository warnings, repository sync, primary selection, and per-repository automation saves.

## Important runtime configuration

Required local/Vercel variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-or-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
GROQ_API_KEY=<optional-server-only-groq-key>
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

`SUPABASE_SERVICE_ROLE_KEY` is used only in the server-side API/webhook helper. `GROQ_API_KEY` is used only by `src/lib/ai/client.ts`; omitting it leaves deterministic product paths available and hides provider actions. Never expose either through `NEXT_PUBLIC_*`, client bundles, logs, Git, or API responses.

## Verification performed in this checkout

TypeScript:  npm run typecheck — passed
Tests:       226/226 passed across 42 test files
Lint:        0 errors; compatibility warnings only
Build:       npm run build — passed
Migration check: 84 files are contiguous and `supabase/full_schema.sql` is synchronized
Browser smoke: 3 credential-free journeys passed; 10 fixture-dependent journeys skipped explicitly
Database tests: GitHub Actions run 33264345126 passed a fresh 001–079 replay, 231 pgTAP assertions, and true concurrent issue allocation
Database types: `src/types/database.ts` was regenerated from the linked schema after migration 082

Hosted Supabase drift snapshot on 2026-08-30: the linked ledger matched local migrations 001–079 before this release. Migrations 080–084 were then reviewed and applied in order, linked types were regenerated after schema-changing migration 082, the final linked dry run reported no pending migrations, and linked SQL lint returned zero errors. A local schema diff and pgTAP execution could not run on this machine because the current user lacks Docker socket access; the next Docker-enabled CI run must replay 001–084 and execute the intelligence and public-workspace suites. Historical migration edits are never a deployment mechanism; every future deployed-schema correction must use the next forward-only migration.

The hosted GitHub flow was manually verified on 2026-08-28: a private repository was installed, discovered, bound to a project using key `BUG`, and a PR containing `Fixes BUG-1` was linked by webhook and changed the issue to `RESOLVED / FIXED` after merging into `main`. Public deployment probes also returned `200` for `/` and `/login`, `405` for an unsupported webhook `GET`, and `401` for an unsigned webhook `POST`.

The committed `playwright/` suite provides credential-free public/protection smoke plus explicitly gated multi-user journeys. GitHub API/webhook tests use mocked network/auth boundaries and require no GitHub environment files. The older ignored `qa/live/` suite remains optional for deployment-specific probes and must never contribute credentials or artifacts to Git.

Static source audits found and fixed migration syntax, API issue argument ordering and unbounded reads, granular API scopes, token-owner project authorization, tenant catalog leaks, webhook persistence/retry reporting, optional GitHub merge resolution, storage cleanup, role-gated creation/triage actions, report loading, notification races and mutation handling, issue-link validation, serialized typed custom-field updates, account/avatar failure recovery, anonymous-session classification, password recovery, Markdown rendering, theme handling, sidebar layout, and responsive table layout issues. These conclusions came from tracing authorization, query, mutation, cleanup, and failure paths across the source and live schema; the green automated gates are secondary verification rather than the basis of the audit.

The local-only `qa/live/` Playwright suite was added for hosted checks. It is ignored by Git and must be configured separately with disposable API, OAuth, and webhook test credentials. Do not commit its `.env`, browser state, reports, or test-results. Earlier pre-deployment probes found an older deployment; the current public probes and the hosted GitHub PR flow now pass, while the full multi-user/API/browser suite remains outstanding.

Migration 082 was dry-run as the only pending change, applied, and followed by linked type generation. The independent review then fixed repeated-join role downgrade in forward migration 083 and the visibility-change race in forward migration 084. Both are deployed; the final linked dry run is empty and linked SQL lint reports zero errors. The linked project also contains the requested disposable `demo@123.com` account with its own public `tracebox-demo` workspace; these known credentials carry no service-role access.

## Deployment checklist

1. Confirm the linked target is TraceBox project `tvjqgzgpgdpzkhhhrfzr` and compare its migration ledger/schema to the local chain before every push.
2. Confirm the hosted ledger and local chain both end at 084, rerun a linked dry-run and schema lint before future pushes, and regenerate `src/types/database.ts` if the linked contract changes. Never edit an applied migration; use a new forward reconciliation migration for any drift.
3. Verify the private `issue-attachments` Storage bucket and policies.
4. Verify `supabase_realtime` publication tables.
5. Configure Supabase Auth Site URL and callback URLs.
6. Configure Vercel public variables plus the server-only service-role, GitHub App, webhook, and cron variables. Add server-only `GROQ_API_KEY` only after provider data-control review and Zero Data Retention configuration where available.
7. Configure the GitHub App callback at `/api/github/callback`, read-only permissions for Metadata, Pull requests, Contents, Checks, and Commit statuses, and App webhook events for `pull_request`, `push`, `installation`, `installation_repositories`, `installation_target`, `repository`, `check_run`, `check_suite`, and `status` at `/api/webhooks/github`. Callback verification uses the user-token `GET /user/installations` list; do not implement or configure a nonexistent `/user/installations/{id}` endpoint.
8. Run `qa/live/` against the deployed URL for public routes, OAuth redirect, API scopes/pagination, and webhook signatures.
9. Run the live flow: signup → workspace → project → issue → triage → comments/attachments → planning → GitHub App install → repository binding → verified GitHub link → reports/readiness → logout. The GitHub install/bind/PR-link/merge-resolution segment has been verified; the remaining phases still need broader live coverage.
10. Set `CRON_SECRET`, verify the Vercel cron invokes `/api/github/reconcile` (repository reconciliation plus webhook replay/cleanup), and regenerate database types from the live schema if the deployed schema differs. Migrations 042–057 are required for the current GitHub, membership, issue editing, notifications, workflow administration, restricted-security, queue, saved-view, triage, template, custom-field, attachment, and API-token paths.
11. If attachment orphan reconciliation is scheduled, invoke protected `/api/attachments/reconcile` with `CRON_SECRET` from a separately configured scheduler. It is not part of the existing Vercel cron entry.

Detailed external setup, migration order, reset guidance, Storage, Auth, Realtime, Vercel, GitHub, API token, and end-to-end instructions are in `docs/deployment.md`.

### Vercel Git deployment troubleshooting

The production URL may continue serving an older successful deployment even when GitHub shows a newer commit. Confirm the new commit appears on the connected GitHub repository, then check Vercel project Git settings for the exact repository `ExistedYear/TraceBox`, production branch `main`, Vercel GitHub App access to the repository, an empty ignored-build-step setting, and disabled verified-commit enforcement unless commits are signed. A GitHub Actions `Quality` success is independent of Vercel's deployment check. If no Vercel deployment row is created for a pushed commit, resolve the Git connection before investigating build logs.

## Migration discipline

Never rewrite an applied migration. Add a new timestamped migration for every schema correction. Keep RLS enabled. Keep service-role access server-only. `supabase/full_schema.sql` must be regenerated whenever migration files change.

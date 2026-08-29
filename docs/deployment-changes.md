# Deployment Changes and Operator Checklist

This is the short, current operator checklist for the completed TraceBox build. Use [`deployment.md`](deployment.md) for first-time setup details and [`../handoff.md`](../handoff.md) for verification evidence.

## Already applied

- The linked Supabase project `tvjqgzgpgdpzkhhhrfzr` records migrations `202608260001` through `202608260074`.
- The final linked dry-run returned `upToDate: true` with no pending migrations.
- Linked SQL lint returned zero errors.
- `src/types/database.ts` was regenerated from the linked schema after migration 074.
- Migration 065 forward-reconciles the API-token scope constraint that had drifted after an earlier applied migration was edited. Migrations 066–074 contain subsequent forward-only security, performance, runtime, invitation, automation, and GitHub-confidentiality repairs.

Do not edit an applied migration to repair production. Supabase tracks applied versions and will not re-run changed historical files. Compare the linked ledger and live catalog, then add a new forward-only migration.

## Required Vercel variables

Set these in Production and in Preview only when that environment should be functional:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GITHUB_WEBHOOK_SECRET
GITHUB_APP_ID
GITHUB_APP_SLUG
GITHUB_APP_CLIENT_ID
GITHUB_APP_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY
GITHUB_APP_CALLBACK_URL
GITHUB_API_VERSION=2022-11-28
CRON_SECRET
```

Only the first two variables are browser-visible. Never prefix service-role, GitHub, or cron secrets with `NEXT_PUBLIC_`.

## Supabase dashboard checks

- Authentication Site URL points to the production domain.
- Redirect URLs include the production domain and `/auth/callback`; add localhost only for development.
- Email/password recovery is enabled and recovery links return to `/reset-password`.
- GitHub OAuth is configured only if GitHub sign-in is offered. This is separate from the GitHub App repository connection.
- `issue-attachments` is private and limited by the committed Storage policies; `profile-avatars` is public but owner-scoped for writes.
- `issues`, `comments`, `notifications`, and `attachments` remain in the intended Realtime publication.
- Leaked-password protection is enabled in Auth if the project plan supports it; this is a provider setting, not a migration.

## GitHub App checks

- Callback URL: `<production-origin>/api/github/callback`.
- Webhook URL: `<production-origin>/api/webhooks/github`.
- Subscribe to `pull_request`, `push`, `installation`, `installation_repositories`, `installation_target`, `repository`, `check_run`, `check_suite`, and `status`.
- Grant read-only Metadata, Pull requests, Contents, Checks, and Commit statuses permissions.
- Confirm the webhook secret and App private key exist only as server variables.
- Confirm installation, repository sync, project binding, primary repository selection, target-branch automation save, signed webhook receipt, PR linking, and merge resolution.
- Run one failed-delivery retry and one installation/repository lifecycle transition before release. No GitHub environment file is required for the committed automated tests.

## Schedules and protected maintenance routes

- Vercel invokes `/api/github/reconcile` daily at 03:00 UTC with `CRON_SECRET`; it reconciles repositories, replays eligible deliveries, and clears expired payloads.
- `/api/attachments/reconcile` also requires `CRON_SECRET` but is not in the committed Vercel cron. Schedule it separately if automatic orphan cleanup is desired.
- Manual webhook replay and cleanup routes use the same secret.

## Pre-deploy and post-deploy commands

Before a database push:

```bash
npx --yes supabase migration list --linked
npx --yes supabase db push --linked --dry-run
npx --yes supabase db lint --linked --schema public --level error --fail-on error
```

Before a code push:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run check:migrations
npm run test:e2e
```

After deployment, repeat the linked dry-run, probe `/`, `/login`, and anonymous `/dashboard` protection, then run the authenticated and two-user rows in [`feature-testing-checklist.md`](feature-testing-checklist.md). Fixture-gated browser journeys and Docker-backed pgTAP/concurrency tests are not proven by the credential-free smoke run.

## Current external release work

- Complete the hosted two-user membership, invitation, Realtime, restricted-access, attachment, and notification journeys.
- Exercise Auth redirects/recovery with real email delivery.
- Verify the Vercel variables and cron authorization in the deployed environment.
- Record a real failed GitHub delivery retry and lifecycle recovery.
- Run the disposable Supabase pgTAP and concurrent issue-allocation suites where Docker is available.
- Confirm the production deployment is serving the final `main` commit rather than an older successful build.

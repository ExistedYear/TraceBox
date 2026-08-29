# TraceBox

TraceBox is a modern, database-backed developer workspace for structured issue tracking. It now covers Phases 1–20: workspaces/projects, workflow, issue lifecycle, collaboration, planning, notifications, realtime, search, dependencies, triage, attachments, analytics, readiness, templates, restricted security issues, GitHub integration, custom fields, and scoped API access.

## Stack

- Next.js App Router, TypeScript, and Tailwind CSS
- shadcn/ui-style components with Lucide icons
- Supabase PostgreSQL, Auth, Storage, and Realtime-ready configuration
- Zod and React Hook Form for validated authentication forms
- Safe GFM rendering for issue descriptions and comments

## Local setup

1. Install Node.js 22 or newer and the [Supabase CLI](https://supabase.com/docs/guides/cli). Use `npx supabase ...` from the project directory for the CLI commands below.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and add the URL and anon key from Supabase. For the API, GitHub App, webhook, and scheduled reconciliation routes, also add the server-only variables listed in `.env.example`.
4. For local Supabase, run `npm run db:start`, then `npm run db:reset` to apply migrations and seed data.
5. Start the app with `npm run dev`, then open [http://localhost:3000](http://localhost:3000).

Included today: email/password signup, login, logout, session refresh, workspace and project onboarding, hashed workspace/project invitations, explicit contributor roles, ownership transfer, audited project metadata/archive/restore and atomic workflow publishing, atomic issue creation with templates/custom fields/restricted grants and human-readable IDs (`KEY-1`), full conflict-aware issue editing, live duplicate candidate search, an issue queue with advanced filters/sorting/pagination/inline editing/restricted indicators/authorized atomic bulk updates, an audited issue detail page with unified activity timeline, project-member comments, workflow transitions and assignments, labels/versions/milestones, a preference-aware cursor-paginated notification inbox, realtime queue/detail updates with draft-conflict protection, explicit-visibility saved views with stable links and full lifecycle controls, issue links and transactional duplicate resolution, focus-safe triage classification shortcuts, private attachments with signed URLs, a dedicated restricted security queue and access history, reports/MTTR/age analytics, release readiness scoring, a command palette with personal/project/notification/status actions, issue templates, verified GitHub App repository connections, repository-bound PR search and rich development cards with CI summaries, normalized PR/commit artifacts, durable signed webhooks with atomic claim/replay and lifecycle handling, derived automatic-link reconciliation, classified GitHub errors, token caching, explicit primary repositories, an Active/Needs attention/History GitHub operations dashboard with per-repository automation controls, custom fields with issue values, scoped API tokens, and authenticated REST endpoints.

The header palette supports independent accent themes (blue by default, neutral, amber, purple, and emerald) while preserving the light/dark mode and semantic status colors.

The authenticated REST surface, token scopes, examples, and error contract are documented in [`docs/api.md`](docs/api.md). Before release, use [`docs/deployment-changes.md`](docs/deployment-changes.md) for required operator changes and [`docs/feature-testing-checklist.md`](docs/feature-testing-checklist.md) for the submission QA pass.

## Database workflow

Create a migration for every schema change, test it locally, commit it, and apply it to the linked project with `supabase db push`. Regenerate TypeScript types with `npm run db:types` after local schema changes or `npm run db:types:linked` after linking to a hosted project. Do not bypass RLS or make untracked production-only schema changes.

`supabase/migrations/` holds 78 ordered migrations. Migrations 042–064 cover GitHub reliability, completion-plan closure, analytics, collaboration, and operational visibility. Migrations 065–074 are forward-only live-schema reconciliations and invitation/GitHub confidentiality repairs. Migrations 075–078 move public API list/search authorization and bounding into SQL, correct the live search expression forward-only, restrict profile/GitHub catalogs to authorized tenant collaborators, and enforce the token owner's live project membership. Regenerate `supabase/full_schema.sql` after every migration change. Because Supabase does not re-run an applied version when its file changes, compare the linked ledger and live catalog before every push and repair drift with a new migration.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run check:migrations
```

## Deploying

Push this repository to GitHub and connect it to Vercel with the Next.js preset. Configure the Supabase variables, GitHub App variables, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_WEBHOOK_SECRET`, and `CRON_SECRET` as non-public server variables. The GitHub App private key and client secret must never enter client code. See `docs/deployment.md` for the full setup and verification sequence.

Apply all migrations before testing production signup. Configure Supabase Auth URLs, the private `issue-attachments` Storage bucket/policies, the `supabase_realtime` publication, the GitHub App callback/webhook, and Vercel server environment variables before the live end-to-end flow. Vercel invokes `/api/github/reconcile` once daily at 03:00 UTC using `CRON_SECRET`; that job also replays eligible webhook deliveries and clears expired payloads. Failed webhook deliveries stop after eight processing attempts and remain available as metadata for cleanup/diagnostics. Protected `/api/attachments/reconcile` also requires `CRON_SECRET` and must be invoked manually or by a separately scheduled job; it is not included in the existing Vercel cron. The standalone replay and cleanup endpoints use the same secret for manual operations.

GitHub Actions runs migration consistency, lint, typecheck, unit/API/webhook/realtime tests, the production build, disposable-Supabase replay/pgTAP/concurrency checks, and credential-free Playwright smoke on pull requests and pushes to `main`. No GitHub App environment files are required for tests. Vercel's Git integration owns deployments, so no duplicate Vercel deployment workflow or Vercel token is required.

## Live QA

The committed `playwright/` harness runs public/authentication smoke without credentials and exposes explicitly gated multi-user journeys for a seeded deployment. Reports, browser state, and environment files are ignored. GitHub route/webhook coverage is credential-free and does not need GitHub App env files. An older ignored `qa/live/` suite remains optional for deployment-specific probes; never commit its secrets or generated artifacts.

## Verified release paths

As of 2026-08-28, the hosted GitHub App flow has been manually verified with a private repository: installation callback, repository discovery, project binding, signed pull-request webhook delivery, automatic PR linking, and `Fixes <PROJECT_KEY>-<NUMBER>` resolution after merging into `main`. Issue keys use the selected TraceBox project's key (for example, `BUG-1`), not the workspace name. Apply migrations through 078 before using the current application contracts.

The desktop sidebar is viewport-height and scrollable; its Settings and Contributors links remain reachable on short screens or when the workspace switcher is large, and the navigation no longer renders a stray semicolon. Credential-free Playwright smoke is committed and locally verified; fixture-dependent multi-user journeys remain a hosted release check.

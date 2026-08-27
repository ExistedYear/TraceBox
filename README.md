# TraceBox

TraceBox is a modern, database-backed developer workspace for structured issue tracking. It now covers Phases 1–20: workspaces/projects, workflow, issue lifecycle, collaboration, planning, notifications, realtime, search, dependencies, triage, attachments, analytics, readiness, templates, restricted security issues, GitHub integration, custom fields, and scoped API access.

## Stack

- Next.js App Router, TypeScript, and Tailwind CSS
- shadcn/ui-style components with Lucide icons
- Supabase PostgreSQL, Auth, Storage, and Realtime-ready configuration
- Zod and React Hook Form for validated authentication forms
- Safe GFM rendering for issue descriptions and comments

## Local setup

1. Install Node.js 20 or newer and the [Supabase CLI](https://supabase.com/docs/guides/cli). Use `npx supabase ...` from the project directory for the CLI commands below.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and add the URL and anon key from Supabase. For the API, GitHub App, webhook, and scheduled reconciliation routes, also add the server-only variables listed in `.env.example`.
4. For local Supabase, run `npm run db:start`, then `npm run db:reset` to apply migrations and seed data.
5. Start the app with `npm run dev`, then open [http://localhost:3000](http://localhost:3000).

Included today: email/password signup, login, logout, session refresh, workspace and project onboarding, project components and default workflow management, issue creation with human-readable IDs (`KEY-1`), live duplicate candidate search, an issue queue with filters/sorting/pagination/inline field editing, an audited issue detail page with unified activity timeline, project-member comments, workflow transitions and assignments, labels/versions/milestones, watchers/notifications, realtime updates, search/saved views, issue links and duplicate detection, triage and inline classification, private attachments with signed URLs, reports/MTTR/age analytics, release readiness scoring, command palette and keyboard navigation, issue templates, restricted security issues with explicit access, verified GitHub App repository connections, GitHub API link verification, normalized PR/commit artifacts, durable signed webhooks with lifecycle handling and reconciliation, custom fields with issue values, scoped API tokens, and authenticated REST endpoints.

The header palette supports independent accent themes (blue by default, neutral, amber, purple, and emerald) while preserving the light/dark mode and semantic status colors.

## Database workflow

Create a migration for every schema change, test it locally, commit it, and apply it to the linked project with `supabase db push`. Regenerate TypeScript types with `npm run db:types` after local schema changes or `npm run db:types:linked` after linking to a hosted project. Do not bypass RLS or make untracked production-only schema changes.

`supabase/migrations/` holds forty ordered migrations through Phase 20 and the release-validation corrections. These cover the foundational schema/RLS/RPC hardening, collaboration/planning, notifications/realtime, search/saved views, issue links, triage, attachments/storage policies, templates, restricted issue access, GitHub App installations/repositories/artifacts/webhooks, typed custom fields, granular API scopes, and final audit corrections. The consolidated `supabase/full_schema.sql` contains the same 40 migrations in order; run `npm run sync:migrations` after adding a migration.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run check:migrations
```

## Deploying

Push this repository to GitHub and connect it to Vercel with the Next.js preset. Configure the Supabase variables, GitHub App variables, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_WEBHOOK_SECRET`, and `CRON_SECRET` as non-public server variables. The GitHub App private key and client secret must never enter client code. See `deployment.md` for the full setup and verification sequence.

Apply all migrations before testing production signup. Configure Supabase Auth URLs, the private `issue-attachments` Storage bucket/policies, the `supabase_realtime` publication, the GitHub App callback/webhook, and Vercel server environment variables before the live end-to-end flow. Vercel invokes `/api/github/reconcile` once daily at 03:00 UTC using `CRON_SECRET`.

GitHub Actions runs lint, typecheck, unit tests, and the production build on pull requests and pushes to `main`. Vercel's Git integration owns deployments, so no duplicate Vercel deployment workflow or Vercel token is required.

## Live QA

This checkout also has an ignored, local-only black-box suite under `qa/live/` for testing the deployed Vercel boundary, GitHub OAuth redirect, authenticated REST API, and signed GitHub webhooks. It is intentionally excluded from GitHub because it uses disposable credentials and local Playwright reports. See `qa/live/README.md` when working from this checkout.

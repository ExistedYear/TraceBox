# TraceBox

TraceBox is a modern, database-backed developer workspace for structured issue tracking. It proves the Vercel + Supabase path while shipping the first five product phases: workspaces/projects, project workflow, issue creation, issue list/editing, and comments + activity timeline.

## Stack

- Next.js App Router, TypeScript, and Tailwind CSS
- shadcn/ui-style components with Lucide icons
- Supabase PostgreSQL, Auth, Storage, and Realtime-ready configuration
- Zod and React Hook Form for validated authentication forms

## Local setup

1. Install Node.js 20 or newer and the [Supabase CLI](https://supabase.com/docs/guides/cli). Use `npx supabase ...` from the project directory for the CLI commands below.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and add the URL and anon key from Supabase. Keep the service-role key server-only; it is not used by the initial client flow.
4. For local Supabase, run `npm run db:start`, then `npm run db:reset` to apply migrations and seed data.
5. Start the app with `npm run dev`, then open [http://localhost:3000](http://localhost:3000).

Included today: email/password signup, login, logout, session refresh, workspace and project onboarding, project components and default workflow management, issue creation with human-readable IDs (`KEY-1`), an issue queue with filters/sorting/pagination/inline field editing, an audited issue detail page with unified activity timeline, and project-member comments (add/edit with `COMMENT_ADDED`/`COMMENT_EDITED` events, mention + issue-ref styling). GitHub OAuth is wired in the UI but remains disabled until provider credentials are configured in Supabase.

## Database workflow

Create a migration for every schema change, test it locally, commit it, and apply it to the linked project with `supabase db push`. Regenerate TypeScript types with `npm run db:types` after local schema changes or `npm run db:types:linked` after linking to a hosted project. Do not bypass RLS or make untracked production-only schema changes.

`supabase/migrations/` holds twenty-one ordered migrations: profiles (+trigger/RLS), workspaces/projects/memberships with RLS helpers and RPCs, components + default workflow seeding, issues + immutable audit trail with atomic `create_issue`, inline-edit RPC, security hardening, archived-project/component write guards, typed UUID update handling, project-first component mutation RPCs, comments + activity (`comments` table, `can_comment_on_issue`, `add_comment`/`edit_comment`), role/security refinements, create_project fix, Phase 6 workflow transitions & assignment, Phase 7 labels/versions/milestones, Phase 8 watchers/notifications, Phase 10 search/saved views (pg_trgm + tsvector), Phase 11 issue_links, plus deep-audit security fixes and realtime publication.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Deploying

Push this repository to GitHub and connect it to Vercel with the Next.js preset. Vercel will create preview deployments for pull requests and production deployments for pushes to `main`. For the current application, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to Vercel for Production, Preview, and Development as needed. The service-role key is not required by this foundation and must never be exposed to the browser.

Link the Supabase CLI to the production project and run `npx supabase db push` before testing production signup. In Supabase Auth URL Configuration, set the production Site URL to the Vercel production domain and add the exact callback URL `https://<vercel-production-domain>/auth/callback`. Keep `http://localhost:3000/auth/callback` for local development. If GitHub OAuth is enabled, configure the provider in Supabase with the callback URL shown there; never put its secret in Vercel.

GitHub Actions runs lint, typecheck, unit tests, and the production build on pull requests and pushes to `main`. Vercel's Git integration owns deployments, so no duplicate Vercel deployment workflow or Vercel token is required.

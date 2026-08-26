# TraceBox Handoff

## Completed

- Audited the codebase from scratch through Phase 5 covering:
  - Phase 1–5 completeness (Organizations, Projects, Components/Workflow, Issue Creation, Issue Table/Editing, Comments/Activity Timeline)
  - SQL, RLS, lock ordering, and security
  - server data flow, auth, context caching, error mapping
  - client UI, accessibility, form validations, toast feedback
  - configuration, documentation, and unit tests
- Fixed all findings raised before the requested stop.
- Added focused unit tests without over-expanding the suite.
- Updated stale repository documentation.
- Phases 1–5 are implemented:
  1. Organizations + Projects
  2. Components + Default Workflow
  3. Core Issue Creation
  4. Issue List + Editing
  5. Comments + Activity (RPC-only `comments` table, `COMMENT_ADDED`/`COMMENT_EDITED` audit events, unified vertical timeline with mention/issue-ref styling, composer + inline edit)
- Phase 6 — Workflow Transitions — is next.

## Verification

The final local gates passed:

```text
TypeScript       ✓ (0 errors)
Tests            54/54 ✓ (6 test files)
Lint             0 errors
Production build ✓ (Compiled successfully)
git diff --check ✓
```

Lint reports one non-blocking React Compiler compatibility warning from TanStack Table's `useReactTable()` API. It is a library warning, not a project error.

Live Supabase and Vercel runtime verification has not been performed from this checkout.

## Commit state

Latest local commit:

```text
af04b2e feat: phase 5 comments and activity timeline
```

Phase 5 added migration `202608260012_comments_activity.sql`, `src/lib/validation/comment.ts`, `src/components/issues/comments-section.tsx`, updates to `src/lib/issues.ts`, `src/types/database.ts`, `src/app/(dashboard)/dashboard/issues/[issueKey]/page.tsx`, `tests/comments.test.ts`, and updated documentation.

Commit and push when ready (see below).

## Supabase production migration

Fill `.env.local` locally with real values. It is gitignored and must not contain committed secrets.

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase migration list
npx supabase db push
npx supabase migration list
```

The repository contains 12 ordered migrations, `202608260001` through `202608260012`. Inspect the installed CLI options before applying migrations:

```bash
npx supabase db push --help
```

Optional local database verification:

```bash
npm run db:start
npm run db:reset
npm run db:types
npm run typecheck
npm test
npm run build
```

Configure Supabase Auth URL settings:

- Site URL: `https://trace-box.vercel.app`
- Redirect URLs:
  - `https://trace-box.vercel.app/**`
  - `http://localhost:3000/**`
- GitHub callback, if enabled:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Never rewrite an applied migration. Future schema corrections require a new versioned migration. Keep RLS enabled and never expose the service-role key to client code.

## Vercel deployment

1. Push the local commits when ready:

   ```bash
   git push origin main
   ```

2. Import the GitHub repository into Vercel.
3. Use the Next.js preset and retain the build command from `vercel.json`:

   ```bash
   npm run build
   ```

4. Configure these variables for Production, Preview, and Development:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-or-publishable-key>
   ```

5. Never add `SUPABASE_SERVICE_ROLE_KEY` to browser-exposed configuration.
6. Deploy and run the live flow:

   ```text
   landing page
   → signup
   → workspace onboarding
   → first project creation
   → create KEY-1 issue
   → issue filters/sorting/pagination
   → inline field edit
   → issue detail/audit timeline
   → add comment with @mention and TRACE-123 ref
   → edit own comment
   → verify unified activity timeline ordering
   → logout
   → protected dashboard redirects to login
   ```

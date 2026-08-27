# TraceBox Handoff

## Completed

- Audited the codebase from scratch through Phase 11 covering:
  - Phase 1–11 completeness (Organizations, Projects, Components/Workflow, Issue Creation, Issue Table/Editing, Comments/Activity, Assignment/Workflow, Labels/Versions/Milestones, Watchers/Notifications, Realtime, Search/Saved Views, Dependencies/Duplicates)
  - SQL, RLS, lock ordering, realtime publication, and security (deep multi-agent audit with 2 waves, 31+ findings fixed)
  - server data flow, auth, context caching, error mapping, realtime hooks
  - client UI, accessibility, form validations, toast feedback, realtime, search escaping
  - configuration, documentation, and unit tests (13 test suites)
- Fixed all high/critical findings: remove_issue_link authz, find_duplicate_candidates isolation, saved_views RLS, ilike injection, realtime thrash, label XSS, composer stuck spinner, watch button sync, duplicate seq guard, etc.
- Added focused unit tests without over-expanding the suite (87 tests)
- Updated stale repository documentation and applied OLED pitch-black theme
- Phases 1–11 are implemented and verified:
  1. Organizations + Projects
  2. Components + Default Workflow
  3. Core Issue Creation
  4. Issue List + Editing
  5. Comments + Activity
  6. Assignment + Workflow (transition_issue, assign_issue, reopen_issue, resolution)
  7. Labels + Versions + Milestones (planning)
  8. Watchers + Notifications (auto-watch, notification center)
  9. Realtime (useRealtime hooks for comments/issues/notifications)
  10. Search + Saved Views (pg_trgm + tsvector + saved_views)
  11. Dependencies + Duplicates (issue_links + duplicate suggestions)
- Ready for Phase 12 — Triage Inbox

## Verification

The final local gates passed:

```text
TypeScript       ✓ (0 errors)
Tests            88/88 ✓ (13 test files)
Lint             0 errors (2 TanStack/RHF warnings, expected)
Production build ✓ (Compiled successfully)
git diff --check ✓
```

Lint reports non-blocking React Compiler warnings from TanStack Table's `useReactTable()` API (incompatible library). They are library warnings, not project errors.

Live Supabase and Vercel runtime verification has not been performed from this checkout.

## Commit state

Latest local commit:

```text
81de81e feat: implement phases 6-11 with deep audit hardening
```

Includes OLED pitch-black theme, skip project button, realtime hooks, search/saved views, issue links, plus 23 migrations and 88 tests. Deep audit fixed findings across migrations 020-023.

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

The repository contains 23 ordered migrations, `202608260001` through `202608260023`. Inspect the installed CLI options before applying migrations:

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

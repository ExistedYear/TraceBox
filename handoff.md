# TraceBox Handoff

## Completed

- Audited the codebase through Phase 4 using parallel audit waves covering:
  - Phase 1–4 completeness
  - SQL, RLS, and security
  - server data flow
  - client/UI/hooks/accessibility
  - configuration, documentation, and tests
- Fixed all findings raised before the requested stop.
- Added focused unit tests without over-expanding the suite.
- Updated stale repository documentation.
- Phases 1–4 are implemented:
  1. Organizations + Projects
  2. Components + Default Workflow
  3. Core Issue Creation
  4. Issue List + Editing
- Phase 5 — Comments + Activity — is next.

## Verification

The final local gates passed:

```text
TypeScript       ✓
Tests            39/39 ✓
Lint             0 errors
Production build ✓
git diff --check ✓
```

Lint reports one non-blocking React Compiler compatibility warning from TanStack Table's `useReactTable()` API. It is a library warning, not a project error.

Live Supabase and Vercel runtime verification has not been performed from this checkout.

## Commit state

Latest local commit:

```text
7c3715a fix: harden phase four workflows
```

Nothing has been pushed. The working tree was clean after that commit. This handoff file is the only change made after that commit until it is committed.

## Supabase production migration

Fill `.env.local` locally with real values. It is gitignored and must not contain committed secrets.

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase migration list
npx supabase db push
npx supabase migration list
```

The repository contains 11 ordered migrations, `202608260001` through `202608260011`. Inspect the installed CLI options before applying migrations:

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
   → logout
   → protected dashboard redirects to login
   ```

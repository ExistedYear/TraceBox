# TraceBox

TraceBox is a small, deployable foundation for an engineering workspace. It proves the Vercel + Supabase path before product features are added.

## Stack

- Next.js App Router, TypeScript, and Tailwind CSS
- shadcn/ui-style components with Lucide icons
- Supabase PostgreSQL, Auth, Storage, and Realtime-ready configuration
- Zod and React Hook Form for validated authentication forms

## Local setup

1. Install Node.js 20 or newer and the [Supabase CLI](https://supabase.com/docs/guides/cli). On Windows, `scoop install supabase` is a convenient option.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and add the URL and anon key from Supabase. Keep the service-role key server-only; it is not used by the initial client flow.
4. For local Supabase, run `npm run db:start`, then `npm run db:reset` to apply migrations and seed data.
5. Start the app with `npm run dev`, then open [http://localhost:3000](http://localhost:3000).

Email/password signup, login, logout, session refresh, the protected dashboard, and the authenticated profile query are included. GitHub OAuth is wired in the UI but remains disabled until provider credentials are configured in Supabase.

## Database workflow

Create a migration for every schema change, test it locally, commit it, and apply it to the linked project with `supabase db push`. Regenerate TypeScript types with `npm run db:types` after local schema changes or `npm run db:types:linked` after linking to a hosted project. Do not bypass RLS or make untracked production-only schema changes.

The initial migration creates `public.profiles`, timestamps, the new-user profile trigger, RLS, an authenticated read policy, and an owner-only update policy.

## Quality checks

```text
npm run lint
npm run typecheck
npm run build
```

## Deploying

Push this repository to GitHub, import it into Vercel with the Next.js preset, and add the three variables from `.env.example` in the Vercel Project Settings for Development, Preview, and Production. Link the Supabase CLI to the production project and run `supabase db push` before testing production signup. In Supabase Auth URL Configuration, set the production Site URL to the Vercel production domain and add localhost, the production domain, and `https://*.vercel.app/**` as redirect URLs. If GitHub OAuth is enabled, configure the provider in Supabase with the callback URL shown there; never put its secret in Vercel.

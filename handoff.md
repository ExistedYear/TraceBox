# TraceBox Handoff

## Product state

TraceBox is a production-oriented issue tracker built with Next.js 16, Supabase, and PostgreSQL. The current application includes:

- workspace and project administration with roles, invitations, public discovery, ownership transfer, and safe self-service leave;
- project components, labels, versions, milestones, templates, custom fields, and configurable workflows;
- atomic issue creation and editing, queue filters, saved views, bulk updates, triage, duplicate handling, relationships, comments, mentions, watchers, notifications, and Realtime updates;
- private attachments, restricted security issues, explicit access grants, audit history, reports, readiness scoring, and CSV exports;
- scoped REST API tokens and project/issue/comment/milestone/search resources;
- optional Trace Intelligence for report quality, advisory triage, duplicate explanations, natural-language filters, release briefs, and permission-filtered blast radius;
- optional GitHub App repository bindings, pull-request links, checks, and signed webhooks.

The database source of truth is the ordered migration chain `202608260001` through `202608260085`. `supabase/full_schema.sql` is generated from that chain for fresh SQL Editor installs and drift review. Applied migrations are never edited; every schema correction is a new forward-only migration.

## Runtime configuration

Required browser variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-or-publishable-key>
```

Server-only variables:

```env
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
GEMINI_API_KEY=<optional-server-only-gemini-key>
GITHUB_WEBHOOK_SECRET=<server-only-webhook-signing-secret>
GITHUB_APP_ID=<github-app-id>
GITHUB_APP_SLUG=<github-app-slug>
GITHUB_APP_CLIENT_ID=<github-app-client-id>
GITHUB_APP_CLIENT_SECRET=<server-only-github-app-client-secret>
GITHUB_APP_PRIVATE_KEY=<server-only-github-app-private-key>
GITHUB_APP_CALLBACK_URL=<exact-github-app-callback-url>
GITHUB_API_VERSION=2022-11-28
CRON_SECRET=<server-only-maintenance-secret>
```

Never prefix server-only values with `NEXT_PUBLIC_`, commit them, return them from a route, or log them. The optional AI path is advisory and never sends restricted/security issues or their comments, attachments, or integration data to the provider.

## Verification record

- `npm run lint` passes with three known React-compiler compatibility warnings and no errors.
- `npm run typecheck` passes.
- `npm test` passes all 256 Vitest tests.
- `npm run build` passes with the production Webpack build.
- `npm run check:migrations` validates the contiguous migration chain and generated schema.
- Hosted Supabase migration drift was checked before applying migration 085. The self-leave RPC was applied and verified in rollback-only owner/member transactions; linked types were regenerated afterward.
- Deployment `fb60840` is live at [trace-box.vercel.app](https://trace-box.vercel.app/). Fresh authenticated desktop tabs render the core application routes without React hydration or stream errors.
- A two-account desktop pass covered onboarding, shared workspace/project access, issue creation and editing, planning, collaboration, restricted issue isolation, Trace Intelligence, queue filters, saved views, account settings, and route-level navigation.

The hosted demo account remains the intentionally public `demo@123.com` / `demo123` ordinary user. It has no service-role access and must never be used for sensitive data or repository access. `scripts/remove-demo-account.sql` is an exact-target cleanup transaction that ends in `ROLLBACK` until deliberately armed.

## Deployment discipline

1. Link the intended Supabase project and inspect its migration ledger and live catalog.
2. Run `npx supabase migration list --linked`, `npx supabase db push --linked --dry-run`, and `npx supabase db lint --linked --level error` before a hosted push.
3. Apply only new forward migrations with `npx supabase db push --linked`.
4. Regenerate `src/types/database.ts` with `npm run db:types:linked` after schema changes.
5. Regenerate `supabase/full_schema.sql` with `npm run sync:migrations` and run the release gates in the README.
6. Keep Supabase Auth redirect URLs, Storage policies, Realtime publication, Vercel variables, and scheduled maintenance routes aligned with `docs/deployment.md`.

## Documentation map

- [README](README.md): product overview, setup, architecture, and commands.
- [Deployment guide](docs/deployment.md): Supabase, Auth, Storage, Realtime, Vercel, API, and optional integrations.
- [REST API](docs/api.md): bearer-token scopes, routes, request shapes, and safe errors.
- [Schema decisions](docs/schema-decisions.md): durable data-model choices.
- [Feature reference](docs/feature-testing-checklist.md): supported product behaviors by area.
- [Security policy](SECURITY.md): private vulnerability reporting and security boundaries.
- [Bug register](docs/bugs.md): resolved production defects and their fixes.

Historical plans and release records remain in `docs/archive/` and are not operational instructions.

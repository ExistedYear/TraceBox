# Repository Guidelines

## Project Overview

TraceBox — a developer-focused bug/issue tracking platform (Bugzilla-inspired), through **Phase 4 of `docs/tracebox-main-plan.md`**: workspaces + projects with cookie-backed switchers, project components, a seeded default workflow, issue creation with atomic KEY-N allocation and an immutable audit trail, and a dense TanStack issue table (filters/sorting/pagination/inline editing). Auth is email/password + GitHub OAuth; every mutation goes through trusted SQL RPCs guarded by RLS. Remaining fixture-free goal: the marketing landing page still shows illustrative product imagery. Product roadmap lives in `docs/tracebox-main-plan.md` (Phase 1 = Organizations + Projects).

## Architecture & Data Flow

Next.js 16 App Router + Supabase (Auth, Postgres). The database is the source of truth; RLS must stay enabled.

```
Browser ──► src/proxy.ts (Next 16's renamed middleware)
              └─► updateSession() in src/lib/supabase/middleware.ts
                    • refreshes Supabase auth cookies onto request AND response
                    • /dashboard/* without user → redirect /login?next=<path>
                    • user on /login or /signup → redirect /dashboard
Server Components ──► createClient() from src/lib/supabase/server.ts
                        (per-request, bound to next/headers cookies())
Client Components ──► createClient() from src/lib/supabase/client.ts
                        (module-level memoized singleton)
OAuth/email links ──► GET src/app/auth/callback/route.ts
                        (exchangeCodeForSession, then redirect to sanitized ?next)
```

Three-tier Supabase client layer, all typed `<Database>` from `src/types/database.ts`. Server-side `setAll` failures are intentionally swallowed — the proxy refreshes cookies. No admin/service-role client exists (deliberate; keep it that way unless server-only).

State management: local `useState`/`useMemo` + react-hook-form with `zodResolver`. No Redux/Zustand/React Query. Navigation state travels via searchParams (`?next`).

## Key Directories

```
src/app/
  (auth)/login|signup/     auth pages; Suspense-wrap AuthForm (it uses useSearchParams)
  (dashboard)/             protected shell: auth check, profile fetch, workspace/project
                           resolution from tb_org/tb_project cookies (redirects to
                           /onboarding when the user has no workspace)
  onboarding/              two-step create-workspace → create-first-project flow;
                           ?create=1 bypasses the has-orgs redirect for extra workspaces
  auth/callback/route.ts   OAuth/email code exchange handler
src/components/
  ui/                      stock shadcn/ui (default style, cva, Radix, forwardRef/asChild)
  layout/                  app chrome: app-header, app-sidebar, user-menu,
                           workspace-switcher (org/project dropdowns + new-project dialog),
                           theme-toggle
  auth/auth-form.tsx       dual-mode ('use client') login/signup form
  tracebox/                brand marks (trace-mark), dashboard overview, primitives kit
  issues/                  new-issue-form, issue-table (TanStack v8 client table)
  settings/project-settings.tsx   components manager + workflow viewer tabs
src/lib/
  supabase/{client,server,middleware}.ts   three-tier clients
  validation/auth.ts       zod schemas + inferred LoginValues/SignupValues
  validation/workspace.ts  workspaceSchema (name+slug) / projectSchema (name+KEY+description)
  validation/issue.ts      issueCreateSchema (title/type/component + advanced fields)
  validation/components.ts componentSchema
  issues.ts                KEY format/parse, event timeline copy, category pills, filter codecs
  workspace-context.ts     server helper resolving cookie-backed org/project context
  server-people.ts         server-only profile display-name maps
  utils.ts                 cn(), getSafeRedirectPath (open-redirect guard), slugify()
  errors.ts                getSafeAuthErrorMessage + getSafeWorkspaceErrorMessage
                           (maps 23505 duplicate-key and NOT_ORG_ADMIN RPC errors)
  types/database.ts        generated DB types incl. RPC function signatures
supabase/                  config.toml, migrations/ (7 applied), seed.sql (intentionally empty)
tests/                     vitest unit tests (vitest.config.ts wires @ → src)
.github/workflows/ci.yml   quality gate
docs/                      plan.md (foundation plan), tracebox-main-plan.md (roadmap)
```

## Development Commands

```bash
npm install

npm run dev          # next dev --turbopack
npm run build        # next build --webpack  (note: dev=Turbopack, prod=Webpack, deliberate)
npm start            # serves production build
npm run lint         # eslint .
npm run typecheck    # tsc --noEmit
npm test             # vitest run (no watch script)

# Local Supabase (requires Supabase CLI)
npm run db:start / db:stop / db:reset      # reset applies migrations + seed
npm run db:types          # regenerate src/types/database.ts from local DB
npm run db:types:linked   # …from linked hosted project
```

Builds work without real credentials; CI sets placeholder env vars. Runtime throws only when Supabase clients are actually invoked without them.

## UI Reference Design

All new UI follows `info/trace-box-geist-command-center/` **wherever possible**; where the stacks diverge, reproduce its *design language* rather than copying code:

- Transfer directly: dense information layout, compact controls (`h-8` buttons, small inputs), `rounded-[10px]` bordered surfaces (`Surface` primitive), font-mono uppercase eyebrows with wide tracking, status-dot + tinted pill system (blue/violet/red/emerald/zinc/amber), vertical trace-line timelines, bordered cards with `/70–80` border opacity, minimal color noise on neutral backgrounds.
- Translate, don't paste: the reference runs Tailwind v4 with OKLCH tokens; this repo is Tailwind v3 with HSL CSS variables (`src/app/globals.css`). Map intent (e.g. `--amber`, `--console`) onto existing Tailwind palette utilities (`amber-500/25` borders, `bg-card`, etc.).
- Reuse before creating: `src/components/tracebox/primitives.tsx` (`SectionHeading`, `StatusPill`, `MetricCard`, `Surface`, `TraceLine`, `Avatar`, `EmptyState`) already mirrors the reference — extend it instead of adding parallel kits.

## AGENTS.md Maintenance

At the end of **every run/session that changes the repository**, update this file: record new modules, commands, conventions, migrations, or architectural decisions so it always reflects the actual codebase. Keep entries concise and factual; prune anything made obsolete by the change.

## Code Conventions & Common Patterns

- **Imports**: react/node builtins → `next/*` → third-party (lucide, react-hook-form, sonner…) → blank line → `@/lib/*` → `@/components/*`; `globals.css` last.
- **Alias**: `@/*` → `./src/*`.
- **Files**: kebab-case, named function exports matching the filename (`export function AppSidebar()` in `app-sidebar.tsx`). Pages export `const metadata: Metadata`.
- **Server/client split**: pages/layouts stay async server components calling Supabase directly (`await createClient(); supabase.from("profiles")…maybeSingle()`). `'use client'` only on interactive leaves. Dynamic params are awaited as `Promise<{id: string}>` (Next 16 idiom).
- **JSX style**: most components compress elements onto single long lines; multiline JSX appears only in newer files (root layout, primitives, dashboard-overview). Match the surrounding file.
- **Forms**: zod schema in `src/lib/validation/`, inferred type export, `useForm<T>({ resolver: zodResolver(schema) })`.
- **Errors**: log server-side as structured objects — `console.error("msg", { code, message })`; never surface raw Supabase/DB text. Map through `getSafeAuthErrorMessage` and show via sonner `toast.error`. Redirect targets always pass through `getSafeRedirectPath` (control chars rejected).
- **UI**: shadcn/ui default style + Lucide icons + Tailwind HSL CSS-variable tokens (`darkMode: ["class"]`; root html is dark by default). Add primitives with the shadcn CLI, configured by `components.json` (aliases `@/components`, `@/components/ui`, `@/lib/utils`).
- **Repo laws** (enforced by both plans in `docs/`): every schema change ships as a versioned migration (`supabase/migrations/YYYYMMDDNNNN_name.sql`) — never dashboard-only changes; never disable RLS; never expose service-role keys to client bundles; no fake navigation/pages for unimplemented features.
- **Mutations go through SQL RPCs**: trusted `security definer` functions in migrations (`create_organization`, `create_project`) own transactional writes incl. membership rows; clients call `supabase.rpc(...)` via the browser client. Direct client inserts into membership tables are blocked by missing INSERT policies — keep it that way.
- **Active workspace/project selection** lives in `tb_org`/`tb_project` cookies written by the switcher; the dashboard layout re-validates them against real memberships server-side before use.
- **DB types are generated**: edit schema via migration, then `npm run db:types`; do not hand-edit `src/types/database.ts`.

## Important Files

| Path | Role |
|---|---|
| `src/proxy.ts` | Request boundary entry (delegates to `updateSession`) |
| `src/lib/supabase/middleware.ts` | Session refresh + route protection logic |
| `src/lib/supabase/server.ts` / `client.ts` | Server / browser Supabase clients |
| `src/types/database.ts` | Generated `Database` type consumed by every client |
| `src/app/(dashboard)/layout.tsx` | Auth gate + profile fetch + shell composition |
| `src/app/auth/callback/route.ts` | Code-for-session exchange |
| `src/components/auth/auth-form.tsx` | All credential/OAuth flows |
| `supabase/migrations/202608260001_initial_profiles.sql` | profiles table, triggers, RLS policies |
| `supabase/migrations/202608260002_create_organizations_projects.sql` | orgs/members/projects tables, RLS helpers (`is_org_member`, `is_org_admin`, `is_project_member`, `can_manage_project`), owner/admin policies, `create_organization`/`create_project` RPCs |
| `supabase/migrations/202608260003_create_components_workflow.sql` | components + workflow_states/workflow_transitions; `create_project` seeds the 7-state default workflow and transitions |
| `supabase/migrations/202608260004_create_issues.sql` | issues + immutable issue_events; atomic `create_issue` (counter lock, ISSUE_CREATED event); `project_role`, `can_view_issue`; Reporter+ insert policy |
| `supabase/migrations/202608260005_update_issue_fields.sql` | `update_issue_fields` RPC — Developer/Maintainer inline edits with per-field audit events |
| `supabase/migrations/202608260006_security_hardening.sql` | audit hardening: issues INSERT policy dropped (RPC-only creation), owner/created-by/reporter FKs RESTRICT, column-scoped UPDATE grants on orgs/projects, org-aware `project_role`, owner-honoring `is_org_admin`, FOR UPDATE audit reads, duplicate index dropped |
| `supabase/migrations/202608260007_archived_guards_audit.sql` | archived projects reject create/edit RPCs; archived components rejected on edit; assignee eligibility honors org admins; `handle_new_user` clamps display names; component client-DELETE policy retired (archive-only) |
| `src/components/layout/workspace-switcher.tsx` | Workspace/project context switching + project creation dialog |
| `.env.example` | Required vars (see below) |
| `README.md` | Setup/deploy runbook |

Env contract: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser-safe), `SUPABASE_SERVICE_ROLE_KEY` (server-only, unused today). `.env*` is gitignored except `.env.example`.

## Runtime/Tooling Preferences

- **Node ≥ 20.9** (`engines`); **npm** with committed `package-lock.json`; CI runs `npm ci` on Node 20.
- TypeScript `strict`, target ES2017, moduleResolution `bundler`, isolatedModules.
- ESLint 9 flat config re-exporting `eslint-config-next/core-web-vitals` — no custom rules; keep it that way unless required.
- Tailwind v3 (not v4): content globs cover `src/{app,components,pages}`.
- **TanStack Table is pinned to v8** (`^8.21.3`); v9 renamed the API (`ReactTable`, `createCoreRowModel`) and will not typecheck against `useReactTable`. Column defs must be *inferred* from `createColumnHelper` — explicit `ColumnDef<T>[]` annotations break variance.
- Deploy: Vercel (`vercel.json` pins framework + `npm run build`); GitHub Actions runs the same four gates on PRs and pushes to `main` — keep them green before yielding.

## Testing & QA

- **Vitest 4**, run-only: `npm test` (equivalent to `vitest run`).
- Tests live in `tests/*.test.ts`; `vitest.config.ts` wires the `@` alias to `src` and a node environment. Relative imports also work.
- Current scope: pure functions — zod schemas (`auth-validation`, `workspace-validation`, `components-validation`, `issues`), `slugify`, redirect sanitizer + error-message mapping (`utils`), issue-key/event/filter helpers (`issues`).
- Pre-yield checklist: `npm run lint && npm run typecheck && npm test && npm run build`.
- E2E (Playwright) and pgTAP database tests are planned but do not exist yet; don't invent harnesses without need.

# Repository Guidelines

## Project Overview

TraceBox — a developer-focused bug/issue tracking platform (Bugzilla-inspired), through **Phase 5 of `docs/tracebox-main-plan.md`**: workspaces + projects with cookie-backed switchers, project components, a seeded default workflow, issue creation with atomic KEY-N allocation and an immutable audit trail, a dense TanStack issue table (filters/sorting/pagination/inline editing), and **comments + unified activity timeline** (RPC-only `comments` table, `COMMENT_ADDED`/`COMMENT_EDITED` audit events, merged chronological timeline with mention/issue-ref styling). Auth is email/password + GitHub OAuth; every mutation goes through trusted SQL RPCs guarded by RLS. The marketing landing page remains illustrative; all authenticated product routes are database-backed. Product roadmap lives in `docs/tracebox-main-plan.md` (Phase 6 = Workflow Transitions is next).

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
  dashboard/issues/[issueKey]/  issue detail with description + unified activity (events+comments)
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
  issues/                  new-issue-form, issue-table (TanStack v8 client table),
                           comments-section (unified timeline + composer + inline edit)
  settings/project-settings.tsx   components manager + workflow viewer tabs
src/lib/
  supabase/{client,server,middleware}.ts   three-tier clients
  validation/auth.ts       zod schemas + inferred LoginValues/SignupValues
  validation/workspace.ts  workspaceSchema (name+slug) / projectSchema (name+KEY+description)
  validation/issue.ts      issueCreateSchema (title/type/component + advanced fields)
  validation/components.ts componentSchema
  validation/comment.ts    commentSchema (body 1–10k chars)
  issues.ts                KEY format/parse, event timeline copy, category pills, filter codecs,
                           plus comment timeline helpers (excerptBody, tokenizeCommentBody,
                           buildTimeline, unified entry types)
  workspace-context.ts     server helper resolving cookie-backed org/project context
  server-people.ts         server-only profile display-name maps
  utils.ts                 cn(), getSafeRedirectPath (open-redirect guard), slugify()
  errors.ts                getSafeAuthErrorMessage + getSafeWorkspaceErrorMessage
                           (maps 23505 duplicate-key and NOT_ORG_ADMIN RPC errors)
supabase/                  config.toml, migrations/ (14 applied), seed.sql (intentionally empty)
tests/                     vitest unit tests (vitest.config.ts wires @ → src)
.github/workflows/ci.yml   quality gate
docs/                      plan.md (foundation plan), tracebox-main-plan.md (roadmap)
handoff.md                 current implementation status, verification, and Supabase/Vercel deployment handoff
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
- Reuse before creating: `src/components/tracebox/primitives.tsx` currently provides `Surface` and `EmptyState`; extend it instead of adding parallel kits.

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
- **Issue components**: `component_id` is optional when a project has no components yet; the RPC accepts null and the form exposes `None`. When a component is selected, its configured default assignee is preselected if the user has not chosen one.
- **Comments**: `comments` table is RPC-only (`add_comment`/`edit_comment`); `select` is allowed for project members via `is_project_member(issue.project_id)`. Reporter+ may add (`can_comment_on_issue`), author or Developer/Maintainer may edit; project-archived guard and 1–10k body validation are enforced server-side. Every add/edit writes `COMMENT_ADDED`/`COMMENT_EDITED` to `issue_events` and bumps `issues.updated_at`.
- **Mutations go through SQL RPCs**: trusted `security definer` functions in migrations (`create_organization`, `create_project`, `create_component`, `update_component`, `create_issue`, `update_issue_fields`, `add_comment`, `edit_comment`) own privileged/transactional writes; clients call `supabase.rpc(...)` via the browser client. Direct client inserts/updates for memberships, issues, components, and comments are blocked by RLS/grants — keep it that way.
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
| `supabase/migrations/202608260008_write_guard_refinements.sql` | race-free project archive checks, candidate-scoped assignees, component column grants, component-assignment trigger, no-op-safe archived component handling |
| `supabase/migrations/202608260009_finalize_component_guards.sql` | RPC-only organization creation; project-row lock in component trigger |
| `supabase/migrations/202608260010_normalize_issue_updates.sql` | typed UUID comparisons and canonical audit values for inline issue edits |
| `supabase/migrations/202608260011_component_mutation_rpcs.sql` | component create/update RPCs with project-first locking; direct component INSERT/UPDATE policies removed |
| `supabase/migrations/202608260012_comments_activity.sql` | `comments` table, `can_comment_on_issue`, RPC-only `add_comment`/`edit_comment` (archived-project guard, Reporter+ add / author-or-Developer edit, 1–10k validation), `COMMENT_ADDED`/`COMMENT_EDITED` audit + `updated_at` bump, project-member RLS |
| `supabase/migrations/202608260013_security_role_refinements.sql` | `project_role` Org Admin precedence, author self-edit REPORTER+ check, title/name trimming, background trigger context bypass |
| `supabase/migrations/202608260014_fix_create_project_values.sql` | `create_project` fix adding `v_user` (`created_by`) to resolve PostgreSQL syntax error 42601 |
| `src/components/issues/comments-section.tsx` | Unified activity timeline (vertical trace line, dots) merging `issue_events` + `comments`; composer with `commentSchema` + `add_comment`; inline edit via `edit_comment`; mention/issue-ref token styling |
| `src/lib/validation/comment.ts` | `commentSchema` (body 1–10k chars) |
| `src/components/layout/workspace-switcher.tsx` | Workspace/project context switching + project creation dialog |
| `.env.example` | Required vars (see below) |
| `README.md` | Setup/deploy runbook |

Env contract: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser-safe), `SUPABASE_SERVICE_ROLE_KEY` (server-only, unused today). `.env*` is gitignored except `.env.example`.

## Runtime/Tooling Preferences

- **Node ≥ 20.9** (`engines`); **npm** with committed `package-lock.json`; CI runs `npm ci` on Node 20.
- TypeScript `strict`, target ES2017, moduleResolution `bundler`, isolatedModules.
- ESLint 9 flat config re-exporting `eslint-config-next/core-web-vitals` — no custom rules; keep it that way unless required.
- Tailwind v3 (not v4): content globs cover `src/{app,components}`.
- **TanStack Table is pinned to v8** (`^8.21.3`); v9 renamed the API (`ReactTable`, `createCoreRowModel`) and will not typecheck against `useReactTable`. Column defs must be *inferred* from `createColumnHelper` — explicit `ColumnDef<T>[]` annotations break variance.
- Deploy: Vercel (`vercel.json` pins framework + `npm run build`); GitHub Actions runs the same four gates on PRs and pushes to `main` — keep them green before yielding.

## Testing & QA

- **Vitest 4**, run-only: `npm test` (equivalent to `vitest run`).
- Tests live in `tests/*.test.ts`; `vitest.config.ts` wires the `@` alias to `src` and a node environment. Relative imports also work.
- Current scope: pure functions — zod schemas (`auth-validation`, `workspace-validation`, `components-validation`, `issues`, `comment`), `slugify`, redirect sanitizer + error-message mapping (`utils`), issue-key/event/filter helpers (`issues`), comment helpers (`tokenizeCommentBody`, `buildTimeline`, `excerptBody`, `COMMENT_ADDED/EDITED` summaries).
- Pre-yield checklist: `npm run lint && npm run typecheck && npm test && npm run build`.
- E2E (Playwright) and pgTAP database tests are planned but do not exist yet; don't invent harnesses without need.

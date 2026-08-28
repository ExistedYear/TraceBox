# Repository Guidelines

## Project Overview

TraceBox — a developer-focused bug/issue tracking platform (Bugzilla-inspired), through **Phase 20 of `docs/tracebox-main-plan.md`**: workspaces + projects with cookie-backed switchers, project components, a seeded default workflow, issue creation with atomic KEY-N allocation and an immutable audit trail, a dense TanStack issue table (filters/sorting/pagination/inline editing), **comments + unified activity timeline** (RPC-only `comments` table, `COMMENT_ADDED`/`COMMENT_EDITED` audit events, merged chronological timeline with mention/issue-ref styling), **workflow transitions & assignments** (resolution modal, reopen), **planning metadata** (labels, versions, milestones), **watchers & notification center**, **realtime subscriptions**, **search & saved views** (pg_trgm + tsvector), **issue links & duplicate detection**, **triage inbox** (J/K/A/R/D keyboard flow), **file attachments** (50MB storage + image lightboxes), **reports & velocity analytics** (MTTR, age distribution), **release readiness engine** (explainable 0-100% score), **advanced command palette & global shortcuts**, **issue templates**, **restricted security issues** (issue_access RLS), **GitHub App integration & PR links**, and **custom fields + public REST API** with scoped tokens.

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

Three-tier Supabase client layer, all typed `<Database>` from `src/types/database.ts`. Server-side `setAll` failures are intentionally swallowed — the proxy refreshes cookies. Server-only `src/lib/api-auth.ts` uses the service-role key for bearer-token API/webhook routes; it is never imported by client code.

State management: local `useState`/`useMemo` + react-hook-form with `zodResolver`. No Redux/Zustand/React Query. Navigation state travels via searchParams (`?next`).

## Key Directories

```
src/app/
  (auth)/login|signup/     auth pages; Suspense-wrap AuthForm (it uses useSearchParams)
  (dashboard)/             protected shell: auth check, profile fetch, workspace/project
                           resolution from tb_org/tb_project cookies (redirects to
                           /onboarding when the user has no workspace)
  dashboard/issues/[issueKey]/  issue detail with description + unified activity (events+comments)
  dashboard/settings/members|contributors/  workspace and project access management
  invite/[token]/          authenticated invitation acceptance with safe terminal states
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
  settings/*members-manager.tsx   invitation, role, removal, and ownership workflows
src/lib/
  supabase/{client,server,middleware}.ts   three-tier clients
  validation/auth.ts       zod schemas + inferred LoginValues/SignupValues
  validation/workspace.ts  workspaceSchema (name+slug) / projectSchema (name+KEY+description)
  validation/issue.ts      issueCreateSchema (title/type/component + advanced fields)
  validation/issue-update.ts shared browser/REST issue mutation contract
  validation/components.ts componentSchema
  validation/comment.ts    commentSchema (body 1–10k chars)
  issues.ts                KEY format/parse, event timeline copy, category pills, filter codecs,
                           plus comment timeline helpers (excerptBody, tokenizeCommentBody,
                           buildTimeline, unified entry types)
  workspace-context.ts     server helper resolving cookie-backed org/project context
  server-people.ts         server-only profile display-name maps
  utils.ts                 cn(), getSafeRedirectPath (open-redirect guard), slugify()
  api-scopes.ts            canonical persisted API scopes and UI token presets
  errors.ts                getSafeAuthErrorMessage + getSafeWorkspaceErrorMessage
                           (maps 23505 duplicate-key and NOT_ORG_ADMIN RPC errors)
supabase/                  config.toml, migrations/ (43 ordered; 042–043 need hosted application), seed.sql (intentionally empty)
tests/                     vitest unit tests (vitest.config.ts wires @ → src)
.github/workflows/ci.yml   quality gate
docs/                      plan.md (foundation plan), tracebox-main-plan.md (roadmap)
handoff.md                 current implementation status, verification, and Supabase/Vercel deployment handoff
docs/incomplete.md         current whole-codebase UI/backend/test/plan gap audit and prioritized follow-up work
docs/completion_plan.md    dependency-ordered closure plan for both incomplete-feature audits; re-audit before implementing to avoid duplicating completed work
docs/bugs.md               release validation log and pending product requests, including Contributors panel
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
npm run check:migrations # contiguous chain + full_schema sync
npm run sync:migrations  # regenerate full_schema.sql from ordered migrations

# Local Supabase (requires Supabase CLI)
npm run db:start / db:stop / db:reset      # reset applies migrations + seed
npm run db:types          # regenerate src/types/database.ts from local DB
npm run db:types:linked   # regenerate from linked hosted project
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
- **Theme**: light/dark mode and accent are independent. Blue is the default accent; neutral, amber, purple, and emerald are selected from the header palette and persisted in `tracebox-accent`. Accent variants override only `--primary`, `--primary-foreground`, and `--ring` through `html[data-accent]`.
- **Narrow side-rail forms**: GitHub-link and linked-issue forms use explicit field labels and full-width stacked controls so their inputs remain understandable inside the issue-detail facts rail.
- **Collapsed desktop navigation**: the collapsed 72px sidebar renders `TraceLogo compact` and keeps the expand chevron inside the available width; do not use the full wordmark in that state.
- **Sidebar layout**: the desktop rail is sticky and viewport-height; its content scrolls vertically so the Settings link remains reachable when the workspace switcher or navigation exceeds the viewport. Keep JSX text nodes free of stray punctuation.
- **Issue components**: `component_id` is optional when a project has no components yet; the RPC accepts null and the form exposes `None`. When a component is selected, its configured default assignee is preselected if the user has not chosen one.
- **Comments**: `comments` table is RPC-only (`add_comment`/`edit_comment`); `select` is allowed for project members via `is_project_member(issue.project_id)`. Reporter+ may add (`can_comment_on_issue`), author or Developer/Maintainer may edit; project-archived guard and 1–10k body validation are enforced server-side. Every add/edit writes `COMMENT_ADDED`/`COMMENT_EDITED` to `issue_events` and bumps `issues.updated_at`.
- **Mutations go through SQL RPCs**: trusted `security definer` functions in migrations (`create_organization`, `create_project`, component/issue/comment mutations, and membership/invitation/ownership mutations) own privileged/transactional writes; clients call `supabase.rpc(...)` via the browser client. Direct client writes for memberships, invitations, issues, components, comments, and audit history are blocked by RLS/grants — keep it that way.
- **Membership access**: ordinary workspace membership does not imply future project access. `is_project_member` requires an explicit `project_members` row, while organization owners/admins retain workspace-wide access. Migration 043 backfills existing ordinary members into existing projects before enforcing this rule. Project removal also clears restricted grants, watchers, and notifications; workspace removal additionally revokes organization API tokens.
- **Invitations**: raw invitation tokens are returned once and stored only as SHA-256 hashes with seven-day expiry. Acceptance is bound to the authenticated email. Organization owners/admins manage workspace invitations; project maintainers may issue and observe project-scoped MEMBER invitations within their project.
- **Active workspace/project selection** lives in `tb_org`/`tb_project` cookies written by the switcher; the dashboard layout re-validates them against real memberships server-side before use.
- **DB types are generated**: edit schema via migration, then `npm run db:types`; do not hand-edit `src/types/database.ts`.
- **GitHub App**: GitHub login remains identity-only. Repository access requires a separately verified GitHub App installation; callback state is signed and bound to the TraceBox user, organization, and project. Installation tokens and App private keys stay server-only.
- **GitHub installation verification**: verify callback installation IDs by paginating the user-token `GET /user/installations` endpoint; GitHub does not provide `GET /user/installations/{id}`.
- **GitHub repository model**: use stable GitHub IDs for installations, repositories, and normalized PR/commit artifacts. Projects may bind multiple repositories; `main` is the default auto-resolution branch and branch matching is explicit.
- **GitHub webhooks**: verify the raw body with HMAC before parsing, persist `X-GitHub-Delivery` for idempotency, process lifecycle events, and retain historical TraceBox links when GitHub access is removed. Log structured Supabase RPC failures server-side while keeping webhook responses generic. Never send restricted issue metadata back to GitHub.
- **Service-role SQL guards**: use `is_service_role_request()` for compatibility with PostgREST JSON claims, legacy per-claim GUCs, and opaque Supabase secret keys; RPC execute grants remain the authorization boundary.

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
| `supabase/migrations/202608260015_phase6_assignment_workflow.sql` | Phase 6: `can_transition_issue`, `transition_issue` (workflow validation, resolution, reopen), `assign_issue`, `reopen_issue` with top-down locking |
| `supabase/migrations/202608260016_phase7_labels_versions_milestones.sql` | Phase 7: `labels`, `issue_labels`, `versions`, `milestones`, `affected_version_id`/`target_milestone_id` on issues, 9 planning RPCs |
| `supabase/migrations/202608260017_phase8_watchers_notifications.sql` | Phase 8: `issue_watchers`, `notifications`, `notification_preferences`, auto-watch via triggers, `toggle_watch_issue`/`watch_issue`/`unwatch_issue`, notification center |
| `supabase/migrations/202608260018_phase10_search_saved_views.sql` | Phase 10: `saved_views`, `pg_trgm` + `tsvector` indexes, search & saved view RPCs |
| `supabase/migrations/202608260019_phase11_issue_links.sql` | Phase 11: `issue_links` (BLOCKS/DEPENDS_ON/DUPLICATE_OF etc.), `add_issue_link`/`remove_issue_link`/`find_duplicate_candidates` |
| `supabase/migrations/202608260020_security_audit_fixes.sql` | Deep audit fixes: `remove_issue_link` authz, `find_duplicate_candidates` isolation, `saved_views` RLS, project locks, duplicate handling |
| `supabase/migrations/202608260021_label_realtime_fixes.sql` | Label hex constraint + `supabase_realtime` publication for comments/issues/notifications |
| `supabase/migrations/202608260022_audit_refinements.sql` | `create_organization` input trimming/profile preflight, notification preferences check, VIEWER transition support, saved view search_path |
| `supabase/migrations/202608260023_transition_viewer_role_fix.sql` | `transition_issue` role check alignment supporting `VIEWER` required roles |
| `supabase/migrations/202608260024_deep_audit_hardening.sql` | Full audit hardening: revoke dispatcher execute, foreign key indexes, unwatch authz, unlink audit logging |
| `supabase/migrations/202608260025_phase13_attachments.sql` | Phase 13: `attachments` table, 50MB storage bucket, `add_attachment`/`delete_attachment` RPCs, realtime publication |
| `supabase/migrations/202608260026_phase17_issue_templates.sql` | Phase 17: `issue_templates` table, `create_issue_template`/`update_issue_template`/`delete_issue_template` RPCs |
| `supabase/migrations/202608260027_phase18_restricted_issues.sql` | Phase 18: `issue_access` table, `can_view_issue` security definer helper, restricted visibility RLS across issues/comments/attachments |
| `supabase/migrations/202608260028_phase19_github_integration.sql` | Phase 19: `issue_github_links`, `project_integrations`, PR/commit linking RPCs |
| `supabase/migrations/202608260029_phase20_custom_fields_api.sql` | Phase 20: `custom_fields`, `issue_custom_values`, `api_tokens`, token management RPCs |
| `supabase/migrations/202608260030_comprehensive_audit_fixes.sql` | Visibility normalization, custom-field project checks, restricted metadata RLS, realtime replica identity |
| `supabase/migrations/202608260031_api_storage_hardening.sql` | Private attachment bucket/policies, API token wrappers, storage path validation |
| `supabase/migrations/202608260032_restricted_access_audit.sql` | Issue-owned mutation triggers and exact restricted child-table policy replacements |
| `supabase/migrations/202608260033_github_webhooks.sql` | Service-role-only GitHub webhook link recorder |
| `supabase/migrations/202608260034_final_audit_hardening.sql` | Final audit hardening: restricted candidate search, access grant boundaries, storage policies, supporting indexes |
| `supabase/migrations/202608260035_api_integration_corrections.sql` | Correct API wrapper ordering/org binding, template component trigger, GitHub integration management |
| `supabase/migrations/202608260036_notification_lifecycle.sql` | Assignment/status/mention notification triggers with preference-aware dispatcher |
| `supabase/migrations/202608260037_restricted_notification_guards.sql` | Restricted issue watcher and mention notification guards |
| `supabase/migrations/202608260038_final_invariant_hardening.sql` | Archived-project watcher checks and API token hash constraints |
| `supabase/migrations/202608260039_release_validation_fixes.sql` | Release validation fixes: API issue argument ordering and granular scopes/comments, GitHub webhook upserts + optional merge resolution, issue-link authorization, typed custom-field validation, and saved-view sharing |
| `supabase/migrations/202608260040_github_app_integration.sql` | Verified GitHub App installations, repository catalog/bindings, normalized artifacts, durable webhook deliveries, lifecycle RPCs, and branch-aware resolution |
| `supabase/migrations/202608260041_service_role_claim_compatibility.sql` | PostgREST-compatible service-role detection for GitHub RPCs and issue-owned mutation triggers |
| `supabase/migrations/202608260042_phase1_issue_api_contracts.sql` | Shared validated browser/REST issue-update fields, nullable body clearing, canonical UUID handling, and per-field audit events |
| `supabase/migrations/202608260043_phase2_membership_invitations.sql` | Hashed expiring invitations, explicit project membership, immutable membership audit, role/removal RPCs, and atomic ownership transfer |
| `src/lib/validation/comment.ts` | `commentSchema` (body 1–10k chars) |
| `src/components/layout/workspace-switcher.tsx` | Workspace/project context switching + project creation dialog |
| `src/components/triage/triage-inbox.tsx` | Phase 12 triage queue, classification controls, duplicate resolution, keyboard actions |
| `src/components/issues/issue-attachments-section.tsx` | Phase 13 private attachment upload, signed preview/download, and cleanup |
| `src/components/reports/reports-dashboard.tsx` | Phase 14 time-window metrics, MTTR, aging, component, and priority reports |
| `src/components/readiness/readiness-dashboard.tsx` | Phase 15 milestone/version release score and explainable risks |
| `src/lib/api-auth.ts` | Server-only API bearer token hashing, scope, membership, and visibility enforcement |
| `src/lib/api-scopes.ts` / `src/lib/validation/issue-update.ts` | Canonical API scope presets and shared issue mutation validation |
| `src/components/settings/workspace-members-manager.tsx` / `project-members-manager.tsx` | Workspace invitation/ownership and project Contributors workflows |
| `src/app/api/v1/` | Scoped REST project/issue reads and writes plus comments, milestones, search, and verified GitHub resources |
| `src/app/api/webhooks/github/` | HMAC-verified, idempotent GitHub App webhook ingestion with lifecycle handling and legacy fallback |
| `src/components/tracebox/markdown-content.tsx` | Safe GFM renderer for issue descriptions and comments; raw HTML remains disabled |
| `src/lib/github.ts` | Repository normalization and case-insensitive issue/closing-key extraction |
| `src/lib/github-app.ts` | Server-side GitHub App JWT, user-code exchange, installation tokens, repository/API helpers with bounded requests |
| `src/lib/github-connect-state.ts` | Signed, expiring TraceBox user/workspace/project state for GitHub App installation callbacks |
| `src/lib/github-repository-sync.ts` | Installation repository reconciliation and access lifecycle updates |
| `src/app/api/github/` | Secure GitHub App connect/callback, repository listing/binding, link verification, sync, and cron reconciliation routes |
| `src/components/settings/github-integration-manager.tsx` | Verified repository picker, installation health, multi-repository project bindings, and target-branch automation settings |
| `.env.example` | Required vars (see below) |
| `README.md` | Setup/deploy runbook |

Env contract: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser-safe), `SUPABASE_SERVICE_ROLE_KEY` (server-only, required by `/api/v1/*` and server GitHub routes), `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CALLBACK_URL`, `GITHUB_API_VERSION`, and `CRON_SECRET` (all GitHub/cron secrets server-only). `.env*` is gitignored except `.env.example`.

## Runtime/Tooling Preferences

- **Node ≥ 20.9** (`engines`); **npm** with committed `package-lock.json`; CI runs `npm ci` on Node 20.
- TypeScript `strict`, target ES2017, moduleResolution `bundler`, isolatedModules.
- ESLint 9 flat config re-exporting `eslint-config-next/core-web-vitals` — no custom rules; keep it that way unless required.
- Tailwind v3 (not v4): content globs cover `src/{app,components}`.
- **TanStack Table is pinned to v8** (`^8.21.3`); v9 renamed the API (`ReactTable`, `createCoreRowModel`) and will not typecheck against `useReactTable`. Column defs must be *inferred* from `createColumnHelper` — explicit `ColumnDef<T>[]` annotations break variance.
- Deploy: Vercel (`vercel.json` pins framework + `npm run build`); GitHub Actions runs the same four gates on PRs and pushes to `main` — keep them green before yielding. The GitHub reconciliation cron runs once daily at 03:00 UTC for Hobby-plan compatibility. If a pushed commit has no Vercel deployment, verify the connected repository, Vercel GitHub App access, production branch, ignored build step, and verified-commit setting before debugging application code.
- Root ESLint intentionally ignores the local-only `qa/live/**` directory; that suite has its own Playwright command and dependency lockfile.

## Testing & QA

- **Vitest 4**, run-only: `npm test` (equivalent to `vitest run`).
- Tests live in `tests/*.test.ts`; `vitest.config.ts` wires the `@` alias to `src` and a node environment. Relative imports also work.
- Current scope: pure functions — zod schemas (`auth-validation`, `workspace-validation`, `components-validation`, `issues`, `comment`), `slugify`, redirect sanitizer + error-message mapping (`utils`), issue-key/event/filter helpers (`issues`), comment helpers (`tokenizeCommentBody`, `buildTimeline`, `excerptBody`, `COMMENT_ADDED/EDITED` summaries), GitHub repository/key extraction, branch matching, signed connection-state helpers, and mocked GitHub user-installation pagination.
- Pre-yield checklist: `npm run lint && npm run typecheck && npm test && npm run build`.
- The tracked unit suite remains Vitest-only. A separate ignored black-box Playwright suite exists under `qa/live/`; it is installed and run independently with deployment credentials and must not be added to CI or committed with secrets.

# Repository Guidelines

## Project Overview

TraceBox — a developer-focused bug/issue tracking platform (Bugzilla-inspired), through **Phase 20 of `docs/archive/tracebox-main-plan.md`** plus the implemented Trace Intelligence layer: workspaces/projects, configurable workflows, atomic issue lifecycle and audit, dense queues, collaboration, planning, notifications/realtime, search/saved views, relationships/triage, attachments, reports/readiness, restricted issues, GitHub App integration, custom fields, scoped REST API, deterministic report quality, advisory structured triage/duplicates, natural-language filter parsing, release briefs, and permission-filtered blast radius.

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
  dashboard/notifications/      full cursor-paginated personal notification inbox
  dashboard/security/           RLS-filtered restricted issue queue + access history
  dashboard/settings/notifications/ personal notification preferences
  onboarding/              two-step create-workspace → create-first-project flow;
                           ?create=1 bypasses the has-orgs redirect for extra workspaces
  robots.ts                public crawler policy: allow the landing page and exclude app/API/token routes
  auth/callback/route.ts   OAuth/email code exchange handler
src/components/
  ui/                      stock shadcn/ui (default style, cva, Radix, forwardRef/asChild)
  layout/                  app chrome: app-header, app-sidebar, user-menu,
                           workspace-switcher (org/project dropdowns + new-project dialog),
                           theme-toggle
  auth/auth-form.tsx       dual-mode ('use client') login/signup form
  tracebox/                brand marks (trace-mark), dashboard overview, primitives kit
  issues/                  atomic new-issue form, conflict-aware detail editor, realtime
                           issue table, comments timeline, planning and security controls
  notifications/           full notification inbox
  security/                restricted issue queue and access history
  intelligence/            report quality, explicit AI controls, duplicate comparison,
                           natural search, release brief, and blast-radius UI
  settings/project-settings.tsx   components/planning manager + workflow editor tabs
  settings/project-administration.tsx project metadata and archive/restore
  settings/*members-manager.tsx  workspace invitations, ownership, and project contributors
src/lib/
  supabase/{client,server,middleware}.ts   three-tier clients
  supabase/auth-errors.ts   shared anonymous-session classifier for server auth boundaries
  validation/auth.ts       zod schemas + inferred LoginValues/SignupValues
  validation/workspace.ts  workspaceSchema (name+slug) / projectSchema (name+KEY+description)
  validation/issue.ts      issueCreateSchema (title/type/component + advanced fields)
  validation/project-settings.ts project metadata and workflow draft schemas
  validation/components.ts componentSchema
  validation/comment.ts    commentSchema (body 1–10k chars)
  issues.ts                KEY format/parse, event timeline copy, category pills, filter codecs,
                           plus comment timeline helpers (excerptBody, tokenizeCommentBody,
                           buildTimeline, unified entry types)
  workspace-context.ts     server helper resolving cookie-backed org/project context
  server-people.ts         server-only profile display-name maps
  utils.ts                 cn(), getSafeRedirectPath (open-redirect guard), slugify()
  errors.ts                code-first safe Supabase Auth messages plus workspace/RPC error mapping
                           (unknown provider text is never surfaced)
  ai/                      server-only Google Gemini client for `gemini-3.1-flash-lite`, strict schemas/prompts, redaction,
                           sanitized provider/route diagnostics,
                           canonical hashing, safe errors, and RPC cache adapter
  features/intelligence/   deterministic quality, context builders, filter sanitation,
                           and bounded graph traversal
supabase/                  config.toml, migrations/ (84 ordered), pgTAP tests/, seed.sql (local demo tenant)
scripts/remove-demo-account.sql guarded exact-target hosted demo cleanup; rolls back by default
tests/                     vitest unit tests (vitest.config.ts wires @ → src)
.github/workflows/ci.yml   quality gate
docs/                      active deployment, API, schema, and feature-checklist docs
README.md                  production submission overview, complete feature catalog, architecture, setup, and verification
  feature-testing-checklist.md submission QA matrix for all implemented product surfaces
  archive/                 completed foundation/roadmap/release records
handoff.md                 current implementation status, verification, and Supabase/Vercel deployment handoff
docs/archive/              historical audits, implementation plans, and release records
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
npm run db:test           # reset + pgTAP + true concurrent issue allocation
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
- **Navigation hierarchy**: the desktop/mobile shell groups the workspace and project switchers explicitly, keeps a primary Create issue action visible (icon-only when collapsed), and labels project navigation separately from Settings. Preserve the sticky, scrollable desktop sidebar so Settings remains reachable on short viewports.
- **Issue workspace hierarchy**: issue-list filters and saved-view inputs use visible labels rather than placeholder-only instructions; keep result counts/ranges and pagination visible. Issue detail pages lead with breadcrumbs/title/actions and use a sticky, explicitly labeled facts rail on desktop.
- **Issue filter navigation**: natural-language filter application and saved-view links may update server-derived URL props without remounting the client issue table; `IssueTable` synchronizes its local filters and search query from `initialFilters`/`initialSearchQuery`.
- **Settings workspace**: `/dashboard/settings/*` shares a nested administration shell with project/role context and a 220px secondary navigation rail; it becomes a horizontally scrollable card row on narrow screens. Project configuration uses count cards as the accessible tablist for components, labels, versions, milestones, and workflow. Keep settings forms explicitly labeled and management lists dense.
- **Narrow side-rail forms**: GitHub-link and linked-issue forms use explicit field labels and full-width stacked controls so their inputs remain understandable inside the issue-detail facts rail.
- **Collapsed desktop navigation**: the collapsed 72px sidebar renders `TraceLogo compact` and keeps the expand chevron inside the available width; do not use the full wordmark in that state.
- **Sidebar layout**: the desktop rail is sticky and viewport-height; its content scrolls vertically so the Settings link remains reachable when the workspace switcher or navigation exceeds the viewport. Keep JSX text nodes free of stray punctuation.
- **Issue components**: `component_id` is optional when a project has no components yet; the RPC accepts null and the form exposes `None`. When a component is selected, its configured default assignee is preselected if the user has not chosen one.
- **Comments**: `comments` table is RPC-only (`add_comment`/`edit_comment`); `select` is allowed for project members via `is_project_member(issue.project_id)`. Reporter+ may add (`can_comment_on_issue`), author or Developer/Maintainer may edit; project-archived guard and 1–10k body validation are enforced server-side. Every add/edit writes `COMMENT_ADDED`/`COMMENT_EDITED` to `issue_events` and bumps `issues.updated_at`.
- **Stable comment mentions**: comment composer/editing uses project- and issue-scoped `list_project_mention_candidates` results, persists selected identities through the `*_comment_with_mentions` RPCs, and `MarkdownContent` styles only persisted `comment_mentions` labels; compact tokens use the Unicode-aware candidate `mention_token`.
- **Personal accounts**: `/dashboard/account` owns profile, avatar, email, password, recovery, notification, and global-session controls. Profile writes use `update_current_profile`; new avatars must already exist in the owner-scoped public `profile-avatars` bucket, while Auth-sensitive changes stay in Supabase Auth.
- **Mutations go through SQL RPCs**: trusted `security definer` functions own privileged/transactional writes, including membership/invitations, atomic issue creation/editing, notification preferences/read state, project lifecycle/workflow publication, restricted grants, components, comments, and planning. Clients call `supabase.rpc(...)`; direct browser writes to protected tables and audit history remain revoked.
- **Active workspace/project selection** lives in `tb_org`/`tb_project` cookies written by the switcher; `getWorkspaceContext()` re-validates them against real memberships server-side and safely defaults to the first available organization and project when cookies are absent or stale.
- **Server authentication errors**: Supabase's `AuthSessionMissingError` is the normal anonymous state, not an infrastructure failure. Use `isMissingAuthSession` at middleware/page/route boundaries so anonymous users redirect or receive 401 while genuine Auth lookup failures fail closed with safe logging. Client Auth failures go through `getSafeAuthErrorMessage(error)`, prefer stable Supabase error codes, and never expose unknown provider messages.
- **DB types are generated**: edit schema via migration, then `npm run db:types` or `npm run db:types:linked`; do not hand-edit `src/types/database.ts`. The committed linked contract and hosted ledger are reconciled through migration 084. Nullable RPC arguments that use database defaults are passed as `undefined` at typed call sites.
- **Trace Intelligence**: provider calls are explicit, server-only, bounded, recursively redacted, strict-JSON-Schema constrained, and Zod validated. Never send restricted/SECURITY issues, comments, attachment bodies, webhook payloads, emails, credentials, or integration configuration. Returned IDs must be revalidated against request-specific allowlists. Deterministic scoring/readiness/duplicate retrieval remains canonical.
- **Trace Intelligence diagnostics**: Gemini/provider and intelligence-route failures emit structured server logs with the operation, model, request ID, provider status/message, and stable `AI_*` code; logs redact API-key-like values and never include prompts or raw model output. Gemini `v1beta` structured JSON requests use flat `responseMimeType`/`responseJsonSchema` generation fields plus minimal thinking for model compatibility; reasoning-only response parts are excluded before strict JSON parsing, and HTTP provider status takes precedence over message text when mapping errors.
- **AI cache and application**: browser roles have no direct cache/ledger DML. Use migration 080 RPCs for viewer-scoped cache reads, request claims, completion/failure, budgets, leases, and cleanup. Every contributing issue ID must be supplied to the claim so access loss invalidates cached output. Human-approved triage changes use the narrow optimistic `apply_issue_triage_updates`; AI never writes automatically.
- **Tenant directories and integration catalogs**: profile SELECT is limited to self and users sharing a workspace. GitHub installation/repository SELECT is limited to organization catalog managers or repositories bound to a project the caller belongs to; server routes must preserve the same project-scoped catalog boundary.
- **Public API reads**: issue list/search authorization, filtering, counting, and bounds execute inside service-role-only SQL wrappers before rows reach Next.js. API routes distinguish database failures from empty/not-found results and never scan a whole project in application memory.
- **Membership and invitations**: ordinary workspace members have explicit project membership, with existing access backfilled by migration 045. Membership and invitation mutations are RPC-only; invitation tokens are returned once and stored only as SHA-256 digests. `/api/invitations` attempts Supabase Auth email delivery and always returns the authorized manual link as fallback. Public workspace joining is explicit and grants MEMBER plus REPORTER on active projects; non-owners may leave through `leave_organization`, which atomically removes project access, restricted grants/watchers/notifications, and workspace API tokens. Owners must transfer ownership first. Normal issue RLS remains authoritative. The supported UI journeys are `/dashboard/settings/members`, `/dashboard/settings/contributors`, `/dashboard/discover`, and `/invite/[token]`.
- **Demo seed**: `supabase/seed.sql` creates the intentional public local/demo login `demo@123.com` / `demo123` with a realistic public workspace. The hosted demonstration currently exposes the same ordinary-user login, so its content is untrusted and must never receive sensitive data, repository access, cross-tenant membership, or privileged credentials. Never run the seed script against a production tenant or treat the public password as a secret. `scripts/remove-demo-account.sql` is the exact-target hosted cleanup path; it asserts identity and membership isolation and ends with `ROLLBACK` until deliberately armed.
- **Issue editing and realtime**: full issue creation is one `create_issue_complete` transaction covering template defaults, required custom values, visibility, grants, labels, watchers, and audit. Detail edits use the optimistic `updated_at` overload and never overwrite a dirty draft on realtime changes. Filter/visibility-sensitive queue events always refetch through RLS; newly restricted rows are removed before refetch.
- **Notifications**: the full inbox and header preview share the cursor/exact-count feed. Preference and read mutations are RPC-only; retained categories are mentions, assignments, comments, status, watched updates, links, labels, planning, and milestones. Restricted notification rows are returned only while `can_view_issue` remains true; title/actor/payload are redacted while key/number preserve an authorized link.
- **Project workflow administration**: project keys are immutable. Maintainers edit metadata, archive/restore, and publish the entire workflow graph atomically through migration 049. The server enforces one initial state, a terminal path for every state, reachability, valid roles/edges, and safe deletion of in-use states.
- **Restricted issues**: `can_view_issue` is the common RLS boundary for issue-owned data. Reporter-owned issue editing includes visibility/grant controls. Access grant/revoke events are table-triggered and `issue_events` is immutable even for privileged maintenance clients. Storage object paths are `<issue-uuid>/<filename>` and require current issue visibility plus an active project.
- **Phase 9 queue and saved views**: advanced queue filters use the canonical `encodeIssueFilters`/`decodeIssueSearchParams` URL contract. Label filtering resolves RLS-visible issue IDs before the paginated issue query. Bulk changes are capped, atomic, RPC-only, and clear page selection on navigation/filter changes. Saved views use `PRIVATE`/`PROJECT`/`ORGANIZATION` visibility, owner-only lifecycle controls, and stable `?view=<uuid>` links.
- **Duplicate triage**: `resolve_duplicate_issue` owns link creation, status/resolution updates, deterministic locks, and audit events in one transaction. Triage shortcuts ignore interactive/editable focus and always have visible control equivalents.
- **GitHub App**: GitHub login remains identity-only. Repository access requires a separately verified GitHub App installation; callback state is signed and bound to the TraceBox user, organization, and project. Installation tokens and App private keys stay server-only.
- **GitHub installation verification**: verify callback installation IDs by paginating the user-token `GET /user/installations` endpoint; GitHub does not provide `GET /user/installations/{id}`.
- **GitHub repository model**: use stable GitHub IDs for installations, repositories, and normalized PR/commit artifacts. Projects may bind multiple repositories; `main` is the default auto-resolution branch and branch matching is explicit.
- **GitHub webhooks**: verify the raw body with HMAC before parsing, persist `X-GitHub-Delivery` before acknowledging, atomically claim deliveries with a processing lease, and use `src/lib/github-webhook-processor.ts` for fast-path and replay processing. `after()` is best effort; `/api/github/webhook-replay` and the daily reconcile job recover eligible failures with an eight-attempt cap. Retain historical TraceBox links when GitHub access is removed, classify API errors without treating every 404/403 as revocation, invalidate cached installation tokens after authorization failures, and clear old terminal payload bodies through `/api/github/webhook-cleanup`. Log structured Supabase RPC failures server-side while keeping webhook responses generic. Never send restricted issue metadata back to GitHub.
- **GitHub operations**: stable-ID installations, repositories, and project bindings are canonical; `project_integrations` remains a compatibility projection. The operations page reads only the payload-free project-scoped RPC. Repository deliveries require a binding to the active project, installation-only lifecycle deliveries are organization-scoped, affected issues are filtered through `can_view_issue`, and only Maintainers may queue bounded idempotent retries. Delivery association is additive observability and must not alter webhook matching or resolution decisions.
- **GitHub PR experience**: issue linking searches only repositories bound to the current project through `/api/github/pull-requests`; `/api/github/link-pull-request` fetches authoritative PR metadata and CI checks server-side. Automatic `Fixes`/`Closes`/`Resolves` relationships are derived state and are reconciled transactionally; manual links are never removed by automatic reconciliation. PR cards expose relationship, branch, state, and check summary.
- **GitHub permissions**: Maintainers install/reconnect GitHub, bind/unbind repositories, change target branches, toggle auto-resolution, and set the primary repository. Developers may search and link PRs. Primary selection is explicit; the first binding is the only implicit primary.
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
| `supabase/migrations/202608260042_github_reliability_pr_experience.sql` | PR metadata/check summaries, derived auto-link reconciliation, atomic webhook claim/replay/retention, classified binding management, and primary repository control |
| `supabase/migrations/202608260043_github_review_fixes.sql` | Service-role compatibility for 042 functions, bounded webhook retry finalization, stale automatic-link cleanup, and active-installation primary checks |
| `supabase/migrations/202608260044_issue_api_contracts.sql` | Shared validated browser/REST issue update contract, nullable body clearing, and per-field audit events |
| `supabase/migrations/202608260045_membership_invitations.sql` | Explicit project membership backfill, hashed workspace/project invitations, membership audit history, role/removal RPCs, and ownership transfer |
| `supabase/migrations/202608260046_phase2_membership_relational_guards.sql` | Workspace/project referential guards for invitations and membership audit rows |
| `supabase/migrations/202608260047_phase4_issue_editing.sql` | Conflict-aware full editing and atomic browser/REST issue creation with templates, custom values, and restricted grants |
| `supabase/migrations/202608260048_phase6_notifications.sql` | Exact cursor inbox, RPC-only preferences/read state, and preference-aware lifecycle emitters |
| `supabase/migrations/202608260049_phase7_project_workflow_admin.sql` | Audited project lifecycle and atomic validated workflow publication |
| `supabase/migrations/202608260050_phase8_restricted_completion.sql` | Restricted access history, immutable issue audit, safe notifications, and active-project Storage policies |
| `supabase/migrations/202608260051_phase9_queue_bulk.sql` | Advanced queue indexes and authorized, deterministic, atomic bulk issue updates |
| `supabase/migrations/202608260052_phase9_saved_views.sql` | Explicit saved-view visibility, owner lifecycle RPCs, and RLS-backed stable sharing |
| `supabase/migrations/202608260053_phase9_triage_command_ux.sql` | Atomic duplicate resolution with deterministic locks and visible audit results |
| `src/lib/validation/comment.ts` | `commentSchema` (body 1–10k chars) |
| `src/components/layout/workspace-switcher.tsx` | Workspace/project context switching + project creation dialog |
| `src/components/triage/triage-inbox.tsx` | Phase 12 triage queue, classification controls, duplicate resolution, keyboard actions |
| `src/components/issues/issue-attachments-section.tsx` | Phase 13 private attachment upload, signed preview/download, and cleanup |
| `src/components/reports/reports-dashboard.tsx` / `src/lib/reports.ts` | Backend-authoritative report windows, historical backlog, resolution metrics, drilldowns, and CSV export |
| `supabase/migrations/202608260058_phase11_reports.sql` | Visibility-filtered created/resolved/backlog history and report breakdown RPC |
| `src/components/readiness/readiness-dashboard.tsx` / `src/lib/readiness.ts` | Phase 11 backend-authoritative readiness score, restricted-safe drilldowns/export, and creator-only snapshot history |
| `supabase/migrations/202608260059_phase11_release_readiness.sql` | Visibility-filtered readiness scoring, project-owned milestone/version validation, immutable RPC-only snapshots, and creator-only history |
| `src/lib/api-auth.ts` | Server-only API bearer token hashing, scope, membership, and visibility enforcement |
| `src/app/api/v1/` | Scoped REST project/issue reads and writes plus comments, milestones, search, and verified GitHub resources |
| `src/app/api/webhooks/github/` | HMAC-verified, durable GitHub App webhook ingestion; processor/replay/cleanup helpers live under `src/lib/` |
| `src/components/tracebox/markdown-content.tsx` | Safe GFM renderer for issue descriptions and comments; raw HTML remains disabled |
| `src/lib/github.ts` | Repository normalization and case-insensitive issue/closing-key extraction |
| `src/lib/github-app.ts` | Server-side GitHub App JWT, user-code exchange, short-lived installation-token cache, classified API errors, PR/check helpers, and bounded requests |
| `src/lib/github-connect-state.ts` | Signed, expiring TraceBox user/workspace/project state for GitHub App installation callbacks |
| `src/lib/github-repository-sync.ts` | Installation repository reconciliation and access lifecycle updates |
| `src/app/api/github/` | Secure GitHub App connect/callback, repository listing/binding/primary control, sanitized webhook status metadata, PR search/linking, link verification, sync, webhook replay/cleanup, and cron reconciliation routes |
| `src/components/settings/github-integration-manager.tsx` | Active/Needs attention/History GitHub dashboard, verified repository picker, installation health, multi-repository bindings, and per-repository automation settings |
| `src/components/settings/issue-templates-manager.tsx` | Template defaults, label configuration, safe Markdown preview, archive/restore, duplication, and atomic saves |
| `src/app/api/attachments/reconcile/route.ts` | Protected orphan attachment reconciliation endpoint; requires `CRON_SECRET` and is not in the default Vercel cron |
| `src/app/(dashboard)/dashboard/settings/layout.tsx` | Shared project-settings administration shell, breadcrumb, permission context, and responsive two-column layout |
| `src/components/settings/settings-navigation.tsx` | Active-route secondary settings navigation for configuration, templates, custom fields/API, membership, contributors, and integrations |
| `src/components/settings/workspace-members-manager.tsx` / `src/components/settings/project-members-manager.tsx` | Workspace invitations/roles, project contributor roles, access removal, and ownership controls |
| `src/components/issues/comments-section.tsx` / `src/lib/comment-mentions.ts` | Stable-identity comment mention autocomplete, editing, realtime hydration, and safe token rendering |
| `src/app/(dashboard)/dashboard/account/page.tsx` / `src/components/account/account-management.tsx` | Personal profile, avatar, Auth credential, recovery, notification, and session management |
| `supabase/migrations/202608260062_phase12_mentions.sql` | RPC-only stable comment mentions and restricted-safe candidate/notification contracts |
| `supabase/migrations/202608260063_account_management.sql` | Canonical profile RPC and owner-scoped public avatar Storage policies |
| `supabase/migrations/202608260064_phase13_github_operations.sql` | Canonical GitHub model declaration, sanitized operational read model, delivery-to-issue audit associations, and idempotent Maintainer retry queue |
| `supabase/migrations/202608260065_reconcile_api_token_scopes.sql` | Forward-only reconciliation of the live 11-scope API-token constraint |
| `supabase/migrations/202608260066_security_advisor_hardening.sql` | Function search-path and execute-grant hardening for internal helpers/triggers |
| `supabase/migrations/202608260067_server_only_api_wrappers.sql` | Service-role-only execute grants for REST mutation wrapper RPCs |
| `supabase/migrations/202608260068_performance_advisor_cleanup.sql` | Foreign-key indexes, RLS init-plan optimization, and duplicate policy/index cleanup |
| `supabase/migrations/202608260069_runtime_function_repairs.sql`–`202608260071_invitation_runtime_repair.sql` | Guarded linked-runtime repairs for duplicate search, invitations, workflow publication, notifications, reports, and GitHub retries |
| `supabase/migrations/202608260072_function_volatility_contracts.sql` | Correct volatility declarations for data-reading and redaction functions |
| `supabase/migrations/202608260073_invitation_context_and_github_automation.sql` | Context-bearing invitation acceptance for cookie-backed project landing and persisted GitHub automation edits |
| `supabase/migrations/202608260074_github_repository_confidentiality.sql` | Project-scoped Developer visibility for GitHub installations, repositories, and operational deliveries |
| `supabase/migrations/202608260075_api_query_bounding.sql`–`202608260076_fix_api_search_expression.sql` | Service-role-only, database-bounded REST issue listing/search and forward-only deployed expression correction |
| `supabase/migrations/202608260077_tenant_catalog_privacy.sql` | Shared-workspace profile visibility and role/project-scoped GitHub installation/repository RLS |
| `supabase/migrations/202608260078_api_project_membership_boundary.sql` | Live token-owner project membership boundary for REST issue list/search wrappers |
| `supabase/migrations/202608260079_ci_contract_hardening.sql` | Total restricted-issue visibility semantics and RPC-only DML grants verified by disposable CI |
| `supabase/migrations/202608260080_trace_intelligence_security.sql` | Viewer-scoped RPC-only AI cache/ledger, live context authorization, bounded request leases/budgets, blast-radius context, and atomic human-approved triage application |
| `supabase/migrations/202608260081_trace_intelligence_blast_depth.sql` | Forward-only correction aligning permission-safe blast-radius traversal with the specified five-hop bound |
| `supabase/migrations/202608260082_public_workspaces.sql` | Opt-in public workspace directory, safe aggregate listing, visibility control, and self-service MEMBER/REPORTER joining |
| `supabase/migrations/202608260083_public_workspace_join_idempotency.sql` | Forward correction preventing repeated joins from downgrading existing member/admin access or duplicating join audit events |
| `supabase/migrations/202608260084_public_workspace_join_lock.sql` | Serializes public joins with visibility changes so privatized workspaces cannot accept a stale concurrent join |
| `supabase/migrations/202608260085_workspace_self_leave.sql` | Self-only workspace leave RPC with owner protection, transactional access/token cleanup, and immutable audit metadata |
| `src/app/(dashboard)/dashboard/settings/integrations/operations/page.tsx` / `src/components/settings/github-operations-dashboard.tsx` | Project-scoped GitHub health, repository sync, safe delivery history, affected-issue, and retry UI |
| `src/app/api/github/retry/route.ts` | Authenticated Maintainer boundary for queuing an eligible delivery through the database retry contract |
| `src/components/audit/audit-explorer.tsx` / `src/app/(dashboard)/dashboard/audit/page.tsx` | Restricted-safe, paginated project audit explorer with actor/action/date/issue filters and CSV export |
| `src/lib/issues.ts` / `src/components/issues/issue-table.tsx` | Canonical queue filter codec supports workflow-category, critical-severity, unresolved, and overdue dashboard drilldowns |
| `supabase/migrations/202608260060_phase11_dashboard_metrics.sql` | Authoritative visibility-filtered operational dashboard metrics RPC |
| `supabase/migrations/202608260061_phase11_audit_explorer.sql` | Authorized audit listing RPC with recursive cross-issue JSON redaction |
| `docs/archive/tracebox-collaboration-github-dashboard-plan.md` | Historical implementation plan for invitations, role-aware collaboration UI, and the GitHub administration dashboard |
| `.env.example` | Required vars (see below) |
| `README.md` | Setup/deploy runbook |

Env contract: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser-safe), `SUPABASE_SERVICE_ROLE_KEY` (server-only, required by `/api/v1/*` and server GitHub routes), `GEMINI_API_KEY` (server-only Google AI Studio key for the `gemini-3.1-flash-lite` Trace Intelligence model), `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CALLBACK_URL`, `GITHUB_API_VERSION`, and `CRON_SECRET` (all GitHub/cron secrets server-only). `.env*` is gitignored except `.env.example`.

## Runtime/Tooling Preferences

- **Node ≥ 22** (`engines`); **npm** with committed `package-lock.json`; CI runs `npm ci` on Node 22. Supabase client libraries dropped Node 20 support after 2026-06-30.
- TypeScript `strict`, target ES2017, moduleResolution `bundler`, isolatedModules.
- ESLint 9 flat config re-exporting `eslint-config-next/core-web-vitals` — no custom rules; keep it that way unless required.
- Tailwind v3 (not v4): content globs cover `src/{app,components}`.
- **TanStack Table is pinned to v8** (`^8.21.3`); v9 renamed the API (`ReactTable`, `createCoreRowModel`) and will not typecheck against `useReactTable`. Column defs must be *inferred* from `createColumnHelper` — explicit `ColumnDef<T>[]` annotations break variance.
- Deploy: Vercel (`vercel.json` pins framework + `npm run build`); GitHub Actions runs the same four gates on PRs and pushes to `main` — keep them green before yielding. The GitHub reconciliation cron runs once daily at 03:00 UTC for Hobby-plan compatibility. If a pushed commit has no Vercel deployment, verify the connected repository, Vercel GitHub App access, production branch, ignored build step, and verified-commit setting before debugging application code.
- Root ESLint intentionally ignores the local-only `qa/live/**` directory; that suite has its own Playwright command and dependency lockfile.

## Testing & QA

- **Vitest 4**, run-only: `npm test` (equivalent to `vitest run`).
- Tests live in `tests/*.test.ts`; `vitest.config.ts` wires the `@` alias to `src` and a node environment. Relative imports also work.
- Current Vitest scope includes pure helpers and schemas plus structural contracts for loading/error states, membership invariants, atomic issue editing/creation, notifications, workflow publication, and restricted security behavior.
- `supabase/tests/*.test.sql` contains pgTAP catalog and authorization tests for membership, issue editing, notifications, workflows, restricted RLS, and Storage. Run them through a disposable Supabase stack; they do not replace hosted multi-user/realtime validation.
- `scripts/test-db-concurrency.mjs` uses 12 simultaneous production RPC calls against local Supabase to verify gap-free atomic issue numbering; CI supplies a pinned Supabase CLI and disposable stack.
- Pre-yield checklist: `npm run lint && npm run typecheck && npm test && npm run build && npm run check:migrations`.
- Committed Playwright browser harness lives under `playwright/`; run `npm run test:e2e:list` for discovery or `npm run test:e2e` for public/auth smoke. Authenticated journeys are explicitly skipped unless real environment-gated fixtures are supplied; GitHub route/webhook coverage stays credential-free, and browser reports, state, and credentials remain ignored.
- API/webhook route contracts live in `tests/phase14-api-webhook.test.ts`; rendered realtime hook coverage in `tests/realtime.test.ts` uses Vitest’s jsdom environment with `@testing-library/react`.
- Issue detail controls keep optimistic custom-field edits rollback-safe, issue-link load failures retryable and announced, mention `aria-controls` scoped to an existing listbox, and narrow notification/attachment rows viewport-safe.
- Rendered dates use `src/lib/date-format.ts` with an explicit `en-US` locale and UTC time zone; browser-derived theme/accent and relative-time state must remain deterministic until hydration completes. `docs/bugs.md` distinguishes source fixes from post-deployment verification.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

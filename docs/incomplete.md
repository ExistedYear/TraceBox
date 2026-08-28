# TraceBox Completion Backlog

This is the authoritative, source-level completion tracker for TraceBox. It consolidates the two source audits formerly represented by `docs/incomplete.md` and a retired duplicate audit; each gap appears once and has a stable ID. A capability is complete only when a user can discover, configure, execute, recover from failure, and observe it through an authorized product workflow.

This tracker distinguishes repository completion from hosted validation. `DONE` means the stated acceptance and verification evidence is present in the repository. `EXTERNAL` means source work is not the remaining blocker, but the target Supabase/Vercel/GitHub environment still has to be exercised. “Phases 1–20 implemented” elsewhere in the repository therefore means source implementation is present, not that this backlog is empty.

## Status vocabulary

Only these status values are valid: `OPEN`, `IN PROGRESS`, `BLOCKED`, `DONE`, and `EXTERNAL`.

## Current snapshot

- Repository implementation is broad through roadmap Phase 20, but the product still has incomplete contributor, settings, editing, failure-state, notification, and operational workflows.
- The hosted GitHub App installation → repository binding → PR webhook → merge-resolution path was manually verified on 2026-08-28. GitHub operational visibility and broader live validation remain outstanding.
- The local unit suite and JavaScript quality gates do not replace database/RLS, Storage, API, webhook, realtime, or browser integration checks.
- Completion-plan Phases 0–2 are source-implemented as of 2026-08-28. The new migrations and multi-user membership journey still require disposable/local replay and hosted browser validation.

## Authoritative items

### TB-001 — Contributor membership and invitation workflow

- Priority: Critical
- Dependencies: none
- Owner area: Membership / Auth / Workspace and project settings
- Status: EXTERNAL
- Evidence: migrations `202608260002` and `202608260045`; `/dashboard/settings/members`; `/dashboard/settings/contributors`; `/invite/[token]`; `src/components/settings/{workspace-members-manager,project-members-manager,invitation-acceptance}.tsx`; persistent sidebar and issue-queue Contributors links; `tests/membership-migration.test.ts`
- Acceptance: An owner can invite by email; a recipient can accept with expired, revoked, already-used, and wrong-account states; an authorized user can add an existing workspace member to a project, change roles, remove project/workspace access, and transfer ownership. A persistent project Contributors panel shows avatar/display name, organization role, project role, access state, pending invitations, and action failures. Tokens are hashed and expiring, protected tables remain RPC-only, role escalation and last-owner removal are impossible, and all mutations have immutable history.
- Verification: Migration/RLS tests for authorization, token expiry and ownership invariants; RPC tests for every mutation; browser journey with two accounts covering invite, accept, role change, access removal, and Contributors-panel visibility.

### TB-002 — Project metadata, lifecycle, and workflow administration

- Priority: High
- Dependencies: TB-001
- Owner area: Project settings / Workflow / Database
- Status: OPEN
- Evidence: `src/components/settings/project-settings.tsx`; `src/app/(dashboard)/dashboard/settings/page.tsx`; `supabase/migrations/202608260003_create_components_workflow.sql`
- Acceptance: An authorized maintainer can edit project name/description, archive and restore a project, and configure workflow states and transitions (create, rename, reorder, initial/terminal flags, required roles, resolution behavior, safe deletion). Project-key immutability or a complete migration contract is explicit. Published workflows always have one initial state, no dangling transitions, valid roles, and no stranded issues.
- Verification: RPC/RLS tests for role and archive guards; transaction tests for graph invariants and in-use state deletion; browser settings journey including publish, archive, restore, and issue lifecycle smoke checks.

### TB-003 — Complete issue editing and mutation contract

- Priority: High
- Dependencies: TB-021
- Owner area: Issues / API / Database
- Status: OPEN
- Evidence: migrations `202608260005` and `202608260042`; `src/lib/validation/issue-update.ts`; `src/components/issues/issue-table.tsx`; `src/app/(dashboard)/dashboard/issues/[issueKey]/page.tsx`; `src/app/api/v1/issues/[issueKey]/route.ts`. Phase 1 aligned the shared body-field contract; the dedicated detail editor remains Phase 4 work.
- Acceptance: A permitted reporter can edit title, description, environment, reproduction steps, expected and actual behavior, type, priority, severity, component, assignee, and authorized planning fields in a dedicated detail-page mode. Browser and REST mutations expose exactly the same supported fields, reject unsupported PATCH fields, preserve normalization, authorization, archived-project guards, no-op behavior, per-field audit events, and `updated_at` updates.
- Verification: Shared contract/schema tests; RPC and REST denial/unsupported-field tests; browser create/edit/reload journey confirming persisted values and timeline events.

### TB-004 — Honest server loading, empty, error, and retry states

- Priority: High
- Dependencies: none
- Owner area: Server-rendered routes / UI foundations
- Status: OPEN
- Evidence: dashboard, reports, readiness, settings, triage, and issue-detail pages under `src/app/(dashboard)/dashboard/`
- Acceptance: Every critical query distinguishes successful empty data from not-found/unauthorized and server failure. Failures log structured server details, render a safe error state with retry, and never become “no issues,” “no members,” zero metrics, or “100% ready.” Partial query failure cannot produce misleading aggregates, and substantial server work has route loading surfaces.
- Verification: Injected query/RLS failure tests for each listed route plus browser checks for empty, unauthorized, failure, retry, and success states.

### TB-005 — Realtime issue-update consumer

- Priority: High
- Dependencies: TB-003, TB-004
- Owner area: Issues / Realtime
- Status: OPEN
- Evidence: `src/hooks/use-realtime.ts` defines `useRealtimeIssueUpdates`, but no current queue/detail consumer was found.
- Acceptance: Two contributors see safe status, assignment, priority, severity, and body changes without refresh. Queue filters are re-evaluated, inaccessible rows are removed, complex associations refresh, reconnects and duplicate events are safe, project switching cleans subscriptions, and active local edits are never silently overwritten.
- Verification: Rendered-hook tests with event/reconnect/cleanup cases and a two-browser hosted journey covering filter changes, lost access, restricted issues, and concurrent edits.

### TB-006 — Notification preferences, inbox, and event breadth

- Priority: High
- Dependencies: TB-004
- Owner area: Notifications / Realtime / Settings
- Status: OPEN
- Evidence: `src/components/layout/notification-center.tsx`; migrations `202608260017`, `202608260022`, `202608260036`, and `202608260037`
- Acceptance: A personal settings page exposes every retained preference. `/dashboard/notifications` provides exact unread counts, full history with pagination/cursor loading, unread/all filtering, mark-one and mark-all read, realtime insertion, safe issue links, loading/error/retry states, and a compact header preview. Declared assignment, mention, comment, status, watcher, link, label, planning, and milestone events are preference-aware, avoid self-duplicates, and never leak restricted metadata; unsupported email promises are removed or implemented.
- Verification: Trigger/dispatcher tests for each retained event and restricted issue; RLS tests for unread/history isolation; browser settings and inbox journey with realtime and failure cases.

### TB-007 — Restricted security issue workflow completion

- Priority: High
- Dependencies: TB-003, TB-006
- Owner area: Issues / Security / Search
- Status: OPEN
- Evidence: `src/components/issues/issue-security-section.tsx`; issue detail page; migration `202608260027_phase18_restricted_issues.sql`
- Acceptance: Creation supports restricted visibility and initial grants atomically. Queues show restricted indicators and filters, a dedicated security queue is discoverable, access history is visible, and authorized reporters/admins receive only permitted controls. RLS, realtime, notifications, API, analytics, and Storage paths preserve restricted-data isolation.
- Verification: Database/RLS/API/Storage denial tests; browser two-account creation, grant, revoke, queue, history, and notification checks.

### TB-008 — Issue queue filters, columns, bulk actions, and drilldowns

- Priority: Medium
- Dependencies: TB-003
- Owner area: Issue queue / Search
- Status: OPEN
- Evidence: `src/components/issues/issue-table.tsx`; `src/lib/issues.ts`; roadmap queue requirements around `docs/archive/tracebox-main-plan.md:1618-1644`
- Acceptance: Queue supports resolution, reporter, version, milestone, label, created/updated dates, and all existing filters; exposes milestone and planned useful columns; and provides authorized bulk selection/update with clear partial-failure results. Filtered empty and error states are distinct.
- Verification: Codec/table tests for every filter and pagination combination; authorization tests for bulk RPCs; browser filter, sort, bulk, and URL-state journey.

### TB-009 — Saved-view visibility and editing model

- Priority: Medium
- Dependencies: TB-008
- Owner area: Search / Saved views
- Status: OPEN
- Evidence: migration `202608260018_phase10_search_saved_views.sql`; `src/components/issues/saved-views-bar.tsx`
- Acceptance: Saved views implement the documented PRIVATE, PROJECT, and ORGANIZATION visibility model (or explicitly revise the contract), support create/rename/edit/delete, persist all advanced filters, produce stable share URLs, and report clipboard failures safely.
- Verification: RLS and visibility matrix tests across organizations/projects; browser create/edit/share/open/copy-failure journey.

### TB-010 — Triage keyboard and classification contract

- Priority: Medium
- Dependencies: TB-008
- Owner area: Triage / Keyboard UX
- Status: OPEN
- Evidence: `src/components/triage/triage-inbox.tsx`; triage requirements around `docs/archive/tracebox-main-plan.md:1671-1692`
- Acceptance: J/K navigation, A/R/D/O, priority, severity, component, edit, and Enter actions match one documented meaning, respect focus/text-entry guards, and expose accessible non-keyboard equivalents. The meaning of `A` is canonical and consistent with UI copy.
- Verification: Keyboard/component tests for every action, focus guard, and authorization denial; browser triage journey with classification and recovery errors.

### TB-011 — Observable duplicate-resolution workflow

- Priority: Medium
- Dependencies: TB-003, TB-010
- Owner area: Triage / Issue links
- Status: OPEN
- Evidence: `src/components/triage/triage-inbox.tsx`; migration `202608260019_phase11_issue_links.sql`
- Acceptance: Duplicate resolution identifies the canonical issue, performs the link/resolution transaction, records visible activity, shows the resulting status, and navigates or links to the canonical issue. Failures are recoverable and do not leave contradictory UI.
- Verification: RPC authorization/transaction tests and browser triage resolution journey including failure and retry.

### TB-012 — Reports and analytics completeness

- Priority: Medium
- Dependencies: TB-004, TB-008
- Owner area: Reports / Analytics
- Status: OPEN
- Evidence: `src/components/reports/reports-dashboard.tsx`; reports route
- Acceptance: Reports include created-vs-resolved, backlog-over-time, resolution-duration, assignee, milestone, and historical views with drilldowns/export where promised. No-data, partial-data, and query-failure states are explicit and metric denominators are authoritative.
- Verification: Fixture-based calculation tests importing production functions; route failure/empty tests; browser metric/filter/drilldown/export journey.

### TB-013 — Release-readiness authority and history

- Priority: Medium
- Dependencies: TB-004, TB-007, TB-012
- Owner area: Readiness / Planning
- Status: OPEN
- Evidence: `src/components/readiness/readiness-dashboard.tsx`; readiness route
- Acceptance: Readiness includes unresolved security and overdue-milestone factors, uses a backend-authoritative calculation, persists snapshots/history, supports export and drilldowns, and renders “no release data” for an empty project rather than 100% ready.
- Verification: SQL score/permission tests against production data; snapshot/history tests; browser factor, empty, failure, and export journey.

### TB-014 — Issue-template defaults and lifecycle

- Priority: Medium
- Dependencies: TB-003
- Owner area: Templates / Issue creation
- Status: OPEN
- Evidence: migration `202608260026_phase17_issue_templates.sql`; `src/components/settings/issue-templates-manager.tsx`; `src/components/issues/new-issue-form.tsx`
- Acceptance: Template management supports default priority, severity, component, labels, preview, archive/restore, and duplication. Creation applies every selected default atomically and reports invalid/archived defaults safely.
- Verification: RPC/template validation tests and browser template-create/select/create-issue journey.

### TB-015 — Custom-field configuration and issue integration

- Priority: Medium
- Dependencies: TB-003, TB-008
- Owner area: Custom fields / Issues / API
- Status: OPEN
- Evidence: `src/components/settings/custom-fields-manager.tsx`; `src/components/issues/issue-custom-fields-section.tsx`; migrations `202608260029` and `202608260039`
- Acceptance: Authorized users can rename/type-edit fields, configure options and requiredness, clear/reset values, use required fields during issue creation, filter/columnize fields in queues, and bulk update where promised. Browser and REST validation agree for all field types.
- Verification: Typed SQL/RPC/API tests for valid, invalid, missing, and cross-project values; browser settings, creation, queue, and edit journey.

### TB-016 — API-token lifecycle and project restrictions

- Priority: Medium
- Dependencies: TB-022
- Owner area: API security / Settings
- Status: OPEN
- Evidence: `src/components/settings/custom-fields-manager.tsx`; `src/lib/api-auth.ts`; migration `202608260029_phase20_custom_fields_api.sql`
- Acceptance: Token management supports expiration input/display, last-used display, rotation, revocation, usage history, API documentation/explorer, and project-level restrictions where declared. Plaintext is shown once, hashes are protected, and expired/revoked/restricted tokens fail safely.
- Verification: Database constraint/RLS and route scope tests; browser token lifecycle journey; no-secret-leak log/response checks.

### TB-017 — GitHub integration operational observability

- Priority: Medium
- Dependencies: TB-004
- Owner area: GitHub App / Integrations
- Status: OPEN
- Evidence: `src/components/settings/github-integration-manager.tsx`; integrations settings route; `src/app/api/github/**`; webhook route; migrations `202608260028`, `202608260033`, `202608260040`, and `202608260041`
- Acceptance: The canonical GitHub App model is clear (including treatment of legacy integrations), and users can see installation/repository health, webhook delivery history and failure detail, retry failed deliveries, rich PR/commit/CI/merge activity, and automatic-resolution audit results. Historical links survive access removal and restricted issue data never leaves TraceBox.
- Verification: Hosted GitHub App install/bind/link/merge flow (already verified 2026-08-28) plus delivery failure/retry, lifecycle, reconciliation, and restricted-data tests.

### TB-018 — Attachment failure recovery and upload UX

- Priority: Medium
- Dependencies: TB-004, TB-007
- Owner area: Attachments / Storage
- Status: OPEN
- Evidence: `src/components/issues/issue-attachments-section.tsx`; migration `202608260031_api_storage_hardening.sql`
- Acceptance: Upload supports true drag/drop, multi-file selection, progress, retry, complete MIME allowlisting, orphan reconciliation, and clear Storage-delete failure handling while preserving the private 50MB bucket and signed access contract.
- Verification: Storage policy tests, MIME/size tests, orphan cleanup tests, and browser upload/download/delete failure journeys.

### TB-019 — Dashboard operational overview

- Priority: Medium
- Dependencies: TB-004, TB-008
- Owner area: Dashboard / Navigation
- Status: OPEN
- Evidence: dashboard route and `src/components/tracebox/dashboard-overview.tsx`
- Acceptance: Overview includes assigned-to-me, awaiting-triage, due-milestone, and other committed operational cards; each card has an authorized clickable drilldown and truthful empty/error semantics.
- Verification: Query/permission tests and browser card-to-filter journey for empty, populated, and failed data.

### TB-020 — Command palette and global quick actions

- Priority: Medium
- Dependencies: TB-003, TB-006, TB-008
- Owner area: Navigation / Keyboard UX
- Status: OPEN
- Evidence: command palette and global shortcut components; Phase 16 status in the roadmap audits
- Acceptance: Palette exposes committed My Issues, notifications, issue search, and quick status actions with authorization, keyboard/focus behavior, loading, empty, and failure states; actions use the same mutation contract as the issue UI.
- Verification: Component/keyboard tests and browser navigation/action journey with permission and failure cases.

### TB-021 — Generated database types and migration/schema drift

- Priority: High
- Dependencies: none
- Owner area: Database tooling / TypeScript
- Status: IN PROGRESS
- Evidence: migrations `202608260040`–`202608260045`; reconciled `src/types/database.ts`; synchronized `supabase/full_schema.sql`; stale GitHub/API casts removed. Static checks pass, but this environment could not run Docker-backed migration replay or `npm run db:types`.
- Acceptance: A disposable replay of migrations 001–041 succeeds; regenerated types include GitHub App tables/fields/RPCs, issue-link additions, and all current API/custom-field contracts; avoidable GitHub `any` casts are removed. `check:migrations` verifies only, `sync:migrations` regenerates the bundle, and `supabase db reset` executes locally.
- Verification: Fresh local Supabase replay, `npm run db:types`, typecheck, `npm run check:migrations`, and schema/type catalog comparison.

### TB-022 — API-token scope contract alignment

- Priority: High
- Dependencies: TB-021
- Owner area: API security / Database
- Status: EXTERNAL
- Evidence: final constraint in migration `202608260040`; `src/lib/api-scopes.ts`; `src/components/settings/custom-fields-manager.tsx`; `src/lib/api-auth.ts`; `tests/api-contracts.test.ts` derives the accepted scope set from the latest defining migration.
- Acceptance: The final database scope constraint, generated type, UI presets, and every API route agree. Every visible scope can be persisted and is enforced; unsupported scopes are rejected explicitly.
- Verification: Matrix tests for each preset × route × read/write/organization/project/restricted case against the applied schema.

### TB-023 — Standalone audit-history view

- Priority: Low
- Dependencies: TB-001, TB-003
- Owner area: Audit / Issues / Settings
- Status: OPEN
- Evidence: issue timeline exists, but no standalone audit-history screen was found in either audit.
- Acceptance: Authorized users can discover a paginated, filterable standalone audit history for the relevant project/workspace, with actor, timestamp, event type, target, before/after values, and restricted-data redaction.
- Verification: RLS/query tests for cross-project and restricted events plus browser pagination/filter/export or documented non-export behavior.

### TB-024 — Mention autocomplete and identity selection

- Priority: Medium
- Dependencies: TB-001, TB-006
- Owner area: Comments / People search
- Status: OPEN
- Evidence: `src/components/issues/comments-section.tsx`; `src/lib/issues.ts` mention styling/tokenization helpers
- Acceptance: Comment composition offers accessible autocomplete from authorized project identities, stores unambiguous identity references, handles no-match/loading/error states, and drives preference-aware notifications without notifying arbitrary text matches or leaking restricted users.
- Verification: Identity search/RLS and notification tests; browser comment mention journey with keyboard selection, edit, and restricted issue cases.

### TB-025 — User profile and account management

- Priority: Low
- Dependencies: TB-001
- Owner area: Account / Auth
- Status: OPEN
- Evidence: profile reads exist, but no complete user-facing account-management workflow was found in the audits.
- Acceptance: Users can view/edit display name and avatar, manage account email/password and sign-out sessions as supported by Auth, and receive safe validation/recovery/error states. Organization/project identity displays remain consistent with profile updates.
- Verification: Auth/profile RLS tests and browser account update, recovery, validation, and session journey.

### TB-026 — Public API developer experience

- Priority: Low
- Dependencies: TB-003, TB-016, TB-022
- Owner area: Public API / Documentation
- Status: OPEN
- Evidence: `src/app/api/v1/`; `README.md`; `deployment.md`; audit finding for missing API documentation/explorer
- Acceptance: Every public route documents authentication, scopes, request/response schemas, pagination, errors, supported issue fields, idempotency, and examples; an in-product or static explorer is provided if promised. Docs match the implemented API and expose no secrets.
- Verification: Generated/opened API contract checks, route smoke tests, and examples executed against a disposable project/token.

### TB-027 — Plan/schema contract divergences

- Priority: Medium
- Dependencies: TB-021
- Owner area: Product documentation / Database architecture
- Status: OPEN
- Evidence: `docs/archive/tracebox-main-plan.md`; migrations `001`, `017`, `018`, `028`, `030`; `supabase/seed.sql`
- Acceptance: Each known divergence is explicitly accepted and documented, removed from the plan, or implemented: profile username, saved-view owner/scope/visibility model, notification email columns, generic integration secret reference, issue visibility values, and seed/demo-data expectations. No plan language implies an unimplemented schema contract.
- Verification: Reviewed plan-to-migration matrix and fresh schema review; documentation diff reviewed by product and database owners.

### TB-028 — Real database, RLS, Storage, API, webhook, and realtime tests

- Priority: High
- Dependencies: TB-021, TB-022
- Owner area: Quality / Database security
- Status: OPEN
- Evidence: `tests/phase12-20-features.test.ts`, `tests/issue-links.test.ts`, `tests/realtime.test.ts`, and `tests/integration-phase1-5.test.ts` are primarily synthetic or structural.
- Acceptance: Tests exercise production functions and real disposable services for cross-organization reads, restricted access, Storage policies, API scopes, mutation authorization, issue-number concurrency, archived guards, webhook HMAC/idempotency, and realtime lifecycle. Tautological/local reimplementations no longer stand in for contract tests.
- Verification: Committed integration suite with documented local dependencies and denial cases; targeted CI/local run against disposable database and Storage.

### TB-029 — Browser end-to-end test availability

- Priority: Medium
- Dependencies: TB-028
- Owner area: Quality / Release engineering
- Status: OPEN
- Evidence: ignored local-only `qa/live/` suite referenced by `README.md`, `handoff.md`, and `deployment.md`
- Acceptance: The project documents how authorized maintainers obtain/configure the hosted QA suite from a fresh clone, or commits a credential-free equivalent. Secrets, browser state, reports, and test results remain excluded from Git.
- Verification: Fresh-clone setup check and a documented hosted run covering public routes, OAuth redirect, API scopes/pagination, webhook signatures, and the multi-user workflow.

### TB-030 — CI integration/security coverage

- Priority: Medium
- Dependencies: TB-028
- Owner area: CI / Quality
- Status: OPEN
- Evidence: `.github/workflows/ci.yml` runs JavaScript gates and migration-file consistency but not SQL/RLS/Storage/API/webhook/browser checks.
- Acceptance: CI runs an appropriately isolated SQL/migration replay and committed authorization/API/webhook checks, with browser checks either safely integrated or explicitly documented as a protected external job. CI validates the proposed diff rather than only a clean-checkout `git diff --check`.
- Verification: Pull-request run with intentional denial/failure fixtures and recorded artifacts.

### TB-031 — Hosted deployment and external validation

- Priority: High
- Dependencies: TB-021, TB-028
- Owner area: Release / Supabase / Vercel / GitHub operations
- Status: EXTERNAL
- Evidence: `docs/bugs.md`; `handoff.md`; `deployment.md`
- Acceptance: The linked/target environment has migrations, generated types, private attachment bucket/policies, Realtime publication, Auth URLs/provider settings, server-only Vercel variables, GitHub App/webhook/cron configuration, API scopes, reconciliation, and broader multi-user/RLS/API/browser flows verified. The core GitHub installation/binding/PR-link/merge path is already verified, but does not close the remaining checklist.
- Verification: Signed release checklist with environment evidence and hosted `qa/live` results; no source-only claim substitutes for this status.

### TB-032 — Historical foundation-plan wording

- Priority: Low
- Dependencies: none
- Owner area: Documentation
- Status: DONE
- Evidence: `docs/archive/plan.md` describes the completed deployment foundation and points to the Phase 20 roadmap and deployment checklist.
- Acceptance: `docs/archive/plan.md` clearly labels the foundation plan as historical/completed and does not imply the whole product or hosted validation is complete.
- Verification: Documentation review against `docs/completion_plan.md`, this tracker, and the roadmap wording.

## Maintenance rules

Before starting an item, re-audit its source, migrations, generated types, tests, and deployment notes. Update the item’s status and evidence when work changes. Do not mark source work `DONE` when its acceptance depends on hosted systems; use `EXTERNAL` until the target environment is exercised. Keep this file authoritative and do not create a second incomplete-feature audit.

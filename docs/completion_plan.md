# TraceBox Completion Plan

## Purpose

This plan converts the findings from `docs/incomplete.md` and a now-retired duplicate audit into a dependency-safe implementation sequence. A feature is complete only when users can discover, configure, execute, recover from failure, and observe it through an authorized product workflow.

The audits overlapped. Phase 0 consolidated their findings into the authoritative `docs/incomplete.md` and retired the duplicate audit. Source implementation, automated verification, and external deployment validation remain separate completion states.

## Delivery rules

Before starting any phase or item, re-audit the current source, migrations, generated types, tests, and deployed validation notes. If the capability is already implemented—especially GitHub integration work—verify it against the stated exit criteria, update the backlog evidence, and skip duplicate implementation.

Every phase follows the same sequence:

1. Confirm the affected production contract and current call sites.
2. Add an immutable migration for schema or authorization changes.
3. Regenerate `src/types/database.ts` after database changes.
4. Implement the RPC/server contract before its UI.
5. Add authorization denial cases and observable-contract tests.
6. Implement the complete user workflow, including loading, empty, error, retry, and success states.
7. Exercise the real changed surface.
8. Run targeted checks, then the repository quality gate.
9. Update `docs/incomplete.md`, `handoff.md`, and `AGENTS.md` with verified status and architectural changes.

Do not mark externally dependent work complete until it has been exercised against the target Supabase/Vercel/GitHub environment.

## Phase 0 — Consolidate the completion backlog

Status: source-complete on 2026-08-28. The duplicate audit was retired after its unique findings were preserved in `docs/incomplete.md`.

### Scope

Create one non-duplicated, executable source of truth from both incomplete-feature audits.

### Work

- Make `docs/incomplete.md` the authoritative tracker.
- Preserve unique findings from the retired audit, including:
  - project metadata and archive/restore controls;
  - standalone audit history;
  - mention autocomplete and identity selection;
  - user profile and account management;
  - API developer experience;
  - historical status of `docs/archive/plan.md`.
- Merge duplicated findings covering stale database types, notification event breadth, GitHub delivery visibility, API PATCH drift, and test/CI gaps.
- Assign stable IDs, priority, dependencies, owner area, acceptance criteria, verification method, and status to every finding.
- Separate statuses into `OPEN`, `IN PROGRESS`, `BLOCKED`, `DONE`, and `EXTERNAL`.
- Qualify Phase 1–20 completion wording across README, roadmap, and handoff documentation.
- Incorporate the persistent Contributors panel requested in `docs/bugs.md` into the membership phase.

### Exit criteria

- Every known gap appears exactly once.
- Every item has observable acceptance and verification criteria.
- Source-complete work cannot be confused with hosted validation.

## Phase 1 — Repair schema, generated types, and API contracts

### Scope

Remove schema drift and contract ambiguity before building more UI.

### Work

- Replay migrations `001–041` on a disposable local Supabase instance.
- Regenerate `src/types/database.ts` from the applied schema.
- Confirm generated types include GitHub installations, repositories, project bindings, artifacts, webhook deliveries, issue-link additions, and migration 039–041 RPCs.
- Remove avoidable `any` casts introduced solely by stale generated types.
- Define one issue mutation contract for the browser UI and public REST API.
- Extend the database mutation contract to support accepted body fields: title, description, environment, steps to reproduce, expected behavior, and actual behavior.
- Preserve authorization, archived-project guards, canonical normalization, no-op behavior, per-field audit events, and `updated_at` updates.
- Reject unsupported REST PATCH fields explicitly rather than silently ignoring them.
- Verify the final API-token scope constraint against every UI preset and API route.
- Clarify the canonical migration workflow: `check:migrations` verifies, `sync:migrations` regenerates, and `supabase db reset` executes locally.

### Exit criteria

- The generated `Database` type represents the applied schema.
- REST PATCH and issue mutation RPCs expose identical supported fields.
- Every visible API-token scope can be persisted and enforced.
- Fresh migration replay succeeds.

## Phase 2 — Membership, invitations, contributors, and ownership

Status: source-complete on 2026-08-28. Migrations 045–046, RPC-only UI journeys, Vitest contracts, and pgTAP catalog tests are present; disposable database replay and the hosted two-account browser journey remain external validation.

### Scope

Remove the critical requirement for administrator SQL before a second contributor can collaborate.

### Backend work

Add safe RPC-backed workflows for:

- inviting a user by email;
- listing, revoking, expiring, and accepting invitations;
- adding an existing workspace member to a project;
- changing organization and project roles;
- removing project access;
- removing workspace access;
- transferring workspace ownership;
- recording membership and invitation history.

Required invariants:

- invitation tokens are stored hashed and expire;
- invitation email matches the authenticated accepting identity;
- protected membership tables remain unavailable for direct browser mutation;
- users cannot grant roles above their authority;
- an organization always has an owner;
- last-owner removal is impossible;
- ownership transfer is atomic;
- organization removal consistently invalidates project and restricted-issue access;
- all mutations produce immutable audit records.

### UI work

- Workspace Members page.
- Project Members settings section.
- Invite, pending invitation, role change, removal, and ownership-transfer flows.
- Invitation acceptance route with expired, revoked, already-used, and wrong-account states.
- Persistent project Contributors panel, directly reachable from the project shell.

### Exit criteria

An owner can invite a fresh user, the user can accept without SQL intervention, project access can be assigned and changed, and access can be removed without violating ownership or restricted-data invariants.

## Phase 3 — Honest loading, empty, and error states

Status: source-complete on 2026-08-28. Critical dashboard, issue, reports, readiness, settings, triage, milestone, integration, membership, security, notification, and shared workspace-context reads now fail closed with safe retry states. Hosted fault-injection remains external validation.

### Scope

Prevent query failures from appearing as valid empty projects or zero metrics.

### Work

Cover dashboard, issue queue, issue detail, reports, readiness, settings, triage, milestones, integrations, and notification surfaces.

For every critical query:

- distinguish successful empty data, not-found/unauthorized, and server failure;
- log structured server details without exposing raw database errors;
- render a safe error state;
- provide a retry path;
- prevent partial query failure from producing misleading aggregates;
- retain route loading surfaces where server work is substantial.

### Exit criteria

A failed query never renders as “no issues,” “no members,” or “100% ready.” The user sees a safe error and can retry.

## Phase 4 — Complete issue creation and editing

Status: source-complete on 2026-08-28. Migration 047 provides conflict-aware full-field editing and atomic template/custom-field/restricted creation shared by browser and REST paths; detail editing, preview, draft protection, safe errors, and audit behavior are wired. Database replay and browser persistence checks remain external validation.

### Scope

Deliver the complete “Edit own issue” journey and align issue creation with restricted visibility, templates, and custom fields.

### Work

- Add a dedicated issue-detail edit mode.
- Support title, description, environment, steps to reproduce, expected behavior, actual behavior, type, priority, severity, component, assignee, and authorized planning fields.
- Define reporter-owned edit permissions explicitly and enforce them in SQL.
- Add field validation, Markdown preview/rendering, unsaved-change handling, safe error messages, and correct audit timeline entries.
- Add restricted visibility and initial grants during creation.
- Apply all template defaults during creation.
- Add required custom fields to issue creation.
- Make issue creation atomic where visibility, grants, labels, defaults, or required custom values must remain consistent.

### Exit criteria

A permitted reporter can create and edit the full issue body through the product. Unauthorized, archived-project, and invalid-field mutations fail visibly and safely. REST and browser behavior match.

## Phase 5 — Realtime issue consistency

Status: source-complete on 2026-08-28. Queue and detail consumers patch safe fields, refetch associations and filter-sensitive changes, remove deletes/newly restricted rows, isolate project subscriptions, recover on reconnect, and protect active drafts. The two-browser lost-access/concurrent-edit journey remains external validation.

### Scope

Consume `useRealtimeIssueUpdates` in issue queues and issue detail.

### Work

- Patch simple visible fields locally when safe.
- Refresh server data for complex associations.
- Remove rows that no longer match active filters.
- Avoid adding rows when the client lacks enough data to evaluate access or filters safely.
- Handle reconnects, duplicate events, project switching, deletion, lost access, restricted issues, and subscription cleanup.
- Never overwrite an active local edit silently; show that the issue changed elsewhere and offer reload.

### Exit criteria

Two contributors see status, assignment, priority, and body changes without manual refresh, and navigation does not accumulate duplicate subscriptions.

## Phase 6 — Notification preferences and full inbox

Status: source-complete on 2026-08-28. Migration 048, the full cursor inbox, compact header feed, exact unread count, personal preference UI, all retained event categories, realtime lifecycle handling, RPC-only writes, and restricted-safe links are implemented. Trigger/RLS pgTAP execution and hosted realtime validation remain external.

### Scope

Complete notification configuration, delivery breadth, unread counts, and inbox behavior.

### Work

- Add a personal notification settings page.
- Expose every preference actually supported by the database.
- Either implement promised email preferences and dispatch behavior or remove them from the declared product contract.
- Add `/dashboard/notifications` with pagination or cursor loading, exact unread count, unread/all filtering, mark-one-read, mark-all-read, realtime insertion, loading, error, retry, and safe issue links.
- Keep the header popover as a compact preview.
- Complete preference-aware events for assignments, mentions, comments, status, watched updates, links, labels, planning, and milestones where retained by the notification model.
- Prevent self-notification duplication and restricted-metadata leakage.

### Exit criteria

Unread counts are exact, preferences change delivery, the full history is reachable, and all declared notification categories are implemented or explicitly removed from the contract.

## Phase 7 — Project settings and workflow administration

Status: source-complete on 2026-08-28. Migration 049 and project settings provide audited metadata changes, immutable keys, archive/restore discovery, and atomic draft-and-publish workflow editing with graph, role, resolution, reachability, and in-use-state validation. Database and browser lifecycle smoke tests remain external.

### Scope

Complete project metadata, project lifecycle, workflow state editing, and transition editing.

### Work

- Edit project name and description.
- Define project-key immutability or implement a complete key migration contract.
- Archive and restore projects.
- Create, rename, reorder, and safely delete workflow states.
- Configure initial and terminal states.
- Create and delete transitions and configure required roles and resolution behavior.
- Enforce workflow validity server-side: exactly one initial state, no dangling transitions, valid roles, safe deletion of in-use states, and no stranded issue lifecycle.
- Use draft-and-publish if individual mutations cannot preserve a valid graph atomically.

### Exit criteria

A maintainer can change project metadata and workflow without creating a graph that blocks issue creation or strands existing issues.

## Phase 8 — Restricted security issue completion

Status: source-complete on 2026-08-28. Atomic creation/grants, reporter controls, queue indicators/filtering, a dedicated security queue, immutable access history, notification/API/search hardening, realtime fail-closed behavior, and active-project Storage policies are implemented in migrations 047/050 and UI. Dedicated RLS/Storage pgTAP tests are committed but could not run in this checkout because the Docker socket is unavailable; hosted multi-user validation remains external.

### Scope

Complete restricted creation, discovery, access history, analytics, realtime, notifications, API, and Storage protection.

### Work

- Restricted visibility and initial access grants during creation.
- Restricted indicators and filters in queues.
- Dedicated security issue queue.
- Access grant/revocation history.
- Reporter-facing controls where backend authorization permits them.
- Verify that unauthorized users cannot infer restricted issues through search, duplicate candidates, analytics, counts, notifications, realtime, attachments, API responses, or audit exports.

### Exit criteria

An unauthorized user cannot infer a restricted issue’s existence or metadata through any supported surface. Dedicated RLS and Storage tests pass.

## Phase 9 — Queue, advanced search, saved views, triage, and command UX

Status: source-complete on 2026-08-29. Migrations 051–053 add authorized atomic bulk updates, explicit saved-view visibility/lifecycle, and transactional duplicate resolution. The queue, saved-view bar, triage shortcuts, and command palette implement the complete source workflow; pgTAP execution and hosted keyboard/multi-user/browser validation remain external.

### Issue queue

Add resolution, reporter, version, milestone, label, created-date, updated-date, and restricted filters; add the milestone column, bulk selection, and authorized bulk updates.

### Saved views

- Replace `is_shared` with explicit `PRIVATE`, `PROJECT`, and `ORGANIZATION` visibility if organization sharing remains required.
- Add rename, filter update, deletion, full advanced-filter persistence, stable share URLs, and clipboard failure feedback.

### Triage

- Define one canonical shortcut contract for navigation, open, priority, severity, component, edit, accept, reject, assign, and duplicate.
- Complete duplicate resolution as one observable transaction: choose canonical issue, create the link, resolve the duplicate, write activity, show success, and offer navigation.

### Command palette

Complete My Issues, notifications, project and issue navigation, issue creation, and quick status actions.

### Exit criteria

Advanced filters serialize consistently across the queue, saved views, URLs, triage, and command navigation. Duplicate resolution has a visible transactional result.

## Phase 10 — Templates, custom fields, attachments, and API tokens

Status: source-complete on 2026-08-29. Migrations 054–057 complete template lifecycle/default application, custom-field configuration/value validation, attachment MIME/path/reconciliation hardening, and API-token lifecycle contracts. Local typecheck, focused unit tests, and lint pass; pgTAP replay, migration replay, hosted Storage/API validation, and browser template/upload/token journeys remain external checks.

### Issue templates

Add default priority, severity, component, labels if adopted, preview, archive/restore, duplication, and validation for archived referenced defaults.

### Custom fields

Add rename, configuration editing, select-option management, requiredness, issue-create integration, queue columns and filters, bulk updates, and consistent clear/reset behavior. Type changes must be safely migrated or prohibited when values exist.

### Attachments

Add drag-and-drop, multi-file upload, per-file progress, cancellation/retry, server-enforced MIME allowlisting, clear Storage deletion failure handling, and orphan reconciliation.

### API tokens and developer experience

Add expiration controls, expiration and last-used display, rotation, project restrictions if retained, usage history if backed by an intentional audit model, complete API documentation, token usage guidance, request/response examples, error contracts, and an optional request explorer. Document rate-limit behavior rather than implying unsupported limits.

### Exit criteria

Each resource supports its complete create, configure, use, update, archive/delete, and failure-recovery lifecycle.

## Phase 11 — Reports, readiness, dashboard, and audit explorer

Status: source-complete on 2026-08-29. Migrations 058–061 provide visibility-filtered report history, readiness scoring and creator-private snapshots, operational dashboard metrics, and a restricted-safe audit feed. The report/readiness/audit UIs include drilldowns, bounded exports, explicit empty/error states, and canonical queue links; database replay and hosted multi-user/browser verification remain external.

### Reports

Add backend-authoritative created-vs-resolved, backlog-over-time, resolution-duration, assignee, milestone, and historical trend data, with time windows, drilldowns, export, explicit no-data states, and explicit query-error states.

### Release readiness

Move scoring into shared production code or SQL. Include blockers, critical issues, regressions, unassigned work, unresolved security issues without metadata leakage, overdue milestones, persisted snapshots, history, drilldowns, and export. Empty projects must show “No release data,” not 100%.

### Dashboard

Add assigned-to-me, awaiting-triage, due-milestone, clickable metric, and drilldown cards.

### Audit explorer

Add a project-wide audit view with actor, action, date, and issue filters, pagination, export, and restricted-event visibility enforcement.

### Exit criteria

Metrics are authoritative, explainable, and linked to their contributing issue sets. Empty data and failed queries are distinguishable.

## Phase 12 — Mentions and user account management

Status: source-complete on 2026-08-29. Migration 062 replaces arbitrary text matching with issue-scoped identity autocomplete, persisted mention identities, atomic comment wrappers, and preference/visibility-safe notifications. Migration 063 and `/dashboard/account` add RPC-only profile updates, owner-scoped avatar Storage, email/password/recovery flows, notification access, and global sign-out. Hosted Auth email-change and multi-user restricted-mention journeys remain external.

### Mentions

- Add member-aware mention autocomplete and keyboard selection.
- Resolve mentions to stable user identities rather than styling arbitrary `@text` only.
- Preserve safe Markdown behavior.
- Ensure mention notifications respect membership, preferences, and restricted visibility.

### Account management

Add a personal settings surface for display name, avatar, password-management entry points, notification preferences, and account-level validation. Keep authentication-sensitive mutations in Supabase Auth flows and avoid exposing provider internals.

### Exit criteria

Users can manage their supported profile fields and select valid collaborators in comments without manually guessing mention text.

## Phase 13 — GitHub operational visibility and canonical model

Status: source-complete on 2026-08-29. Migration 064 declares the stable-ID GitHub App installation/repository-binding model canonical while retaining `project_integrations` as a compatibility projection, adds payload-free project-scoped health/delivery read models, bounded failure categories, idempotent Maintainer retry requests, and restricted-safe delivery-to-issue audit associations. `/dashboard/settings/integrations/operations` exposes installation health, repository sync/access, delivery history, affected visible issues, retry eligibility, and secret-free recovery guidance. Existing webhook verification, matching, linking, and resolution behavior is preserved; hosted failure/retry and lifecycle validation remains external.

### Scope

The hosted installation, repository binding, PR webhook, and merge-resolution path is already verified. Complete operational visibility and remove model ambiguity.

### Work

- Declare the GitHub App installation and repository-binding model canonical.
- Migrate or remove the legacy `project_integrations` path.
- Add installation health, repository access, last sync, last webhook, and configuration-error status.
- Add webhook delivery history with delivery ID, event/action, timestamps, status, and safe failure category.
- Add idempotent retry for eligible failed deliveries.
- Show rich PR/commit/merge timeline activity and the audit result of automatic resolution.
- Prefer configured repository selection over repeated free-text repository entry.
- Complete in-product installation guidance without exposing secrets.

### Exit criteria

A maintainer can determine whether GitHub is healthy, why automation failed, what delivery caused an issue change, and whether a retry is safe.

## Phase 14 — Real database, API, realtime, and browser tests (can be skipped for now)

Status: source-complete on 2026-08-29. A committed Playwright harness, production-hook realtime tests, API/webhook route tests, a 40-assertion pgTAP security suite, and a true concurrent issue allocator check are integrated with a disposable-Supabase CI job. Credential-free browser smoke passed locally (3 passed, 10 fixture-dependent journeys skipped); 199 Vitest tests, typecheck, build, migration consistency, and lint with only known compatibility warnings also pass. Local Docker-backed database execution remains external because this workstation account cannot access the Docker socket; the first CI database run and hosted multi-user journeys must still be recorded.

### Database and RLS

Cover cross-organization denial, invitations and membership roles, ownership transfer, restricted visibility, access grants and revocation, Storage policies, API scopes, mutation authorization, issue-number concurrency, archived-project guards, workflow validity, notification leakage, and webhook service-role boundaries.

### API and webhooks

Cover bearer authentication, scope enforcement, PATCH parity, restricted filtering, webhook HMAC, malformed input, idempotency, and retry behavior.

### Realtime

Render production hooks and verify subscription setup, payload handling, cleanup, reconnect, project changes, and restricted access behavior.

### Browser

Commit a secret-free Playwright harness while keeping credentials, browser state, fixtures containing secrets, and generated reports ignored. Cover authentication, workspace/project creation, invitation acceptance, issue creation/editing, assignment/transition, comments/notifications, two-user realtime, restricted denial, attachment authorization, and API-token use. Keep GitHub route/webhook verification credential-free through mocked network boundaries; do not require GitHub environment files.

### CI

Add disposable Supabase migration replay, database/RLS tests, API tests, and CI-safe browser smoke journeys alongside existing migration consistency, lint, typecheck, Vitest, and build gates. Replace synthetic tests that reimplement production algorithms with production imports or behavioral integration tests.

### Exit criteria

A clean clone can run all non-secret test layers. Critical security denials and multi-user workflows are automated.

## Phase 15 — Hosted validation and documentation closure

### Work

- Apply the final migration chain to the target Supabase project.
- Regenerate linked database types and confirm no drift.
- Verify Storage buckets and policies, Realtime publication, Auth URLs, password recovery, public and server-only environment variables, GitHub App credentials, webhook secret, and cron authorization.
- Run the complete hosted multi-user flow.
- Record exact evidence in `handoff.md`.
- Update README, roadmap, bugs, incomplete tracker, deployment guide, and `AGENTS.md`.
- Mark `docs/archive/plan.md` as historical foundation guidance; use `docs/deployment.md` and `handoff.md` for current operations.
- Keep provider configuration and other unexecuted environment work marked `EXTERNAL`.

### Final release gate

```bash
npm run check:migrations
npm run lint
npm run typecheck
npm test
npm run build
npm run db:reset
```

Also run the database, API, realtime, and browser commands introduced in Phase 14. If Docker or hosted credentials are unavailable, preserve the source-complete evidence and mark only those environment-dependent executions `EXTERNAL`.

### Exit criteria

Every backlog item is either verified `DONE` with evidence or explicitly `EXTERNAL` with the missing environment prerequisite documented. then tell me about the status after finishing the implementation.

## Execution order

```text
0  Consolidate backlog
1  Schema, types, and API contracts
2  Membership, invitations, and contributors
3  Honest server states
4  Full issue creation and editing
5  Realtime issue consistency
6  Notifications and preferences
7  Project and workflow administration
8  Restricted security issues
9  Queue, search, saved views, triage, and commands
10 Templates, custom fields, attachments, tokens, and API DX
11 Reports, readiness, dashboard, and audit explorer
12 Mentions and account management
13 GitHub operational visibility
14 Integration and browser verification
15 Hosted validation and documentation closure
```

This order fixes contract and multi-user foundations first, completes the primary issue workflow next, then builds advanced product and operational surfaces on verified authorization and data contracts.

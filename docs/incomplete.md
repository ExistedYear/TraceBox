# TraceBox Incomplete Features and UI Gaps

This document is the result of a whole-codebase completeness audit. Every current database migration, consolidated schema, database type file, API route, server page, client component, hook, validation module, test file, CI workflow, and project Markdown document was compared with both `docs/plan.md` and `docs/tracebox-main-plan.md`.

The audit asks a stricter question than “does a table or RPC exist?” A capability is complete only when a user can discover it, configure it, execute it, recover from failure, and observe its result through a safe product workflow.

## Current summary

```text
Roadmap phases represented in source: 1–20
Database migrations inspected:         001–040
Backend/schema coverage:              broad
Frontend feature coverage:            partial
Multi-contributor usability:          incomplete
Automated tests:                      synthetic-heavy; no DB/browser/RLS suite committed
Production validation:                pending external Supabase/Vercel setup
```

The repository contains substantial implementation for every roadmap phase, but the “Phase 1–20 complete” wording in the roadmap means source implementation exists. It does not mean every planned UI surface, integration workflow, test layer, or production operation is complete.

## Critical gaps

### 1. Contributor invitation and member administration are absent

The database has `organization_members` and `project_members` with organization/project roles, but no complete product workflow exists for:

- inviting a person;
- accepting an invitation;
- adding an existing user to a workspace;
- adding a workspace member to a project;
- changing organization roles;
- changing project roles;
- removing project access;
- removing workspace access;
- transferring ownership;
- showing pending invitations or membership history.

Evidence:

- `supabase/migrations/202608260002_create_organizations_projects.sql:16-47,200-272`
- `src/app/(dashboard)/dashboard/settings/page.tsx:42-62` only reads member rows.
- `src/components/settings/project-settings.tsx:500-510` has no members section.
- `src/components/layout/app-sidebar.tsx:14-18,39-40` has no member-management route.

Current consequence: a second contributor requires administrator SQL intervention before they can collaborate.

Priority: **Critical**.

### 2. Workflow configuration is read-only

Default workflow creation exists, but the project UI does not let maintainers manage workflow configuration. Missing controls include:

- add/edit/delete states;
- reorder states;
- set initial/terminal flags;
- add/edit/delete transitions;
- configure transition required roles;
- validate workflow changes before publishing.

Evidence:

- `supabase/migrations/202608260003_create_components_workflow.sql`
- `src/components/settings/project-settings.tsx:744-777`

Priority: **High**.

### 3. Issue editing is incomplete

The product can edit several queue fields, but does not expose a complete issue edit journey. Missing or inaccessible fields include:

- title;
- description;
- environment;
- steps to reproduce;
- expected behavior;
- actual behavior;
- reporter-owned edits;
- a dedicated detail-page edit mode.

Evidence:

- `src/components/issues/issue-table.tsx` edits priority, severity, type, component, and assignee.
- `src/app/(dashboard)/dashboard/issues/[issueKey]/page.tsx` renders issue body fields read-only.
- `supabase/migrations/202608260005_update_issue_fields.sql` and later redeclarations do not provide a complete body-field update contract.
- `src/app/api/v1/issues/[issueKey]/route.ts` accepts a broader PATCH surface than the underlying RPC reliably updates.

The plan explicitly includes “Edit own issue”; that journey is incomplete.

Priority: **High**.

### 4. Issue realtime exists but has no consumer

`useRealtimeIssueUpdates` is defined in `src/hooks/use-realtime.ts:118-125`, but no current page consumes it. A second contributor changing status, assignment, priority, severity, or another issue field does not update another user’s open queue/detail view without a refresh.

Priority: **High**.

### 5. Notification preferences have no UI

The backend stores and checks notification preferences, but there is no user-facing settings workflow for mentions, assignments, comments, status changes, watcher updates, email preferences, or digests.

Evidence:

- `supabase/migrations/202608260017_phase8_watchers_notifications.sql:29-79`
- `supabase/migrations/202608260022_audit_refinements.sql:68-80`
- No `notification_preferences` caller under the application UI.

Priority: **High**.

### 6. Server data errors are frequently rendered as empty data

Dashboard, reports, readiness, settings, triage, and issue-detail pages commonly discard query errors or break pagination and continue rendering. A database outage, RLS error, missing migration, or network failure can look like a valid empty project.

Evidence:

- `src/app/(dashboard)/dashboard/page.tsx`
- `src/app/(dashboard)/dashboard/reports/page.tsx`
- `src/app/(dashboard)/dashboard/readiness/page.tsx`
- `src/app/(dashboard)/dashboard/settings/page.tsx`
- `src/app/(dashboard)/dashboard/triage/page.tsx`
- `src/app/(dashboard)/dashboard/issues/[issueKey]/page.tsx`

Required behavior: explicit error state, safe message, retry path, and no misleading zero metrics.

Priority: **High**.

## High and medium UI completeness gaps

### 7. Notification center is not a full inbox

Current behavior:

- latest 20 notifications only;
- unread count derived from that limited slice;
- no full notifications route;
- no pagination/infinite scrolling;
- no robust initial loading/error/retry state.

The backend exposes an exact unread-count RPC that the UI does not use.

Evidence: `src/components/layout/notification-center.tsx:75-105`, `supabase/migrations/202608260017_phase8_watchers_notifications.sql`.

Priority: **High**.

### 8. Restricted issue UI is incomplete

Existing functionality includes visibility changes and explicit grants on issue detail. Missing:

- restricted visibility during issue creation;
- initial access grants during creation;
- restricted indicators in the queue;
- restricted filters/search affordances;
- access history;
- dedicated security issue queue;
- reporter-facing controls where backend permissions allow them.

Evidence:

- `src/components/issues/issue-security-section.tsx`
- `src/app/(dashboard)/dashboard/issues/[issueKey]/page.tsx`
- `supabase/migrations/202608260027_phase18_restricted_issues.sql`

Priority: **Medium–High**.

### 9. Issue queue filters and columns are incomplete

Current filters cover status, priority, severity, type, component, assignee, and text. Missing planned filters include resolution, reporter, version, milestone, label, created date, and updated date. The queue also lacks a milestone column.

Evidence:

- `src/components/issues/issue-table.tsx`
- `src/lib/issues.ts`
- `docs/tracebox-main-plan.md:1618-1644`

There is also no bulk selection or bulk update workflow.

Priority: **Medium**.

### 10. Saved Views are only partially modeled

The current model uses `is_shared: boolean`; the plan describes `PRIVATE`, `PROJECT`, and `ORGANIZATION` visibility. Missing:

- organization sharing;
- rename/edit flow;
- filter update flow;
- full advanced-filter persistence;
- complete stable share URLs;
- clipboard failure feedback.

Evidence:

- `supabase/migrations/202608260018_phase10_search_saved_views.sql`
- `src/components/issues/saved-views-bar.tsx`
- `docs/tracebox-main-plan.md:1645-1666`

Priority: **Medium**.

### 11. Triage keyboard scope is narrower than the plan

Current shortcuts are J/K, A, R, D, and O. Planned P/S/C/E/Enter actions are not all mapped. Inline classification exists, but its keyboard workflow is incomplete. The plan’s meaning for `A` also needs one canonical definition because current behavior accepts an issue rather than assigning it.

Evidence:

- `src/components/triage/triage-inbox.tsx`
- `docs/tracebox-main-plan.md:1671-1692`

Priority: **Medium**.

### 12. Duplicate triage lacks a complete user-visible resolution flow

The database link RPC can perform duplicate resolution, and the triage UI can create a duplicate link. The UI does not clearly show the canonical issue, resulting resolution, activity entry, or post-resolution navigation. This needs one transactional, observable flow rather than relying on hidden RPC side effects.

Evidence:

- `src/components/triage/triage-inbox.tsx`
- `supabase/migrations/202608260019_phase11_issue_links.sql:77-82`

Priority: **Medium**.

### 13. Reports are summary metrics, not complete analytics

Existing reports include counts, MTTR, age buckets, status, component, and priority breakdowns. Missing:

- created-vs-resolved chart;
- backlog-over-time chart;
- resolution-duration chart;
- assignee breakdown;
- milestone breakdown;
- historical trends;
- metric drilldowns;
- export;
- explicit no-data state.

Evidence: `src/components/reports/reports-dashboard.tsx`, `src/app/(dashboard)/dashboard/reports/page.tsx`.

Priority: **Medium**.

### 14. Release readiness lacks several planned factors and authority

The readiness UI calculates a score and shows blockers, critical issues, regressions, and unassigned work. Missing or limited:

- unresolved security issue factor;
- overdue milestone factor;
- backend-authoritative score;
- persisted score snapshots;
- score history;
- export;
- comprehensive drilldowns;
- non-misleading empty-project semantics.

An empty project currently appears release-ready instead of “no release data.”

Evidence: `src/components/readiness/readiness-dashboard.tsx`, `src/app/(dashboard)/dashboard/readiness/page.tsx`.

Priority: **Medium**.

### 15. Issue templates omit configurable defaults

The database supports default priority, severity, and component. The manager exposes only name, description, type, and body. Missing:

- default priority;
- default severity;
- default component;
- default labels;
- preview;
- archive/restore;
- duplicate template.

Evidence:

- `supabase/migrations/202608260026_phase17_issue_templates.sql`
- `src/components/settings/issue-templates-manager.tsx`
- `src/components/issues/new-issue-form.tsx`

Priority: **Medium**.

### 16. Custom-field lifecycle is incomplete

Existing functionality covers field creation/deletion and issue-value editing. Missing:

- field rename/type edit;
- configuration/options editor;
- complete requiredness UI;
- custom fields during issue creation;
- queue filters/columns;
- bulk updates;
- consistent clear/reset UX.

Evidence:

- `src/components/settings/custom-fields-manager.tsx`
- `src/components/issues/issue-custom-fields-section.tsx`
- `supabase/migrations/202608260029_phase20_custom_fields_api.sql`
- `supabase/migrations/202608260039_release_validation_fixes.sql`

Priority: **Medium**.

### 17. API-token management lacks lifecycle controls

Existing functionality covers creation, scopes, one-time plaintext display, and revocation. Missing:

- expiration input;
- expiration display;
- last-used display;
- rotation;
- usage history;
- API documentation/explorer;
- project-level token restrictions.

Evidence: `src/components/settings/custom-fields-manager.tsx`, `src/app/(dashboard)/dashboard/settings/custom-fields/page.tsx`, `supabase/migrations/202608260029_phase20_custom_fields_api.sql`.

Priority: **Medium**.

### 18. GitHub integration lacks operational UI depth

Repository connection, binding, manual links, signed webhooks, reconciliation, and GitHub App structures exist. Missing or limited:

- integration health/status;
- webhook delivery history;
- failed-delivery retry;
- rich PR/commit activity;
- CI/check status surface;
- merge-state timeline;
- visible automatic-resolution audit result;
- complete in-product GitHub App installation setup.

There are both legacy `project_integrations` and newer GitHub App/binding models, requiring a clear canonical path.

Evidence:

- `src/components/settings/github-integration-manager.tsx`
- `src/app/(dashboard)/dashboard/settings/integrations/page.tsx`
- `src/app/api/github/**`
- `src/app/api/webhooks/github/route.ts`
- migrations `028`, `033`, `039`, `040`

Priority: **Medium**.

### 19. Attachments are happy-path focused

Existing functionality covers private upload/download/preview/delete and size checks. Missing or limited:

- true drag-and-drop dropzone;
- multi-file upload;
- progress;
- retry;
- complete MIME allowlist enforcement;
- orphaned-object reconciliation;
- clear Storage-delete failure handling.

Evidence:

- `src/components/issues/issue-attachments-section.tsx`
- `supabase/migrations/202608260031_api_storage_hardening.sql`
- `docs/tracebox-main-plan.md:2577-2587`

Priority: **Medium**.

### 20. Dashboard overview omits planned operational cards

Current overview shows open, in-progress, critical, total, recent issues, and projects. Missing or limited:

- assigned-to-me issues;
- awaiting-triage card;
- due milestones;
- operational drilldowns;
- clickable metric filters.

Evidence:

- `src/app/(dashboard)/dashboard/page.tsx`
- `src/components/tracebox/dashboard-overview.tsx`
- `docs/tracebox-main-plan.md:1858-1865`

Priority: **Medium**.

## Database and type completeness gaps

### 21. Generated database types are stale against the latest GitHub App schema

`src/types/database.ts` does not fully represent the latest migration additions, including GitHub App tables/fields and newer RPCs. Current GitHub integration code uses `any` casts to mask this drift.

Reported missing or incomplete items include:

- `github_installations`;
- `github_repositories`;
- `project_github_repositories`;
- `github_artifacts`;
- `github_webhook_deliveries`;
- newer GitHub fields on issue links;
- GitHub App RPCs;
- webhook delivery/artifact operations.

Evidence:

- `supabase/migrations/202608260040_github_app_integration.sql`
- `src/types/database.ts`
- `src/app/(dashboard)/dashboard/settings/integrations/page.tsx`
- `src/app/api/github/**`

Priority: **High engineering hygiene issue**.

Regenerate types from the actual target database after migration application, then remove avoidable `any` casts.

### 22. Membership tables have no safe product mutation contract

RLS and select policies exist, but membership mutations are not exposed through safe, tested RPCs. Direct protected-table writes are intentionally unavailable to browser clients, leaving administration as manual SQL.

This is both a UI gap and a backend product-contract gap.

### 23. Notification event coverage is narrower than the declared notification model

The schema/preferences mention assignment, comments, mentions, status changes, links, milestone changes, and watched updates. Current lifecycle triggers cover only parts of that set. Label, planning, link, and milestone changes do not consistently notify watchers.

Evidence:

- `supabase/migrations/202608260017_phase8_watchers_notifications.sql`
- `supabase/migrations/202608260036_notification_lifecycle.sql`
- `supabase/migrations/202608260037_restricted_notification_guards.sql`

Priority: **Medium**.

## Tests and CI completeness gaps

### 24. Tests are mostly synthetic and can pass while production wiring is broken

`tests/phase12-20-features.test.ts` reimplements logic locally instead of importing the production scoring, filtering, permission, or API code. Similar issues exist in:

- `tests/issue-links.test.ts` — self-link test is tautological and duplicate scoring is local;
- `tests/realtime.test.ts` — synthetic payload/channel test, no hook rendering;
- `tests/integration-phase1-5.test.ts` — schema/helper composition rather than integration tests.

Priority: **High verification gap**.

### 25. Missing database/RLS integration tests

No committed pgTAP or equivalent database test suite verifies:

- cross-organization reads;
- restricted issue visibility;
- issue-access grants/revocation;
- Storage policies;
- API-token scopes;
- mutation RPC authorization;
- issue-number concurrency;
- archived-project guards;
- webhook service-role boundaries.

### 26. Missing browser end-to-end tests in the repository

Documentation references `qa/live/`, but the current checkout does not contain a committed `qa/` directory. The documented hosted checks therefore cannot be run from a fresh clone without additional local-only files/credentials.

### 27. CI does not execute SQL or browser/security integration checks

`.github/workflows/ci.yml` runs JavaScript lint/typecheck/tests/build and migration-file consistency, but does not execute:

- migrations against a disposable Postgres/Supabase database;
- RLS denial tests;
- Storage policy tests;
- API handler tests;
- webhook signature/idempotency tests;
- browser journeys.

The migration consistency check proves file ordering and bundle synchronization, not SQL validity or runtime behavior.

### 28. CI documentation and scripts need one canonical migration workflow

The repository contains `check:migrations` and newer synchronization wording. The documented workflow should clearly distinguish:

```text
check:migrations → verify only
sync:migrations  → regenerate bundle, if present
supabase db reset → execute migrations locally
```

Avoid telling users that a check command applies migrations.

## Documentation and deployment gaps

### 29. “Phase 1–20 complete” needs qualification

The roadmap and README describe Phases 1–20 as complete, while this document records significant partial UI and testing gaps. The accurate wording should be:

```text
Roadmap implementation present through Phase 20;
full UI, integration, test, and production validation still pending in listed areas.
```

### 30. Deployment is still externally pending

The source contains the required configuration guidance, but these steps remain environment-dependent:

- apply migrations `001`–`040` to the intended Supabase project;
- regenerate database types from the applied schema;
- verify Storage bucket/policies;
- verify Realtime publication;
- configure Auth URLs and password recovery;
- set Vercel public and server-only environment variables;
- configure GitHub App/webhook credentials;
- run live multi-user/RLS/API/browser checks.

### 31. Known product limitations remain documented

`docs/bugs.md` still records product limitations such as password recovery history and provider setup requirements. Those should remain explicit until the corresponding product workflows are verified in the deployed environment.

## Phase summary

| Phase | Completeness status |
|---|---|
| 1 — Organizations and Projects | Partial: no invite/member administration |
| 2 — Components and Workflow | Partial: workflow viewer, not full editor |
| 3 — Core Issue Creation | Partial: visibility/planning and full edit journey incomplete |
| 4 — Issue List and Editing | Partial: filters, columns, bulk actions, and body editing incomplete |
| 5 — Comments and Activity | Mostly implemented; mention autocomplete and stronger integration tests missing |
| 6 — Assignment and Workflow | Mostly implemented; dedicated edit/admin surfaces incomplete |
| 7 — Planning | Implemented at detail/settings level; queue/drilldowns incomplete |
| 8 — Watchers and Notifications | Partial: preferences, full inbox, and event breadth incomplete |
| 9 — Realtime | Partial: issue updates have no consumer |
| 10 — Search and Saved Views | Partial: advanced filters and visibility model incomplete |
| 11 — Dependencies and Duplicates | Partial: richer duplicate-resolution UX incomplete |
| 12 — Triage Inbox | Partial: keyboard/action contract and canonical resolution UX incomplete |
| 13 — Attachments | Happy path implemented; failure recovery/MIME/progress incomplete |
| 14 — Reports | Partial: historical charts, drilldowns, and export incomplete |
| 15 — Release Readiness | Partial: risk factors, persistence, and empty-state semantics incomplete |
| 16 — Command Palette | Partial: My Issues, notifications, and quick status actions incomplete |
| 17 — Issue Templates | Partial: default configuration and lifecycle controls incomplete |
| 18 — Restricted Security Issues | Partial: creation, indicators, search, and access history incomplete |
| 19 — GitHub Integration | Partial: operational health, delivery history, and canonical model incomplete |
| 20 — Custom Fields and Public API | Partial: field lifecycle, issue-create/list integration, token lifecycle, and API docs incomplete |

## Recommended implementation order

1. Add safe membership/invitation RPCs and workspace/project member screens.
2. Add explicit server error/loading/retry states everywhere.
3. Complete issue edit UI and API contract alignment.
4. Consume realtime issue changes in queue/detail views.
5. Add notification preferences and a full notification inbox.
6. Complete workflow state/transition administration.
7. Complete restricted issue creation and access UX.
8. Regenerate database types and remove GitHub integration `any` casts.
9. Add database/RLS/Storage/API/webhook integration tests.
10. Complete custom-field, template-default, advanced-search, and saved-view workflows.
11. Add GitHub integration health and webhook observability.
12. Run the complete live multi-user deployment flow.

## Audit scope and confidence

This is a source-level completeness audit. It covers the current repository contents and compares implementation surfaces with both plan files. It does not claim that Supabase migrations, Storage, Realtime, Vercel, GitHub App credentials, or production browser flows have been executed successfully until the external deployment checklist is run.

## Whole-codebase audit addendum

The following findings were identified by auditing the current post-release-validation and GitHub App changes. They are additional to the phase matrix above.

### 32. Generated database types are stale against the GitHub App schema

Migration `202608260040_github_app_integration.sql` adds GitHub App tables, artifacts, webhook deliveries, issue-link fields, and RPCs. `src/types/database.ts` does not represent the complete latest catalog. GitHub integration pages and routes compensate with `any` casts.

Affected capabilities include:

- `github_installations`;
- `github_repositories`;
- `project_github_repositories`;
- `github_artifacts`;
- `github_webhook_deliveries`;
- GitHub artifact fields on issue links;
- App installation, repository binding, reconciliation, and webhook RPCs.

Evidence:

- `supabase/migrations/202608260040_github_app_integration.sql`
- `src/types/database.ts`
- `src/app/(dashboard)/dashboard/settings/integrations/page.tsx`
- `src/app/api/github/**`

Priority: **High engineering completeness issue**.

Regenerate types from the applied database and remove avoidable casts.

### 33. API token scope contract requires verification

The latest UI exposes token scope presets while the final database scope constraint must allow every scope the UI/API uses. The audit found potential divergence between `api_tokens_scopes_check` and newer GitHub/integration/API scopes. Verify the final applied constraint and type/API contract together before allowing token creation.

Evidence:

- `supabase/migrations/202608260039_release_validation_fixes.sql`
- `supabase/migrations/202608260040_github_app_integration.sql`
- `src/components/settings/custom-fields-manager.tsx`
- `src/lib/api-auth.ts`

Priority: **High** if the deployed constraint rejects a visible preset.

### 34. Public API PATCH contract is broader than the database mutation contract

The issue PATCH route accepts fields such as `description`, but the final issue update RPC historically handles only title, priority, severity, type, component, and assignee. Unsupported fields can therefore be accepted by the HTTP boundary and silently ignored by the database layer.

Evidence:

- `src/app/api/v1/issues/[issueKey]/route.ts`
- `supabase/migrations/202608260010_normalize_issue_updates.sql`
- `supabase/migrations/202608260039_release_validation_fixes.sql`

Priority: **High contract-integrity issue**.

Either implement the body-field mutation fully or reject unsupported fields explicitly.

### 35. GitHub webhook delivery data has limited product visibility

The GitHub App schema stores durable webhook deliveries and processing state, but there is no user-facing delivery history, failure detail, retry, or integration-health screen. The data is effectively backend-only operational state.

Evidence:

- `supabase/migrations/202608260040_github_app_integration.sql:116-165`
- `src/app/api/github/reconcile/**`
- `src/app/api/webhooks/github/route.ts`
- `src/app/(dashboard)/dashboard/settings/integrations/page.tsx`

Priority: **Medium**.

### 36. Notification lifecycle coverage is narrower than the declared model

The notification schema and preferences describe watched updates, links, milestone changes, mentions, assignments, comments, and status changes. Actual lifecycle triggers do not consistently emit notifications for all of those events. Users also cannot configure notification preferences in the product.

Evidence:

- `supabase/migrations/202608260017_phase8_watchers_notifications.sql`
- `supabase/migrations/202608260036_notification_lifecycle.sql`
- `supabase/migrations/202608260037_restricted_notification_guards.sql`
- `src/components/layout/notification-center.tsx`

Priority: **Medium**.

### 37. Plan schema and implementation schema diverge in several places

The database target schema in `docs/tracebox-main-plan.md` describes capabilities that differ from the final migrations:

- planned profile `username` is absent from the implemented profile table;
- planned saved-view `owner_id`, nullable project scope, and three visibility values are represented by `created_by`, required project scope, and `is_shared`;
- planned notification email preference columns are absent from the final preference table;
- planned generic integration `secret_reference` is not represented by the legacy integration table;
- the final issue visibility model includes `PUBLIC` in addition to the plan’s `PROJECT` and `RESTRICTED`;
- `supabase/seed.sql` is intentionally empty despite plan language describing seed/demo data.

Evidence:

- `docs/tracebox-main-plan.md:236-251,699-840`
- migrations `001`, `017`, `018`, `028`, `030`
- `supabase/seed.sql`

Priority: **Medium documentation/schema-contract issue**.

Each divergence should be explicitly accepted, removed from the plan, or implemented.

### 38. Tests do not exercise the real database or browser integration

The current tests are primarily pure synthetic tests. They do not execute:

- RLS denial cases;
- migration replay;
- RPC authorization;
- issue-number concurrency;
- Storage policies;
- restricted issue access;
- API bearer scopes;
- webhook HMAC/idempotency;
- realtime hook lifecycle;
- multi-user browser journeys.

Specific weaknesses:

- `tests/phase12-20-features.test.ts` reimplements production algorithms locally;
- `tests/issue-links.test.ts` includes a tautological self-link assertion;
- `tests/realtime.test.ts` does not render or invoke the realtime hook;
- `tests/integration-phase1-5.test.ts` is structural rather than an integration test.

Priority: **High verification gap**.

### 39. Documented `qa/live` suite is not available in a fresh checkout

README, handoff, and deployment documentation refer to an ignored local `qa/live/` Playwright suite, but the repository does not contain the suite/configuration. A fresh clone cannot run the documented hosted checks without separately recreating local files and credentials.

Evidence:

- `README.md`
- `handoff.md`
- `deployment.md`
- `.gitignore`

Priority: **Medium**.

### 40. CI validates JavaScript and file consistency, not database behavior

`.github/workflows/ci.yml` runs lint, typecheck, Vitest, build, migration ordering, and schema-bundle consistency. It does not run migrations against disposable Postgres/Supabase, pgTAP/RLS tests, Storage-policy tests, API handler tests, webhook tests, or browser E2E.

`git diff --check` in CI checks the clean checkout rather than the proposed patch, so it does not meaningfully validate committed diff whitespace.

Priority: **Medium verification gap**.

### 41. Deployment documentation has operational ambiguity

The deployment guide needs to distinguish:

- public Supabase variables versus server-only service-role/webhook variables;
- test-only email confirmation settings versus the confirmed-email signup path;
- migration tracking repair versus destructive schema reset;
- `check:migrations` verification versus `sync:migrations` regeneration;
- API PATCH and all current API routes;
- current migration count through `040`.

Do not clear migration history and replay the full schema against an existing populated database without a backup and a deliberate baseline plan.

Priority: **Medium**.

## Updated priority order

1. Build safe member invitation and role-management workflows.
2. Regenerate database types from the final migration 040 schema.
3. Align API PATCH fields with actual RPC behavior.
4. Add explicit server loading/error/retry states.
5. Add a realtime issue-update consumer.
6. Add notification preferences and a full notification inbox.
7. Complete workflow administration.
8. Complete restricted-issue creation and list indicators.
9. Align API-token scope constraints with every visible preset.
10. Add database/RLS/Storage/API/webhook integration tests.
11. Add or document the actual hosted QA suite.
12. Complete advanced search, saved views, templates, custom fields, reports, readiness, and GitHub observability.

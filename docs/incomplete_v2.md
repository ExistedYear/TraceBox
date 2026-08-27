# TraceBox Incomplete Features and UI Gaps

This document records product capabilities that are implemented only partially, exist in the database/backend without a complete UI, or require manual external setup. It was produced from a source audit against both `docs/plan.md` and `docs/tracebox-main-plan.md`.

## Executive Summary

```text
Roadmap phases represented in source: 1–20
Backend/schema coverage:              broad
Frontend feature completeness:       partial
Multi-contributor usability:          incomplete
Most important gap:                   no invite/member-management workflow
```

The existence of an RPC, table, or route is not treated as complete product functionality unless a user can reach it through a safe, understandable workflow.

## Critical and high-priority gaps

### 1. Contributor invitation and member management are absent

Evidence:

- Organization and project membership tables are defined in `supabase/migrations/202608260002_create_organizations_projects.sql`.
- Membership rows are created during organization/project creation, but no complete invite, join, add-member, remove-member, role-change, or ownership-transfer RPC/UI was found.
- `src/app/(dashboard)/dashboard/settings/page.tsx` reads members mainly for assignee options.
- `src/components/settings/project-settings.tsx` has no members tab.
- The sidebar exposes no workspace/member administration route.

Missing workflow:

```text
Workspace settings → Members → Invite user → Assign organization role
Project settings   → Members → Add user → Assign project role → Remove access
```

Current consequence: a second contributor requires manual Supabase SQL membership inserts before they can use the project.

Priority: **Critical product gap**.

### 2. Project settings and workflow configuration are incomplete

The backend contains project metadata, workflow states, transitions, role requirements, and archive state. The UI has components, labels, versions, milestones, and a workflow viewer, but does not provide a complete editor for:

- project name/description/key settings;
- project archive/restore;
- workflow state creation/editing/deletion;
- state ordering;
- initial/terminal state changes;
- transition creation/deletion;
- transition required-role configuration;
- project-level member management.

Evidence:

- `src/components/settings/project-settings.tsx:500-777`
- `src/app/(dashboard)/dashboard/settings/page.tsx:42-51`
- `supabase/migrations/202608260003_create_components_workflow.sql`

Priority: **High**.

### 3. Issue editing is incomplete in the frontend

The issue update backend supports fields that do not have a complete browser workflow. The table currently edits priority, severity, type, component, and assignee. Missing or inaccessible editing includes:

- title;
- description;
- environment;
- steps to reproduce;
- expected behavior;
- actual behavior;
- reporter-owned issue editing;
- a dedicated issue edit form on issue detail.

Evidence:

- `supabase/migrations/202608260005_update_issue_fields.sql`
- `src/components/issues/issue-table.tsx`
- `src/app/(dashboard)/dashboard/issues/[issueKey]/page.tsx`

The plan explicitly includes “Edit own issue”; the current UI does not deliver that complete journey.

Priority: **High**.

### 4. Realtime issue updates have no consumer

`useRealtimeIssueUpdates` exists in `src/hooks/use-realtime.ts`, but no current page/component consumes it. Comments, attachments, and notifications have realtime consumers, but status, assignment, and issue-field changes made by another contributor do not update open issue pages or queues automatically.

Evidence:

- `src/hooks/use-realtime.ts:118-125`
- No consumer under `src/app` or `src/components`.

Priority: **High**.

### 5. Notification preferences have no UI

The backend provides `notification_preferences` storage, RLS, and preference-aware dispatching, but users cannot configure those preferences in the application.

Missing controls:

- mentions;
- assignments;
- comments;
- status changes;
- watcher updates;
- email mentions;
- email assignments;
- email digest.

Evidence:

- `supabase/migrations/202608260017_phase8_watchers_notifications.sql:29-79`
- `supabase/migrations/202608260022_audit_refinements.sql:68-80`
- `src/components/layout/notification-center.tsx`

Priority: **High**.

### 6. Server query failures often look like empty data

Several pages discard query errors and render zero or empty states instead of explaining the failure and offering retry:

- `src/app/(dashboard)/dashboard/page.tsx`
- `src/app/(dashboard)/dashboard/reports/page.tsx`
- `src/app/(dashboard)/dashboard/readiness/page.tsx`
- `src/app/(dashboard)/dashboard/settings/page.tsx`
- `src/app/(dashboard)/dashboard/triage/page.tsx`
- `src/app/(dashboard)/dashboard/issues/[issueKey]/page.tsx`

A database outage, RLS problem, missing migration, or network failure can appear as:

```text
No issues
No members
No notifications
No reports
No linked items
```

Priority: **High**.

### 7. Notification center is not a full inbox

The notification dropdown:

- loads only the latest 20 records;
- derives unread count from that limited slice;
- has no full notifications route;
- has no pagination/infinite scroll;
- has limited loading/error/retry handling.

The backend exposes an exact unread-count function that the UI does not use.

Evidence:

- `src/components/layout/notification-center.tsx:75-105`
- `supabase/migrations/202608260017_phase8_watchers_notifications.sql`

Priority: **High**.

## Medium-priority completeness gaps

### 8. Restricted security issue workflow is incomplete

Existing functionality:

- restricted visibility setting;
- explicit access grants;
- access revocation;
- RLS enforcement.

Missing or partial functionality:

- restricted visibility during issue creation;
- initial access grants during creation;
- clear restricted indicator in issue lists;
- restricted issue filters;
- access history display;
- reporter-facing security controls;
- dedicated security issue queue.

Evidence:

- `src/components/issues/issue-security-section.tsx`
- `src/app/(dashboard)/dashboard/issues/[issueKey]/page.tsx`
- `supabase/migrations/202608260027_phase18_restricted_issues.sql`

Priority: **Medium–High**.

### 9. Issue queue lacks planned columns and filters

Current filters cover status, priority, severity, type, component, assignee, and text. Missing planned filters include:

- resolution;
- reporter;
- version;
- milestone;
- label;
- created date;
- updated date.

The queue also lacks a milestone column despite milestone associations existing in the database and issue detail UI.

Evidence:

- `src/components/issues/issue-table.tsx`
- `src/lib/issues.ts`
- `docs/tracebox-main-plan.md:1618-1644`

Priority: **Medium**.

### 10. Saved Views are only partially modeled

The current implementation uses a boolean `is_shared`, while the plan describes:

```text
PRIVATE
PROJECT
ORGANIZATION
```

Missing functionality:

- organization-level sharing;
- rename/edit saved views;
- update saved-view filters;
- full persistence of advanced filters;
- complete stable share URLs.

Evidence:

- `supabase/migrations/202608260018_phase10_search_saved_views.sql`
- `src/components/issues/saved-views-bar.tsx`
- `docs/tracebox-main-plan.md:1645-1666`

Priority: **Medium**.

### 11. Triage keyboard behavior is narrower than the plan

Current shortcuts:

```text
J/K → navigate
A   → accept
R   → reject
D   → duplicate
O   → open
```

The plan also calls for keyboard actions for priority, severity, component, edit, and Enter-to-open behavior. Inline classification controls exist, but equivalent keyboard actions are not complete.

Evidence:

- `src/components/triage/triage-inbox.tsx`
- `docs/tracebox-main-plan.md:1671-1692`

Priority: **Medium**.

### 12. Reports are summary metrics rather than complete analytics

Existing reports provide counts, MTTR, age buckets, status, component, and priority breakdowns.

Missing or limited:

- created-vs-resolved chart;
- backlog-over-time chart;
- resolution-duration chart;
- assignee breakdown;
- milestone breakdown;
- historical trends;
- metric drilldowns;
- clear no-data state.

Evidence:

- `src/components/reports/reports-dashboard.tsx`
- `src/app/(dashboard)/dashboard/reports/page.tsx`

Priority: **Medium**.

### 13. Release readiness is a frontend calculation with missing factors

The readiness screen provides milestone/version filtering, blocker detection, critical issue detection, regression detection, unassigned work detection, and an explainable score.

Missing or limited:

- backend-authoritative score;
- persisted readiness snapshots;
- unresolved security-issue factor;
- overdue-milestone factor;
- score history;
- readiness export;
- comprehensive drilldowns;
- a non-misleading empty-project state.

An empty project currently appears fully release-ready rather than “no data available.”

Evidence:

- `src/components/readiness/readiness-dashboard.tsx`
- `src/app/(dashboard)/dashboard/readiness/page.tsx`

Priority: **Medium**.

### 14. Issue templates do not expose configurable defaults

The database supports default priority, severity, and component. The template manager currently exposes only:

- name;
- description;
- issue type;
- body template.

Missing:

- default priority control;
- default severity control;
- default component control;
- default labels;
- template preview;
- template archive/restore;
- template duplication.

Evidence:

- `supabase/migrations/202608260026_phase17_issue_templates.sql`
- `src/components/settings/issue-templates-manager.tsx`
- `src/components/issues/new-issue-form.tsx`

Priority: **Medium**.

### 15. Custom field lifecycle is incomplete

Existing functionality includes field creation/deletion and issue-value editing.

Missing or limited:

- edit field name/type;
- edit field configuration;
- select-option management;
- complete requiredness controls;
- custom fields during issue creation;
- custom-field queue filters;
- custom-field table columns;
- bulk value updates;
- consistent clear/reset behavior.

Evidence:

- `src/components/settings/custom-fields-manager.tsx`
- `src/components/issues/issue-custom-fields-section.tsx`
- `supabase/migrations/202608260029_phase20_custom_fields_api.sql`

Priority: **Medium**.

### 16. API-token management is incomplete

Existing functionality:

- token creation;
- read/write scope selection;
- token revocation;
- plaintext shown once.

Missing:

- expiration-date control;
- expiration display;
- last-used display;
- token rotation;
- usage history;
- API documentation/explorer;
- project-level token restrictions.

Priority: **Medium**.

### 17. GitHub integration lacks operational UI depth

Existing functionality:

- repository configuration;
- repository binding;
- manual PR/commit/branch links;
- signed webhook ingestion;
- reconciliation support.

Missing or limited:

- integration health/status view;
- webhook delivery history;
- failed-delivery retry;
- rich PR/commit activity surface;
- merge-state timeline;
- visible automatic-resolution audit result;
- complete GitHub App installation workflow inside the product.

The manual issue-link form also asks for repository and URL text even when a configured repository exists.

Priority: **Medium**.

### 18. Attachment lifecycle is happy-path focused

Existing functionality:

- upload;
- 50MB size limit;
- private signed URLs;
- image preview;
- download;
- metadata deletion;
- attempted Storage cleanup.

Missing or limited:

- true drag-and-drop dropzone;
- upload progress;
- multi-file upload;
- retry support;
- orphaned-object reconciliation;
- full MIME allowlist enforcement;
- clear handling when Storage deletion fails.

Evidence:

- `src/components/issues/issue-attachments-section.tsx`
- `supabase/migrations/202608260031_api_storage_hardening.sql`
- `docs/tracebox-main-plan.md:2577-2587`

Priority: **Medium**.

### 19. Dashboard overview omits operational cards

Current overview includes open, in-progress, critical, total, and recent issues.

Missing planned views:

- issues assigned to me;
- awaiting triage;
- due milestones;
- operational drilldowns.

Evidence:

- `src/app/(dashboard)/dashboard/page.tsx`
- `src/components/tracebox/dashboard-overview.tsx`
- `docs/tracebox-main-plan.md:1858-1865`

Priority: **Medium**.

## Lower-priority and architectural gaps

### 20. No standalone audit-history view

Audit events are rendered inside the issue activity timeline, but there is no dedicated audit explorer, event filtering, export, or project-wide audit view.

### 21. Mention support is styling-only

Mentions are tokenized and styled, but there is no mention autocomplete, member picker, or robust identity resolution UX.

### 22. User account management is minimal

The user menu currently ends at logout. There is no complete profile page for changing display name, avatar, password, or personal notification settings.

### 23. API developer experience is limited

The API exists as an external contract, but there is no in-product API documentation, token usage guide, request explorer, rate-limit display, or expanded resource documentation.

### 24. Foundation deployment status content is historical

`docs/plan.md` contains a foundation/deployment checklist. It should be treated as historical infrastructure guidance; current implementation and external setup are documented in `deployment.md` and `handoff.md`.

## Phase summary

| Phase | UI/completeness status |
|---|---|
| 1 — Organizations and Projects | Partial: no invitation/member administration |
| 2 — Components and Workflow | Partial: workflow viewer, not full editor |
| 3 — Core Issue Creation | Partial: planning/visibility fields are post-creation only |
| 4 — Issue List and Editing | Partial: incomplete edit/filter/column coverage |
| 5 — Comments and Activity | Implemented; mention autocomplete missing |
| 6 — Assignment and Workflow | Implemented; some dedicated editors missing |
| 7 — Planning | Implemented; queue filters and drilldowns incomplete |
| 8 — Watchers and Notifications | Partial: preferences/full inbox/event breadth missing |
| 9 — Realtime | Partial: issue-update hook has no consumer |
| 10 — Search and Saved Views | Partial: advanced search and visibility model incomplete |
| 11 — Dependencies and Duplicates | Partial: richer duplicate workflow missing |
| 12 — Triage Inbox | Partial: planned shortcut/action coverage incomplete |
| 13 — Attachments | Happy path implemented; failure recovery/MIME enforcement incomplete |
| 14 — Reports and Analytics | Partial: historical charts and drilldowns missing |
| 15 — Release Readiness | Partial: missing factors and backend authority |
| 16 — Command Palette and Keyboard UX | Partial: My Issues and quick actions missing |
| 17 — Issue Templates | Partial: default configuration UI missing |
| 18 — Restricted Security Issues | Partial: creation/listing/indicators incomplete |
| 19 — GitHub Integration | Partial: health/sync/install UX incomplete |
| 20 — Custom Fields and Public API | Partial: field lifecycle, API docs, expiry, and broader UI integration incomplete |

## Recommended implementation order

1. Add workspace/project member administration and invitation flow.
2. Add explicit loading/error/retry states to all server-fed screens.
3. Add complete issue editing UI.
4. Consume realtime issue updates.
5. Add notification preferences and a full notification inbox.
6. Add a real workflow editor.
7. Complete restricted issue creation, indicators, and access UX.
8. Complete custom-field configuration and issue-creation integration.
9. Complete advanced search and saved-view visibility.
10. Improve GitHub integration health, webhook observability, and synchronization UX.

## Audit scope note

This is a source-level completeness audit. It identifies product/UI gaps from the repository. It does not claim live Supabase/Vercel behavior until the external deployment and live end-to-end checklist in `deployment.md` has been executed.

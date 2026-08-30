# TraceBox Feature Testing Checklist

Use this as the submission QA sheet. Test with a Maintainer, Developer, Reporter, Viewer, and a user outside the workspace where applicable. Record evidence rather than marking a row from source inspection alone.

## Public, authentication, and account

- [ ] Landing, login, signup, forgot-password, and reset-password pages render on desktop and 375px mobile.
- [ ] Signup validates display name, email, password, and confirmation; duplicate/invalid accounts show safe errors.
- [ ] Email/password login, GitHub login when configured, logout, session refresh, expired-session redirect, and safe `next` redirects work.
- [ ] Email confirmation and GitHub OAuth callbacks carry refreshed session cookies and reach onboarding without a manual refresh or transient workspace error.
- [ ] Profile name/avatar changes persist; invalid avatar paths are rejected.
- [ ] Email/password updates, recovery, current-session logout, and global logout behave honestly.
- [ ] Light/dark mode and accent choice persist independently.

## Workspaces, projects, and contributors

- [ ] First user creates a workspace and first project; project receives components and the default workflow.
- [ ] Workspace/project switchers persist valid `tb_org`/`tb_project` cookies and reject stale or unauthorized selections.
- [ ] Additional workspace/project creation handles duplicate slug/key/name and archived-project states.
- [ ] Owner invites by email; wrong-account, expired, revoked, and already-used invitation states are safe.
- [ ] Invitation email delivery is attempted for workspace and project invitations; the single-use manual link remains available when delivery is unavailable.
- [ ] Admin publishes/unpublishes a workspace; Discover lists only public workspaces and joining grants MEMBER plus REPORTER without exposing restricted issues.
- [ ] Accepting a project invitation selects the invited workspace/project and lands on its issue queue.
- [ ] Maintainer adds an existing workspace member, changes project role, and removes access.
- [ ] Workspace role changes, removal, last-owner protection, and ownership transfer work and create audit history.
- [ ] Contributors show identity, organization/project roles, access state, pending invitations, and useful mutation failures.

## Project administration

- [ ] Project metadata saves; project key remains immutable.
- [ ] Archive blocks issue/component/planning mutations and Restore re-enables them.
- [ ] Components create/update/archive; default assignee must be eligible.
- [ ] Labels, versions, and milestones create/update/archive with validation and dense empty/error states.
- [ ] Workflow editor creates, renames, reorders, and deletes safe states/transitions.
- [ ] Workflow publication rejects multiple/no initial states, unreachable states, invalid roles, dangling edges, and deleting in-use states.

## Issue creation, queue, and editing

- [ ] Atomic issue creation allocates unique `KEY-N` values under repeated/concurrent submission.
- [ ] Required title/type/component/custom-field/template rules are enforced; optional component supports `None`.
- [ ] Template defaults, labels, watcher state, visibility, grants, assignee, planning values, and custom fields persist together.
- [ ] Duplicate suggestions load while typing and a failed check is distinguishable from a valid empty result.
- [ ] Queue search, status/category, priority, severity, type, visibility, component, assignee, reporter, resolution, version, milestone, label, and custom-field filters combine correctly.
- [ ] Sorting, pagination, exact result count/range, URL encoding, back/forward navigation, and saved-view links remain stable.
- [ ] Desktop inline edits and mobile cards remain usable; screen-reader labels identify the issue being edited.
- [ ] Bulk updates are permission-checked, bounded, atomic, clear selection after navigation, and report failures without partial writes.
- [ ] Full issue edits reject stale `updated_at`, preserve dirty drafts during Realtime updates, and allow intentional nullable-field clearing.

## Workflow, assignment, triage, and relationships

- [ ] Eligible assignment, component default assignment, self/unassigned states, and invalid/removed member denial work.
- [ ] Legal transitions, resolution-required transitions, reopen, illegal transition denial, and archived-project denial work.
- [ ] Triage J/K navigation and A/R/D actions ignore editable focus and match visible buttons.
- [ ] Duplicate resolution links to the canonical issue, resolves atomically, and records deterministic audit events.
- [ ] BLOCKS, DEPENDS_ON, RELATES_TO, DUPLICATE_OF, CAUSED_BY, and REGRESSION_OF links render in both directions.
- [ ] Self-links, duplicate links, invalid keys, unauthorized targets, and unlink attempts fail safely.

## Comments, mentions, activity, watchers, and notifications

- [ ] Comments add/edit with 1–10,000-character validation, safe GFM, code blocks, issue references, and XSS-like input.
- [ ] Mention autocomplete works by keyboard, persists stable identities, and does not style/notify arbitrary `@text`.
- [ ] Restricted mention candidates and notification recipients do not leak hidden users/issues.
- [ ] Unified issue events/comments remain chronological and Realtime additions do not duplicate entries.
- [ ] Watch/unwatch is idempotent; archived projects and invisible issues reject watcher mutations.
- [ ] Assignment, mention, comment, status, watched-update, link, label, planning, and milestone notifications honor preferences.
- [ ] Header count/preview and full cursor inbox agree; read-one/read-all and pagination are RPC-only and recover from failures.
- [ ] Losing restricted access removes/redacts rows and prevents notification links from revealing metadata.

## Attachments and restricted security issues

- [ ] Allowed attachment upload, 50MB limit, invalid type/name/path, interrupted upload, retry, preview/lightbox, signed download, and deletion work.
- [ ] Storage objects use `<issue-uuid>/<filename>` and cannot be fetched after project archive or visibility loss.
- [ ] Orphan reconciliation requires `CRON_SECRET` and preserves valid rows/objects.
- [ ] Restricted issue creation and reporter-owned visibility/grant editing are atomic.
- [ ] Security queue and main-queue indicator/filter show only authorized restricted issues.
- [ ] Grant/revoke history is immutable, table-triggered, and visible only to authorized users.
- [ ] Cross-user, cross-project, search, saved-view, attachment, comment, notification, API, Realtime, and report/readiness leak attempts fail.

## Reports, readiness, dashboard, and audit

- [ ] Overview metrics and drilldowns agree with the visible issue queue.
- [ ] Reports windows, created/resolved/backlog history, MTTR, age, assignee/component/priority/milestone breakdowns, drilldowns, and CSV export use authorized backend data.
- [ ] Historical trend exposes created/resolved/backlog values to assistive technology.
- [ ] Readiness score, factor explanations, blockers, scope filters, snapshots, history ownership, drilldowns, and export agree.
- [ ] Audit explorer pagination, filters, actor/action/time/issue display, CSV, and recursive restricted-value redaction work.

## Templates, custom fields, saved views, and command UX

- [ ] Template create/edit/archive/restore/duplicate/default values and Markdown preview work.
- [ ] TEXT, NUMBER, DATE, BOOLEAN, SINGLE_SELECT, MULTI_SELECT, and USER custom fields validate and render correctly.
- [ ] Required custom fields block invalid writes; failed inline saves roll back to the last persisted value.
- [ ] PRIVATE, PROJECT, and ORGANIZATION saved-view visibility and owner-only update/delete rules work.
- [ ] Command palette finds pages/projects/issues, My Issues, notifications, create issue, and authorized quick transitions.
- [ ] Cmd/Ctrl+K, C, `G` sequences, Escape, arrows, Enter, focus return, and shortcut help work without hijacking form input.

## GitHub App and operational visibility

- [ ] GitHub identity login remains separate from GitHub App repository authorization.
- [ ] Installation callback state is signed/user/workspace/project bound and installation verification paginates `GET /user/installations`.
- [ ] Maintainer can connect, sync, bind/unbind, select primary, and save per-repository target branches/auto-resolution.
- [ ] Developer sees only project-bound repositories/installations, can search/link PRs, and cannot enumerate unrelated private repositories.
- [ ] Active/Needs attention/History shows project-scoped, payload-free status and useful recovery guidance.
- [ ] PR picker uses bound repositories; manual URLs are verified server-side; PR cards show relationship, branches, state, and checks.
- [ ] Webhook rejects missing/invalid signatures, missing headers, invalid JSON, and bodies over 5MiB; duplicate delivery IDs are idempotent.
- [ ] Automatic links reconcile without deleting manual links; configured branches gate merge resolution.
- [ ] Retry is bounded/idempotent, payload retention cleanup works, authorization failures invalidate installation tokens, and removed access preserves historical TraceBox links.
- [ ] Restricted issue metadata is never sent back to GitHub or exposed in operational history.

## REST API and tokens

- [ ] Token create, optional expiry, one-time secret display, last-used, rotate, revoke, expired/revoked denial, and ownership rules work.
- [ ] Every documented scope and broad alias persists and is enforced per route.
- [ ] Project, issue list/detail/create/update, comments, milestones, search, GitHub resources, and link endpoints match `docs/api.md`.
- [ ] Missing/malformed bearer token, wrong organization/project, insufficient scope, malformed JSON/UUID/filter/pagination, archived project, and restricted issue return safe status codes.
- [ ] Browser-visible code and responses contain no service-role, GitHub, cron, or token secrets.

## Trace Intelligence

- [ ] Defect report quality scores BUG, REGRESSION, PERFORMANCE, and SECURITY reports locally; TASK and ENHANCEMENT remain unscored.
- [ ] Restricted/security issues show deterministic quality where applicable but never invoke Groq.
- [ ] Analyze is explicit and returns validated component, severity, priority, assignee, regression, follow-up, and duplicate advice without changing the issue.
- [ ] Suggested component/assignee/duplicate IDs outside the supplied project allowlists are discarded.
- [ ] Applying selected suggestions uses one atomic request, respects current role/assignment rules, and rejects stale `updated_at` without partial changes.
- [ ] Duplicate comparison is side by side; Mark duplicate uses the trusted atomic duplicate workflow.
- [ ] Natural search returns named editable chips for every supported queue-filter group and applies the canonical URL contract without raw UUID labels.
- [ ] Release briefs require a selected milestone/version, use the database readiness score unchanged, and include only bounded safe top risks.
- [ ] Blast radius follows visible blocking/dependency links, handles cycles/bounds, exposes a text tree, and links to correct issue keys.
- [ ] Missing key, timeout, malformed provider output, 429, concurrent Analyze, and provider failure leave deterministic workflows available.
- [ ] Cache hits are viewer-scoped, expire, include model/schema/prompt versions, and become unreadable after project or any contributing issue access is lost.
- [ ] Direct cache/ledger DML, cross-user completion, cross-project claims, request-budget bypass, and partial atomic-apply failures are denied.
- [ ] Browser bundles and responses contain no `GROQ_API_KEY`, prompts, raw provider output, issue comments, attachment bodies, webhook payloads, emails, or integration secrets.

## Reliability, responsive UX, and release gate

- [ ] Principal journey works at 375px, 768px, and 1440px with no header/dropdown/attachment overflow.
- [ ] Keyboard-only journey has logical focus, accessible names, announced validation/errors, and non-color-only status/chart information.
- [ ] Loading, empty, failure, retry, and lost-access states are distinct; no failed mutation leaves a false success state.
- [ ] Two tabs editing the same issue, rapid repeated mutations, Realtime reconnect, and lost membership fail safely.
- [ ] Public Playwright smoke passes with no credentials; fixture-gated account/two-user journeys pass against the release environment.
- [x] Disposable Supabase reset, pgTAP authorization suite, and true concurrent allocator test pass in CI/Docker.
- [x] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run check:migrations` pass.
- [x] Linked migration dry-run is empty and linked SQL lint has zero errors.
- [ ] Production smoke covers signup → workspace → project → issue → triage → collaboration → restricted access → attachment → planning → GitHub → reports/readiness → API → logout.

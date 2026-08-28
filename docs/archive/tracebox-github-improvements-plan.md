# TraceBox GitHub Integration Improvement Plan

## Objective

Improve the existing GitHub App integration without rewriting the current architecture.

The current implementation already has a solid base:

- GitHub App installation flow
- Signed connection state
- GitHub user-side installation verification
- Installation access tokens
- Multi-repository project bindings
- Stable GitHub numeric IDs
- Normalized GitHub artifacts
- PR and commit webhook ingestion
- Webhook signature verification
- Durable webhook delivery records
- Automatic issue linking from issue keys
- `Fixes / Closes / Resolves` auto-resolution semantics
- Branch-aware auto-resolution
- GitHub installation/repository lifecycle handling
- Daily reconciliation
- RLS and service-role guarded RPCs

The goal of this iteration is to make the GitHub integration more reliable, more scalable, and significantly better to use from inside TraceBox issues.

---

# Priority Order

Implement in this order:

1. PR search and picker
2. Rich GitHub PR cards inside issues
3. CI/check status on linked PRs
4. Correct stale auto-parsed link handling
5. Durable webhook replay/retry
6. GitHub error and rate-limit classification
7. Reconciliation scalability improvements
8. Installation token caching
9. GitHub integration permission tightening
10. Primary repository management
11. Webhook `attempt_count` correction
12. Webhook payload retention/cleanup
13. Closing-key parser improvements
14. Expanded GitHub test coverage
15. Issue activity integration
16. Commit expansion
17. GitHub Actions expansion

Do not start the later GitHub Actions work until the PR experience and webhook reliability work are complete.

---

# Phase 1 — Replace Manual PR URL Linking with a PR Picker

## Problem

The current issue GitHub section requires users to manually enter:

- repository name
- link type
- GitHub URL

This is unnecessary once a GitHub App is connected and makes the integration feel incomplete.

## Goal

Allow users to search and select pull requests directly from connected repositories.

## UX

Replace the default PR-linking flow with:

```text
Link pull request

Repository
[ ExistedYear/TraceBox ▼ ]

Search
[ authentication redirect... ]

#82  Fix auth redirect loop             OPEN
#76  Session refresh handling           MERGED
#69  OAuth callback cleanup             CLOSED
```

Selecting a PR should immediately link it to the TraceBox issue.

Manual URL linking may remain under an "Advanced / Link by URL" option for:

- commits
- branches
- unusual cases

## Backend

Add an endpoint similar to:

```text
GET /api/github/pull-requests
```

Query parameters:

```text
project_id
repository_id
q
state
page
```

The endpoint must:

1. Authenticate the TraceBox user.
2. Verify project membership.
3. Verify the repository is bound to the project.
4. Verify the installation is `ACTIVE`.
5. Create/reuse an installation token.
6. Search/list pull requests through GitHub.
7. Return only normalized fields needed by the UI.

Return a normalized object containing at least:

```text
github_id
number
title
state
draft
merged
author_login
head_branch
base_branch
head_sha
html_url
updated_at
```

## Link Action

Add or reuse a server endpoint/RPC that:

1. Fetches the selected PR from GitHub.
2. Upserts it into `github_artifacts`.
3. Creates an `issue_github_links` row.
4. Sets `relationship` and `source = MANUAL`.
5. Creates the issue activity event.

The browser must never be trusted to provide authoritative PR metadata.

## Files Likely Involved

```text
src/components/issues/issue-github-links-section.tsx
src/lib/github-app.ts
src/lib/github-link-validation.ts
src/app/api/github/*
supabase/migrations/*
src/types/database.ts
```

## Acceptance Criteria

- Users can select a connected repository.
- Users can search PRs.
- Results show open/closed/merged/draft state.
- Private repositories work through the GitHub App.
- Users cannot search repositories not bound to their TraceBox project.
- Selecting a PR links it without asking for a URL.
- Duplicate linking is idempotent.

---

# Phase 2 — Rich PR Cards Inside Issues

## Goal

Replace the current simple GitHub link row with a development-oriented PR card.

## Desired UI

```text
Development
────────────────────────────────────

#82 Fix authentication redirect

ExistedYear/TraceBox
fix/auth-loop → main

OPEN
✓ 4 / 4 checks

Neeraj · updated 3m ago

[ Open on GitHub ]
```

Possible states:

```text
DRAFT
OPEN
CLOSED
MERGED
```

## Display

Show:

- repository
- PR number
- title
- author
- source branch
- target branch
- state
- draft status
- merged status
- last sync time
- relationship: Fixes / References / Implements
- CI summary
- GitHub external link

## Data Model

The current normalized PR artifact already supports most required fields.

If missing, add:

```text
head_branch
merge_commit_sha
closed_at
merged_at
```

Only add columns that materially improve the UI or future reconciliation.

## Acceptance Criteria

- Linked PRs no longer look like generic URLs.
- PR state is visually obvious.
- Relationship semantics are visible.
- Branch direction is shown.
- Private repository metadata does not leak outside authorized projects.

---

# Phase 3 — Add CI / Check Status

## Goal

Show GitHub check status for linked PRs.

## Data Source

Use the PR `head_sha` and fetch check runs for that commit.

Optionally combine with commit statuses if required.

## UI

Examples:

```text
✓ 4 / 4 checks
● 3 / 4 checks running
✕ 1 check failed
— No checks
```

## Recommended Storage

Do not store every check-run payload initially.

Store a lightweight summary on the PR artifact or in a dedicated table.

Recommended option:

```text
github_pr_check_summaries
```

Fields:

```text
github_artifact_id
head_sha
total_count
success_count
failure_count
pending_count
neutral_count
status
last_synced_at
```

Possible `status` values:

```text
SUCCESS
FAILURE
PENDING
NEUTRAL
NONE
UNKNOWN
```

## Webhooks

Later subscribe to:

```text
check_run
check_suite
status
```

For the initial version, fetch on:

- PR link
- PR synchronize webhook
- manual refresh
- reconciliation

## Acceptance Criteria

- Linked PR cards show CI/check state.
- Status updates after PR synchronization.
- Failed GitHub requests do not break issue rendering.
- Old check status is labeled stale if necessary.

---

# Phase 4 — Make Auto-Parsed Links True Derived State

## Problem

Current automatic parsing can create stale relationships.

Example:

```text
Original PR:
Fixes TRACE-42
```

Stored:

```text
PR #12 -> FIXES -> TRACE-42
```

Later PR body changes to:

```text
Related to TRACE-42
```

The old `FIXES` relation may remain.

Another example:

```text
Original:
Fixes TRACE-42

Edited:
No issue reference
```

The automatic link may remain even though the PR no longer references the issue.

## Goal

Treat `AUTO_PARSED` links as derived state from the current PR title/body.

## Algorithm

Whenever a PR webhook or PR reconciliation occurs:

```text
current PR title + body
        ↓
parse current issue references
        ↓
produce desired relationship set
        ↓
load existing AUTO_PARSED relationships
        ↓
diff
        ↓
insert missing
update changed
remove stale
```

## Rules

Never automatically remove:

```text
source = MANUAL
```

Only reconcile:

```text
source = AUTO_PARSED
```

Recommended desired-state key:

```text
(issue_id, github_artifact_id)
```

with exactly one current automatic relationship.

If a manually-created relationship exists alongside an automatic one, preserve the manual record.

## Suggested RPC

Create something like:

```text
reconcile_auto_github_links(
  p_github_artifact_id,
  p_desired_links jsonb
)
```

The RPC should perform the diff transactionally.

## Auto-Resolve Safety

Auto-resolution must happen only if the current desired relationship is `FIXES` and the PR is merged into an allowed branch.

Never resolve based on a stale historical `FIXES` relation.

## Acceptance Criteria

- Editing `Fixes TRACE-1` to `Refs TRACE-1` updates the relation.
- Removing a reference removes the automatic link.
- Manual links remain untouched.
- Repeated webhook deliveries remain idempotent.
- Auto-resolution never uses a stale relationship.

---

# Phase 5 — Durable Webhook Replay / Retry

## Problem

Webhook requests are persisted and then processed using `after()`.

That is good for fast HTTP responses, but `after()` is not a durable background queue.

A function may terminate after returning a `2xx` response.

## Goal

Make the existing webhook delivery table into a recoverable job inbox.

## Delivery States

Keep:

```text
RECEIVED
PROCESSING
PROCESSED
FAILED
IGNORED
```

Add if useful:

```text
next_retry_at timestamptz
last_attempt_at timestamptz
```

## Extract Processing Logic

Move webhook processing out of the route into a reusable module:

```text
src/lib/github-webhook-processor.ts
```

Expose:

```text
processGithubWebhookDelivery(deliveryId)
```

The webhook route should only:

```text
verify signature
persist delivery
schedule immediate processing
return 2xx
```

## Replay Endpoint / Cron

Add:

```text
GET /api/github/webhook-replay
```

protected by `CRON_SECRET`.

Replay deliveries where:

```text
status = FAILED
```

or:

```text
status = RECEIVED
AND received_at < now() - 5 minutes
```

or:

```text
status = PROCESSING
AND last_attempt_at < now() - 10 minutes
```

## Retry Policy

Example:

```text
attempt 1 -> immediately
attempt 2 -> +5 min
attempt 3 -> +15 min
attempt 4 -> +1 hour
attempt 5 -> +6 hours
```

After max attempts, keep it `FAILED` for inspection.

## Idempotency

All processors must remain idempotent.

Use:

```text
delivery_id UNIQUE
```

and normalized artifact/link upserts.

## Vercel Cron

Add a frequent replay cron at the lowest cadence supported by the chosen Vercel plan.

Keep reconciliation separate from webhook replay.

## Acceptance Criteria

- A stuck `RECEIVED` delivery is retried.
- A crashed `PROCESSING` delivery is retried.
- Duplicate GitHub deliveries do not duplicate links/events.
- Failed jobs show attempt count and last error.
- Webhook route still responds quickly.

---

# Phase 6 — Correct GitHub Error Classification

## Problem

A GitHub `403` can represent:

- missing permissions
- rate limiting
- secondary rate limiting
- repository restrictions
- organization policy

It must not always become `NEEDS_PERMISSION_UPDATE`.

## Extend `GithubApiError`

Add:

```text
headers
githubRequestId
rateLimitLimit
rateLimitRemaining
rateLimitReset
retryAfter
```

Optionally parse GitHub's structured API error body.

## Error Classification

Implement:

```text
classifyGithubApiError(error)
```

Possible classifications:

```text
AUTH_REVOKED
PERMISSION_MISSING
RATE_LIMITED
SECONDARY_RATE_LIMITED
NOT_FOUND
TEMPORARY
UNKNOWN
```

## Installation Status Rules

```text
401
→ likely REVOKED / invalid credentials

404 on installation endpoint
→ REVOKED

403 + rate-limit evidence
→ do not change installation status
→ schedule retry

403 + permission/resource-access evidence
→ NEEDS_PERMISSION_UPDATE

429
→ RATE_LIMITED
```

## Logging

Log:

```text
GitHub request ID
endpoint
status
rate-limit remaining
retry-after
installation id
repository id
```

Do not log access tokens.

## Acceptance Criteria

- Rate limits do not incorrectly mark installations as permission-broken.
- Revoked installs still become `REVOKED`.
- Permission failures still become `NEEDS_PERMISSION_UPDATE`.
- Retryable failures are retried.

---

# Phase 7 — Reconciliation Scalability

## Problem

Current reconciliation:

- loops all non-revoked installations
- lists repositories
- checks stored PR artifacts
- fetches up to 100 PRs individually
- runs sequentially

This is acceptable now but will become inefficient.

## Goal

Reconcile only data that may reasonably change.

## PR Selection

Prioritize:

```text
state = OPEN
OR draft = true
OR merged = false
OR last_synced_at older than threshold
```

Do not repeatedly poll very old merged PRs.

Suggested policy:

```text
open PRs:
sync daily

closed/merged in last 14 days:
sync daily

older closed/merged PRs:
sync rarely or never
```

## Pagination

Remove `.limit(100)` as an implicit permanent ceiling.

Use pagination or batched IDs.

## Time Budget

Process installations in bounded batches.

Consider cursor/limit support for large deployments.

## Concurrency

Allow small controlled concurrency such as 2–5 repositories at once.

Do not run unbounded `Promise.all()` across every repo.

## Acceptance Criteria

- More than 100 PR artifacts are eventually reconciled.
- Old merged PRs do not dominate API usage.
- One installation failure does not block all others.
- Reconciliation stays within serverless execution limits.

---

# Phase 8 — Short-Lived Installation Token Cache

## Goal

Avoid requesting a new installation token for every GitHub API call.

## Rules

Never persist installation tokens in Supabase.

Use a short-lived server-side cache.

Example:

```text
Map<installationId, {
  token,
  expiresAt
}>
```

Reuse while:

```text
now < expiresAt - 5 minutes
```

## Caveat

Vercel serverless instances are ephemeral.

Therefore this cache is only an optimization.

Correctness must never depend on it.

## Helper

Replace direct usage with:

```text
getGithubInstallationToken(installationId)
```

which:

1. checks cache
2. returns cached token if valid
3. creates a fresh token otherwise

## Acceptance Criteria

- Multiple requests in one warm server instance reuse a token.
- Restarting the function causes no functional issue.
- Tokens are never written to the database or logs.

---

# Phase 9 — Tighten GitHub Management Permissions

## Recommended Roles

### Maintainer

Can:

```text
install GitHub App
bind repository
unbind repository
set primary repository
change target branches
toggle auto-resolution
refresh installation/repositories
```

### Developer

Can:

```text
view connected repositories
search PRs
link PRs
link commits
view CI/check state
```

### Viewer

Can:

```text
view GitHub metadata only if they can view the TraceBox project/issue
```

## RLS Review

Review policies for:

```text
github_installations
github_repositories
project_github_repositories
github_artifacts
issue_github_links
```

Avoid exposing names of private GitHub repositories merely because a user belongs to the same TraceBox organization.

Preferred rule:

```text
private repository metadata
→ visible through project bindings
→ not organization-wide by default
```

## Acceptance Criteria

- Developers cannot alter repository bindings.
- Maintainers can fully manage integration configuration.
- Project members can view only GitHub data relevant to projects they can access.
- Private repo names do not leak across projects.

---

# Phase 10 — Explicit Primary Repository Management

## Problem

The current UI always connects a selected repository as primary.

This causes the last connected repository to silently become primary.

## Goal

Make primary status explicit.

## UI

```text
Repositories

ExistedYear/frontend
[Primary]

ExistedYear/backend
[Set primary]

ExistedYear/infra
[Set primary]
```

## API

Allow a PATCH endpoint or reuse the binding RPC with an explicit `is_primary` update.

The user must explicitly choose when changing the primary repository.

## Behavior

Connecting a second repository should default to:

```text
is_primary = false
```

unless no primary exists.

## Acceptance Criteria

- First repository may automatically become primary.
- Additional repositories do not replace primary silently.
- User can explicitly change primary.
- Only one primary repository exists at a time.

---

# Phase 11 — Correct `attempt_count`

## Problem

Current webhook delivery `attempt_count` increments on multiple status transitions.

A single attempt may count as 2+ attempts.

## Goal

Increment exactly once per processing attempt.

## Fix

Increment when entering:

```text
PROCESSING
```

Do not increment on:

```text
PROCESSED
FAILED
IGNORED
```

## Acceptance Criteria

A successful first attempt ends with:

```text
attempt_count = 1
```

A retry that succeeds ends with:

```text
attempt_count = 2
```

---

# Phase 12 — Webhook Payload Retention

## Problem

Full GitHub webhook payloads may contain sensitive private-repository metadata.

Do not retain everything forever.

## Suggested Policy

```text
PROCESSED
payload retained 7 days

IGNORED
payload retained 3–7 days

FAILED
payload retained 30 days

RECEIVED / PROCESSING
retain until terminal state
```

## Implementation

Add cleanup cron:

```text
/api/github/webhook-cleanup
```

For old processed rows, preferred behavior is:

```text
payload = '{}'::jsonb
```

while retaining compact delivery metadata longer.

## Acceptance Criteria

- Replay still works inside retry window.
- Old successful payload bodies are removed.
- Delivery metadata remains available for diagnostics.

---

# Phase 13 — Improve Closing-Key Parser

## Current Problem

This works:

```text
Fixes TRACE-1
Fixes TRACE-1, fixes TRACE-2
```

But this may not correctly mark both as closing references:

```text
Fixes TRACE-1, TRACE-2
```

## Goal

Support natural multi-key closing syntax.

## Supported Examples

```text
Fixes TRACE-1
Fix TRACE-1
Fixed TRACE-1
Closes TRACE-1
Closed TRACE-1
Resolves TRACE-1
Resolved TRACE-1

Fixes TRACE-1, TRACE-2
Fixes TRACE-1 and TRACE-2
Closes TRACE-1, TRACE-2, TRACE-3
```

## Parser Strategy

Do not rely on one regex capture.

Parse:

1. closing keyword
2. following reference segment
3. all issue keys in that segment until a semantic boundary

Keep parser behavior deterministic.

## Acceptance Criteria

```text
Fixes TRACE-1, TRACE-2
```

returns both keys as closing references.

---

# Phase 14 — Expanded GitHub Tests

Add strong coverage before adding more API surface.

## Unit Tests

### Parsing

Test:

```text
extractIssueKeys
extractClosingIssueKeys
branch patterns
repository normalization
```

Include:

```text
Fixes TRACE-1, TRACE-2
Refs TRACE-3
Fixes TRACE-1 and TRACE-4
```

### State

Test:

- valid signed state
- wrong state
- expired state
- tampered cookie
- user mismatch

### Error Classification

Test:

- 401 revoked
- 404 revoked
- 403 rate limit
- 403 missing permission
- 429
- retry-after parsing

## Webhook Tests

Test:

```text
duplicate delivery
PR opened
PR edited
PR synchronize
PR closed
PR merged
repository removed
installation suspended
installation deleted
```

Critical derived-link cases:

```text
Fixes TRACE-1
→ AUTO_PARSED FIXES

edit to:
Refs TRACE-1
→ FIXES removed
→ REFERENCES created

remove TRACE-1 entirely
→ AUTO_PARSED link removed

manual link exists
→ remains
```

## Retry Tests

Test:

```text
RECEIVED stale
PROCESSING stale
FAILED retry
max retry
attempt_count
```

## RLS Tests

Verify:

- unauthorized project user cannot view artifacts
- Developer cannot manage installation if permissions are tightened
- Maintainer can
- private repo metadata is not organization-wide

---

# Phase 15 — GitHub Activity in Issue Timeline

## Goal

Surface GitHub engineering activity alongside TraceBox activity.

## Events

Create/display meaningful events such as:

```text
GITHUB_PR_LINKED
GITHUB_PR_OPENED
GITHUB_PR_UPDATED
GITHUB_PR_DRAFTED
GITHUB_PR_READY
GITHUB_PR_MERGED
GITHUB_PR_CLOSED
GITHUB_CHECKS_PASSED
GITHUB_CHECKS_FAILED
GITHUB_AUTO_RESOLVED
```

Do not spam the timeline for every synchronization if nothing meaningful changed.

## Example

```text
12:18  PR #82 linked
12:31  PR #82 marked ready for review
12:44  CI passed
13:07  PR #82 merged into main
13:07  Issue automatically resolved as Fixed
```

## Acceptance Criteria

- Timeline shows meaningful GitHub changes.
- Repeated identical webhooks do not create duplicate events.
- Restricted issue rules remain respected.

---

# Phase 16 — Commit Integration Expansion

Only begin after the PR system is polished.

## Features

- search commits
- link commit from connected repo
- richer commit card
- show SHA, first message line, author, timestamp, repository
- auto-link commit messages containing TraceBox keys

## UI

```text
Commit a81fd21
Fix token refresh race

ExistedYear/TraceBox
Neeraj · 14m ago
```

Commits should normally use `REFERENCES` unless explicit closing semantics are intentionally supported.

---

# Phase 17 — GitHub Actions / Workflow Details

Do this last.

## Features

For a linked PR:

```text
Checks
├── lint                  passed
├── test                  passed
├── build                 failed
└── deploy-preview        skipped
```

Later optional features:

- workflow run details
- job details
- failed-step summary
- artifacts
- re-run failed jobs only if write permission is intentionally added

## Permissions

Do not request GitHub Actions write permission unless TraceBox actually supports write actions.

Keep the GitHub App read-only by default.

---

# Schema Changes Summary

Potential new migration:

```text
202608xxxx_github_reliability_and_pr_experience.sql
```

Possible changes:

```text
github_webhook_deliveries
+ last_attempt_at
+ next_retry_at

github_artifacts
+ head_branch
+ merged_at
+ closed_at
+ merge_commit_sha

github_pr_check_summaries
+ github_artifact_id
+ head_sha
+ total_count
+ success_count
+ failure_count
+ pending_count
+ neutral_count
+ status
+ last_synced_at
```

Potential new RPCs:

```text
reconcile_auto_github_links(...)
claim_github_webhook_delivery(...)
complete_github_webhook_delivery(...)
fail_github_webhook_delivery(...)
set_primary_github_repository(...)
upsert_github_check_summary(...)
```

Do not add a new table if an existing normalized table can cleanly support the feature.

---

# API Changes Summary

Recommended routes:

```text
GET  /api/github/pull-requests
POST /api/github/link-pr

POST /api/github/bind
PATCH /api/github/bind
DELETE /api/github/bind

GET /api/github/reconcile
GET /api/github/webhook-replay
GET /api/github/webhook-cleanup
```

Existing routes should be reused when reasonable.

Avoid duplicate API surfaces.

---

# Security Requirements

All new GitHub work must preserve the following rules:

1. Never expose:
   - GitHub App private key
   - GitHub client secret
   - installation access token
   - user GitHub OAuth token

2. Never trust GitHub metadata supplied by the browser.

3. Always verify:
   - authenticated TraceBox user
   - project membership
   - project role
   - repository binding
   - active GitHub installation

4. Restricted TraceBox issues must never automatically leak metadata back to GitHub.

5. Keep GitHub App permissions read-only unless a future feature explicitly requires write access.

6. Webhook processing must remain idempotent.

7. Repository numeric IDs remain the stable identity; `owner/repo` is display metadata.

---

# Suggested Agent Workstreams

If using multiple agents, split work like this.

## Agent A — PR UX

Own:

```text
PR picker
PR search endpoint
rich PR cards
primary repository UX
```

## Agent B — Webhook Reliability

Own:

```text
webhook processor extraction
retry/replay
attempt_count
payload retention
derived AUTO_PARSED link reconciliation
```

## Agent C — GitHub API Layer

Own:

```text
rate-limit/error classification
token cache
check-run fetching
reconciliation optimization
```

## Agent D — Security + Database

Own:

```text
migration
RPCs
RLS tightening
role changes
private repository visibility
```

## Agent E — Tests

Own:

```text
parser tests
webhook tests
retry tests
RLS tests
GitHub API classification tests
```

Avoid letting multiple agents edit the same large migration simultaneously.

---

# Recommended Delivery Milestones

## Milestone 1 — PR Experience

Ship:

- PR picker
- rich PR cards
- explicit primary repo management

Demo result:

```text
Issue
→ choose PR
→ PR appears as rich development card
```

## Milestone 2 — Reliability

Ship:

- derived auto-links
- retry/replay
- correct attempt count
- error/rate-limit classification
- expanded webhook tests

Demo result:

```text
PR edited
→ TraceBox relationships correct themselves

failed webhook
→ TraceBox replays it safely
```

## Milestone 3 — CI Awareness

Ship:

- check summary
- PR card CI state
- meaningful timeline events

Demo result:

```text
Issue
→ linked PR
→ live status
→ CI state
→ merge
→ automatic resolution
```

## Milestone 4 — Scale + Hardening

Ship:

- reconciliation improvements
- token cache
- payload cleanup
- permission/RLS tightening

## Milestone 5 — Broader GitHub Development Data

Ship:

- commit improvements
- GitHub Actions details

Only do this if the previous milestones are stable.

---

# Final Target Experience

The ideal issue page should eventually look like:

```text
TRACE-184
Authentication refresh loops after session expiry

Development
────────────────────────────────────────────

#82 Fix authentication redirect
ExistedYear/TraceBox

fix/auth-loop → main

OPEN
✓ 4 / 4 checks

Fixes TRACE-184
Neeraj · updated 3m ago

[ Open on GitHub ]
```

After merge:

```text
#82 Fix authentication redirect

MERGED
✓ 4 / 4 checks

Merged into main
```

Issue activity:

```text
12:18  PR #82 linked
12:44  CI passed
13:07  PR #82 merged into main
13:07  TRACE-184 automatically resolved as Fixed
```

That should be the standard to optimize for.

The objective is not to add the maximum number of GitHub endpoints.

The objective is to make TraceBox feel as though GitHub development activity is natively part of the issue lifecycle.

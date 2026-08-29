# TraceBox REST API

The versioned API is available under `/api/v1`. Every endpoint requires `Authorization: Bearer <token>` and JSON request bodies use `Content-Type: application/json`. Create tokens at **Settings → API tokens**; a secret is shown once.

## Scopes and access

Scopes are `projects:read`, `issues:read`, `issues:write`, `comments:write`, `milestones:read`, `search:read`, `integrations:read`, `github_links:read`, and `github_links:write`. Broad `read`/`write` aliases are accepted where applicable. Tokens are organization-scoped and access is further constrained by the owner's live project memberships. There is no separately stored project restriction. Restricted issues are filtered by normal TraceBox visibility and unauthorized issues return `404`.

## Endpoints

All successful responses are JSON. Collection ordering is deterministic as described below. Unless an endpoint lists pagination parameters, it returns its complete authorized result or its documented fixed maximum.

| Method | Path | Scope | Notes |
|---|---|---|---|
| GET | `/api/v1/projects` | `projects:read` | Optional `organization_id` must equal the token organization; archived/inaccessible projects are omitted. |
| GET | `/api/v1/issues?project_id=<uuid>&limit=25&offset=0` | `issues:read` | Required UUID; optional `status` UUID, `type`, `priority`; limit 1–100 and offset 0–1,000,000. Returns `data`, `total`, `limit`, `offset`. |
| POST | `/api/v1/issues` | `issues:write` | JSON payload with `project_id`, `title`, `type`, and supported issue fields. Returns `{ "success": true, "issue_number": 42 }` with `201`. |
| GET | `/api/v1/issues/<PROJECT-42>` | `issues:read` | Returns `{ "data": <issue> }`. |
| PATCH | `/api/v1/issues/<PROJECT-42>` | `issues:write` | JSON object validated against the issue-update contract. Returns `{ "success": true }`. |
| POST | `/api/v1/issues/<PROJECT-42>/comments` | `comments:write` | JSON `{ "body": "..." }`, body 1–10,000 characters. Returns `{ "success": true, "id": "..." }` with `201`. |
| GET | `/api/v1/issues/<PROJECT-42>/github-links` | `github_links:read` | Returns `{ "data": [...] }`. |
| POST | `/api/v1/issues/<PROJECT-42>/github-links` | `github_links:write` | JSON `repo_name`, `link_type`, `url`; GitHub verification is server-side. Returns `{ "data": ... }` with `201`. |
| DELETE | `/api/v1/issues/<PROJECT-42>/github-links/<uuid>` | `github_links:write` | Returns `{ "success": true }`. |
| GET | `/api/v1/milestones?project_id=<uuid>` | `milestones:read` | Returns authorized active-project milestones. |
| GET | `/api/v1/search?project_id=<uuid>&q=build` | `search:read` | `q` must be 2–200 characters; returns at most 100 authorized matches. |
| GET | `/api/v1/projects/<uuid>/github/repositories` | `integrations:read` | Returns authorized repositories, bindings, and installations. |

## Issue request contracts

`POST /issues` requires `project_id` (UUID), `title` (1–200 characters), and either a non-empty `description` or a `template_id`. `type` may be omitted when a template supplies it. The complete accepted field set is:

| Field | Accepted value |
|---|---|
| `project_id` | Required project UUID. |
| `title` | Required trimmed string, 1–200 characters. |
| `description` | String up to 10,000 characters; required unless a template supplies it. |
| `type` | `BUG`, `ENHANCEMENT`, `TASK`, `SECURITY`, `PERFORMANCE`, or `REGRESSION`; optional with a template. |
| `priority` | `P0` through `P4`; optional project/template default. |
| `severity` | `BLOCKER`, `CRITICAL`, `MAJOR`, `MINOR`, or `TRIVIAL`; optional project/template default. |
| `component_id`, `assignee_id`, `template_id` | UUID, `null`, or empty string. Referenced records must be active and authorized for the project. |
| `environment` | String up to 2,000 characters. |
| `steps_to_reproduce`, `expected_behavior`, `actual_behavior` | Strings up to 5,000 characters each. |
| `visibility` | `PROJECT` or `RESTRICTED`. |
| `access_user_ids` | Up to 100 user UUIDs; used only with authorized restricted creation. |
| `custom_values` | Object keyed by custom-field UUID. Values are validated against the project field type/options and requiredness. |

`PATCH /issues/<KEY-N>` is strict: unknown fields are rejected and at least one field is required. It accepts `title`, `description`, `environment`, `steps_to_reproduce`, `expected_behavior`, `actual_behavior`, `priority`, `severity`, `type`, `assignee_id`, and `component_id`. Nullable text and nullable relationship fields may be cleared with `null`; relationship fields also accept an empty string. Planning, labels, visibility, grants, workflow transitions, and custom-field values are intentionally not PATCH fields because their dedicated transactional contracts own their authorization and audit behavior.

Example list response:

```json
{
  "data": [{ "id": "…", "issue_number": 42, "title": "Broken build", "priority": "P2" }],
  "total": 1,
  "limit": 25,
  "offset": 0
}
```

Issue lists are ordered by newest creation time, then issue number, and database-side authorization/filtering occurs before `limit`/`offset`. Search is ordered by most recently updated issue, then issue number, and capped at 100 authorized matches. Project lists are ordered by name; milestones by due date; GitHub repository catalogs by full name.

GitHub link creation accepts `repo_name` in `owner/repository` form, `link_type` as `PULL_REQUEST`, `COMMIT`, or `BRANCH`, and an HTTPS `github.com` `url` matching both fields. TraceBox verifies the object with GitHub before persisting it. Private repositories must already be bound to the project.

```bash
curl -H 'Authorization: Bearer tbx_…' https://tracebox.example.com/api/v1/projects
curl -H 'Authorization: Bearer tbx_…' 'https://tracebox.example.com/api/v1/issues?project_id=PROJECT_UUID&limit=25'
curl -H 'Authorization: Bearer tbx_…' 'https://tracebox.example.com/api/v1/issues/CORE-42'
curl -X POST -H 'Authorization: Bearer tbx_…' -H 'Content-Type: application/json' \
  -d '{"project_id":"PROJECT_UUID","title":"Broken build","type":"BUG","priority":"P2"}' \
  https://tracebox.example.com/api/v1/issues
curl -X POST -H 'Authorization: Bearer tbx_…' -H 'Content-Type: application/json' \
  -d '{"body":"Investigating this now."}' \
  https://tracebox.example.com/api/v1/issues/CORE-42/comments
curl -X PATCH -H 'Authorization: Bearer tbx_…' -H 'Content-Type: application/json' \
  -d '{"priority":"P1","assignee_id":null}' \
  https://tracebox.example.com/api/v1/issues/CORE-42
curl -H 'Authorization: Bearer tbx_…' \
  'https://tracebox.example.com/api/v1/search?project_id=PROJECT_UUID&q=broken%20build'
```

## Errors

Errors use `{ "error": "safe human-readable message" }`; some validation responses include `details`. `400` means malformed JSON, invalid IDs/parameters, or an operation rejected by its database contract; `401` means missing/invalid/expired credentials; `403` means valid credentials lack scope, role, organization, or project access; `404` means absent, archived, inaccessible, or restricted resource; `409` means a conflicting or unavailable archived/integration state; `422` means request-schema validation failed; `429` means GitHub rate limiting; `500` means a server/database failure; and `502` means upstream GitHub verification failed. Database failures are not represented as empty collections or not-found responses.

## Token lifecycle and guarantees

Tokens support optional expiration. Settings shows expiration and `last_used_at`. Rotation requires an explicit replacement expiration or explicit “never expires” choice, confirms that the old token dies immediately, and shows the replacement once. Revocation immediately removes the token and reports a not-found failure if it is no longer owned. Only a SHA-256 hash is stored.

TraceBox retains creation, expiration, and `last_used_at` only; it does not provide usage history. It does not currently promise an application rate limit or a request explorer.

Write requests do not currently accept an idempotency key. Retrying a request after an ambiguous network failure can create a second comment, issue, or GitHub link. Clients should first reconcile using the returned issue number/resource ID or a read endpoint before retrying. Mutation responses are not promises of asynchronous completion unless explicitly marked as queued.

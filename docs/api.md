# TraceBox REST API

The versioned API is available under `/api/v1`. Every endpoint requires `Authorization: Bearer <token>`. Create tokens at **Settings → API tokens**; a secret is shown once.

## Scopes and access

Scopes are `projects:read`, `issues:read`, `issues:write`, `comments:write`, `milestones:read`, `search:read`, `integrations:read`, `github_links:read`, and `github_links:write`. Broad `read`/`write` aliases are accepted where applicable. Tokens are organization-scoped and access is further constrained by the owner's live project memberships. There is no separately stored project restriction. Restricted issues are filtered by normal TraceBox visibility and unauthorized issues return `404`.

## Endpoints

All successful responses are JSON. `GET` collections return `{ "data": [...] }`.

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
```

## Errors

Errors use `{ "error": "safe human-readable message" }`; some validation responses include `details`. `400` means malformed JSON, invalid IDs/parameters, or invalid request shape; `401` means missing/invalid/expired credentials; `403` means valid credentials lack scope or organization access; `404` means absent, archived, inaccessible, or restricted resource; `422` means schema validation failed; `500` means an unexpected server/database failure; and `502` means upstream GitHub verification failed.

## Token lifecycle and guarantees

Tokens support optional future expiration. Settings shows expiration and `last_used_at`. Rotation requires an explicit replacement expiration or explicit “never expires” choice, confirms that the old token dies immediately, and shows the replacement once. Revocation immediately removes the token and reports a not-found failure if it is no longer owned. Only a SHA-256 hash is stored.

TraceBox retains creation, expiration, and `last_used_at` only; it does not provide usage history. It does not currently promise an application rate limit or a request explorer.

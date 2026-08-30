# TraceBox: Complete External Setup & Deployment Guide

This guide walks you through setting up everything outside this workspace: creating your Supabase backend, running migrations via SQL scripts, configuring authentication and realtime, deploying to Vercel, and managing migration history without losing data.

---

## Step 1: Supabase Setup (Database & Backend)

### 1.1 Create a Supabase Project

1. Go to [database.new](https://database.new) (or log in at [supabase.com](https://supabase.com) and click **New Project**).
2. Choose your organization, set a project name (e.g. `tracebox-production`), and set a secure database password.
3. Select the region closest to your users and click **Create new project**. Wait ~1–2 minutes for provisioning.

---

### 1.2 Get Project Credentials

1. In your Supabase Project Dashboard, navigate to **Project Settings** (gear icon) → **API**.
2. Under **Project URL**, copy the `URL` (e.g. `https://xyzcompany.supabase.co`).
3. Under **Project API keys**, copy the `anon` / `public` key.
4. *(Keep these handy for `.env.local` and Vercel).*

---

### 1.3 Apply Database Migrations (1 through 85) via SQL Script

You do **not** need the Supabase CLI. You can apply all 85 migrations directly in the Supabase web dashboard for a fresh project. For an existing linked project, prefer `npx supabase db push --linked` after comparing its ledger and live schema; never paste the consolidated script over an existing database.

#### Method A: Single Consolidated Script (Recommended)

1. Open the Supabase Dashboard → click **SQL Editor** in the left sidebar.
2. Click **+ New Query**.
3. Open the file `supabase/full_schema.sql` from this repository (which consolidates all 85 ordered migrations).
4. Copy the entire content and paste it into the Supabase SQL Editor.
5. Click **Run** (or press `Ctrl+Enter` / `Cmd+Enter`).
6. You should see `Success. No rows returned`.

#### Method B: Sequential Migration Files

If you prefer running file-by-file, open the **SQL Editor** and execute each file in `supabase/migrations/` in this exact order:
1. `202608260001_initial_profiles.sql`
2. `202608260002_create_organizations_projects.sql`
3. `202608260003_create_components_workflow.sql`
4. `202608260004_create_issues.sql`
5. `202608260005_update_issue_fields.sql`
6. `202608260006_security_hardening.sql`
7. `202608260007_archived_guards_audit.sql`
8. `202608260008_write_guard_refinements.sql`
9. `202608260009_finalize_component_guards.sql`
10. `202608260010_normalize_issue_updates.sql`
11. `202608260011_component_mutation_rpcs.sql`
12. `202608260012_comments_activity.sql`
13. `202608260013_security_role_refinements.sql`
14. `202608260014_fix_create_project_values.sql`
15. `202608260015_phase6_assignment_workflow.sql`
16. `202608260016_phase7_labels_versions_milestones.sql`
17. `202608260017_phase8_watchers_notifications.sql`
18. `202608260018_phase10_search_saved_views.sql`
19. `202608260019_phase11_issue_links.sql`
20. `202608260020_security_audit_fixes.sql`
21. `202608260021_label_realtime_fixes.sql`
22. `202608260022_audit_refinements.sql`
23. `202608260023_transition_viewer_role_fix.sql`
24. `202608260024_deep_audit_hardening.sql`
25. `202608260025_phase13_attachments.sql`
26. `202608260026_phase17_issue_templates.sql`
27. `202608260027_phase18_restricted_issues.sql`
28. `202608260028_phase19_github_integration.sql`
29. `202608260029_phase20_custom_fields_api.sql`
30. `202608260030_comprehensive_audit_fixes.sql`
31. `202608260031_api_storage_hardening.sql`
32. `202608260032_restricted_access_audit.sql`
33. `202608260033_github_webhooks.sql`
34. `202608260034_final_audit_hardening.sql`
35. `202608260035_api_integration_corrections.sql`
36. `202608260036_notification_lifecycle.sql`
37. `202608260037_restricted_notification_guards.sql`
38. `202608260038_final_invariant_hardening.sql`
39. `202608260039_release_validation_fixes.sql`
40. `202608260040_github_app_integration.sql`
41. `202608260041_service_role_claim_compatibility.sql`
42. `202608260042_github_reliability_pr_experience.sql`
43. `202608260043_github_review_fixes.sql`
44. `202608260044_issue_api_contracts.sql`
45. `202608260045_membership_invitations.sql`
46. `202608260046_phase2_membership_relational_guards.sql`
47. `202608260047_phase4_issue_editing.sql`
48. `202608260048_phase6_notifications.sql`
49. `202608260049_phase7_project_workflow_admin.sql`
50. `202608260050_phase8_restricted_completion.sql`
51. `202608260051_phase9_queue_bulk.sql`
52. `202608260052_phase9_saved_views.sql`
53. `202608260053_phase9_triage_command_ux.sql`
54. `202608260054_phase10_templates.sql`
55. `202608260055_phase10_custom_fields.sql`
56. `202608260056_phase10_attachments.sql`
57. `202608260057_phase10_api_tokens.sql`
58. `202608260058_phase11_reports.sql`
59. `202608260059_phase11_release_readiness.sql`
60. `202608260060_phase11_dashboard_metrics.sql`
61. `202608260061_phase11_audit_explorer.sql`
62. `202608260062_phase12_mentions.sql`
63. `202608260063_account_management.sql`
64. `202608260064_phase13_github_operations.sql`
65. `202608260065_reconcile_api_token_scopes.sql`
66. `202608260066_security_advisor_hardening.sql`
67. `202608260067_server_only_api_wrappers.sql`
68. `202608260068_performance_advisor_cleanup.sql`
69. `202608260069_runtime_function_repairs.sql`
70. `202608260070_runtime_ambiguity_repairs.sql`
71. `202608260071_invitation_runtime_repair.sql`
72. `202608260072_function_volatility_contracts.sql`
73. `202608260073_invitation_context_and_github_automation.sql`
74. `202608260074_github_repository_confidentiality.sql`
75. `202608260075_api_query_bounding.sql`
76. `202608260076_fix_api_search_expression.sql`
77. `202608260077_tenant_catalog_privacy.sql`
78. `202608260078_api_project_membership_boundary.sql`
79. `202608260079_ci_contract_hardening.sql`
80. `202608260080_trace_intelligence_security.sql`
81. `202608260081_trace_intelligence_blast_depth.sql`
82. `202608260082_public_workspaces.sql`
83. `202608260083_public_workspace_join_idempotency.sql`
84. `202608260084_public_workspace_join_lock.sql`
85. `202608260085_workspace_self_leave.sql`

`supabase/full_schema.sql` is generated and intentionally committed for fresh SQL Editor installs and drift review. Never edit it directly; update migrations and run `npm run sync:migrations`.

Do not run `supabase/seed.sql` in production. It creates the public demo login `demo@123.com` / `demo123` for local and disposable databases. If that exact seed was intentionally loaded into a disposable hosted project, review `scripts/remove-demo-account.sql`. The cleanup verifies fixed IDs, email, slug, ownership, and membership isolation, disables only named immutable-history guards inside one transaction, and ends with `ROLLBACK`. Change the final word to `COMMIT` only after reviewing the target rows and the complete script.

Before every linked push, run `npx supabase migration list --linked`, `npx supabase db push --linked --dry-run`, and linked database lint. The migration ledger is version-based, so editing a file whose version is already applied does not update the hosted function, policy, or constraint. Inspect the live catalog when drift is suspected and ship the correction as the next forward-only migration.

### 1.4 Configure Supabase Authentication

In your Supabase Dashboard:

1. **Redirect & Site URLs**:
   - Go to **Authentication** → **URL Configuration**.
   - Set **Site URL**:
     - `https://<your-vercel-app-name>.vercel.app` (or `http://localhost:3000` for local dev).
   - Under **Redirect URLs**, add:
     - `https://<your-vercel-app-name>.vercel.app/**`
     - `http://localhost:3000/**`
   - Click **Save**.

2. **Email Provider Settings**:
   - Go to **Authentication** → **Providers** → **Email**.
   - If you want immediate signups without mandatory email verification during testing, toggle **Confirm email** to `OFF`. Click **Save**.

3. **Custom SMTP for production email**:
   - Go to **Project Settings** → **Authentication** → **SMTP Settings**.
   - Enable custom SMTP and enter a verified sender plus the host, port, username, and password supplied by your mail provider.
   - The built-in sender can cover low-volume evaluation, but its strict quota can block recovery or secure email change after signup messages. Use custom SMTP for reliable public delivery or higher limits.
   - Test with a confirmed account. If delivery fails, inspect **Logs** → **Auth Logs** and use the Auth error code, not its raw message, for diagnosis.
   - Supabase Auth rejects an Auth invitation for an already-registered address. The TraceBox invitation remains valid and returns a one-time manual link.

4. **GitHub OAuth (Optional)**:
   - Go to GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
   - Application name: `TraceBox`
   - Homepage URL: `https://<your-vercel-app-name>.vercel.app`
   - Authorization callback URL: `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
   - Copy Client ID and Client Secret into Supabase **Authentication** → **Providers** → **GitHub**.

5. **GitHub App repository access**:
   - Create a GitHub App for TraceBox. This is separate from the Supabase GitHub provider used for login.
   - Enable **Request user authorization (OAuth) during installation** so the callback can verify that the installer owns the installation.
   - Set the callback URL to `https://<your-vercel-domain>/api/github/callback` (and the localhost equivalent when testing locally).
   - Request read-only repository permissions: **Metadata**, **Pull requests**, **Contents**, **Checks**, and **Commit statuses**. Add **Actions: Read** only if workflow-run data is later required.
   - Enable App webhooks for `pull_request`, `push`, `installation`, `installation_repositories`, `installation_target`, `repository`, `check_run`, `check_suite`, and `status` events.
   - Set the App webhook URL to `https://<your-vercel-domain>/api/webhooks/github` and use the same random secret as `GITHUB_WEBHOOK_SECRET`.
   - Record the App ID, App slug, Client ID, Client Secret, and downloaded private key for Vercel. The private key and client secret remain server-only.

---

### 1.5 Verify Realtime Publication

1. In Supabase Dashboard, go to **Database** → **Publications**.
2. Click `supabase_realtime`.
3. Confirm that the following interactive tables are checked:
   - `comments`
   - `issues`
   - `notifications`
   - `issue_watchers`
   - `issue_links`
   - `issue_events`
   - `attachments`
---

## Step 2: Local Environment Setup

1. In your local repository root, edit `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-public-key>
   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
   GEMINI_API_KEY=<server-only-gemini-api-key>
   GITHUB_WEBHOOK_SECRET=<random-webhook-secret>
   GITHUB_APP_ID=<github-app-id>
   GITHUB_APP_SLUG=<github-app-slug>
   GITHUB_APP_CLIENT_ID=<github-app-client-id>
   GITHUB_APP_CLIENT_SECRET=<github-app-client-secret>
   GITHUB_APP_PRIVATE_KEY=<github-app-private-key-with-escaped-newlines>
   GITHUB_APP_CALLBACK_URL=http://localhost:3000/api/github/callback
   GITHUB_API_VERSION=2022-11-28
   CRON_SECRET=<random-vercel-cron-secret>
   ```
2. Keep `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, and `GITHUB_WEBHOOK_SECRET` server-only. Never prefix them with `NEXT_PUBLIC_`, commit them, or expose them in browser code.
3. Start the local server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000` in your browser.

---

## Step 3: Vercel Deployment

### 3.1 Push Local Changes to GitHub

Push your local commits to your remote repository:

```bash
git push origin main
```

### 3.2 Import Project to Vercel

1. Log in to [vercel.com](https://vercel.com) and click **Add New...** → **Project**.
2. Select your `TraceBox` GitHub repository and click **Import**.
3. **Framework Preset**: Ensure `Next.js` is selected.
4. **Root Directory**: `./` (default).
5. **Build and Output Settings**: Leave defaults (`npm run build`).

### 3.3 Add Environment Variables

In Vercel **Settings → Environment Variables**, add these to the environments that need them:

| Variable | Value | Scope |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key | Browser + server |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role secret | Server-only API routes |
| `GEMINI_API_KEY` | Google AI Studio API key for explicit Trace Intelligence requests | Server-only intelligence routes |
| `GITHUB_WEBHOOK_SECRET` | Random webhook signing secret | Server-only webhook route |
| `GITHUB_APP_ID` | GitHub App numeric ID | Server-only JWT signing |
| `GITHUB_APP_SLUG` | GitHub App URL slug | Installation redirect |
| `GITHUB_APP_CLIENT_ID` | GitHub App OAuth client ID | Server-only installation verification |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App OAuth client secret | Server-only code exchange and state signing |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App PEM private key | Server-only installation tokens |
| `GITHUB_APP_CALLBACK_URL` | Exact App OAuth callback URL | Server-only code exchange |
| `GITHUB_API_VERSION` | GitHub REST API version | Server-side GitHub API requests |
| `CRON_SECRET` | Vercel Cron bearer secret | Server-only reconciliation route |

The service-role key is required by `/api/v1/*` and `/api/webhooks/github`. Vercel server functions may use it, but it must never be named `NEXT_PUBLIC_*`, exposed in client code, returned by an endpoint, logged, or committed.

Trace Intelligence uses `gemini-3.1-flash-lite` through the Google Gemini API only after a user chooses Analyze, Parse, or Generate. TraceBox uses the text-generation endpoint because its responses require structured JSON; Gemini 3.1 Flash Lite is optimized for high-frequency lightweight tasks and supports structured outputs. Gemini 3.1 Flash Live is a separate real-time audio model and does not support structured outputs. Before enabling `GEMINI_API_KEY` in production, review Google’s current Gemini API quotas, data controls, and regional terms. Restricted and security issues are blocked from external inference; comments, attachment bodies, webhook payloads, credentials, and email addresses are never provider context. Without `GEMINI_API_KEY`, deterministic report quality, advanced filters, readiness scoring, duplicate candidates, and the local blast-radius graph remain available.

### 3.5 API and webhook contract

The deployed API routes are:

- `GET /api/v1/projects` — `projects:read`
- `GET|POST /api/v1/issues` — `issues:read` / `issues:write`
- `GET /api/v1/issues/:issueKey` — `issues:read`
- `POST /api/v1/issues/:issueKey/comments` — `comments:write`
- `GET /api/v1/milestones` — `milestones:read`
- `GET /api/v1/search` — `search:read`
- `GET /api/v1/projects/:projectId/github/repositories` — `integrations:read`
- `GET /api/v1/issues/:issueKey/github-links` — `github_links:read`
- `POST /api/v1/issues/:issueKey/github-links` — `github_links:write`
- `DELETE /api/v1/issues/:issueKey/github-links/:linkId` — `github_links:write`

Legacy `read` and `write` token scopes remain accepted for compatibility. New
tokens should use the narrow resource scopes above. Every API request must use
`Authorization: Bearer <token>`; never put a token in a URL or browser bundle.

The GitHub App connection starts at `/api/github/connect?project_id=<uuid>` and returns through `/api/github/callback`. The callback validates the signed TraceBox state and verifies the installation by finding the callback ID in the paginated GitHub user-token `GET /user/installations` response before persisting it. The settings page then lists repositories returned by the App, and a project binding can select multiple repositories. A GitHub project key is chosen in TraceBox (for example, `BUG`), so webhook references must use the issue key generated by that project, such as `BUG-1`.

The GitHub webhook accepts signed `pull_request`, `push`, `check_run`, `check_suite`, `status`, installation lifecycle, repository, and repository-selection events at `/api/webhooks/github`. GitHub must send `X-Hub-Signature-256` and `X-GitHub-Delivery`; the signature is generated from the raw request body using `GITHUB_WEBHOOK_SECRET`. Delivery IDs are persisted before acknowledgement, then claimed atomically by the processor. `after()` is only a fast path; `/api/github/webhook-replay` and the daily reconciliation job retry eligible failures with bounded backoff and an eight-attempt cap. `/api/github/webhook-cleanup` clears old terminal payload bodies while retaining delivery metadata. Service-role RPCs use the PostgREST-compatible claim helper, and authorization failures invalidate the short-lived token cache. Issue keys are read case-insensitively and closing directives support multiple keys; merged pull requests can resolve linked issues only when the project binding enables it, the PR targets a configured branch, and the PR body/title uses a closing phrase such as `Fixes CORE-123`.

`/api/github/reconcile` is protected by `CRON_SECRET` and refreshes App-visible repositories and previously linked pull-request artifacts once daily at 03:00 UTC. It also replays stale webhook deliveries, clears expired terminal payloads, marks revoked installations and removed repositories unavailable, and never deletes historical issue links. Protected `/api/attachments/reconcile` also requires `CRON_SECRET`; invoke it manually or through a separately configured scheduler to remove orphaned attachment rows/objects. It is not included in the existing Vercel cron entry. The issue GitHub section searches only project-bound repositories and links authoritative PR data through `/api/github/link-pull-request`; URL linking remains available for commits, branches, and unusual cases. The public GitHub-link API performs the same repository, pull-request, commit, or branch verification as the dashboard before creating a link.

### 3.4 Deploy

1. Click **Deploy**.
2. Vercel will run `npm run build`, generate static/dynamic pages, and deploy to your production domain (e.g. `https://tracebox.vercel.app`).

---

## Step 4: Live End-to-End Verification Walkthrough

Once deployed (or running locally), verify the full user experience across all 20 phases. This checkout contains an ignored, local-only Playwright suite under `qa/live/`; run it first with a disposable API token and webhook secret, then perform the authenticated browser flow below. Do not push its `.env`, browser state, `test-results/`, or `playwright-report/` artifacts.

1. **Sign Up**: Navigate to `/signup`, create an account (`admin@example.com`), and verify immediate login.
2. **Onboarding**: You will be automatically redirected to `/onboarding`. Enter workspace name (e.g. `Acme Corp`) and create your initial project (e.g. `Core Engine` with key `CORE`).
3. **Command Center**: View the dashboard overview with calculated open/in-progress metrics and recent issues.
4. **Issue Creation**: Click **New issue** (`/dashboard/issues/new`), select an issue template (e.g. Security bug template), verify auto-fill, and file the issue. Verify it redirects to `CORE-1`.
5. **Issue Table**: Navigate to `/dashboard/issues`. Test search (by title or `CORE-1`), status/priority filters, column visibility dropdown, and inline field editing.
6. **Triage Inbox**: Navigate to `/dashboard/triage`. Use `J`/`K` to navigate, `A` to accept, `R` to reject, or `D` to resolve duplicates.
7. **Release Readiness**: Navigate to `/dashboard/readiness`. View the explainable 0–100% release gate score, blocker penalties, and risk lists.
8. **Reports & Velocity**: Navigate to `/dashboard/reports`. View MTTR turnaround, created vs resolved metrics, and issue aging distributions.
9. **Issue Detail & Collaboration**:
   - Add a comment containing `@mention` or a reference like `CORE-1`.
   - Upload a file or screenshot attachment (up to 50MB) and test image lightbox preview.
   - Click **Watch** to subscribe to issue updates.
   - Use the **Status dropdown** to transition the issue to `RESOLVED` (selecting resolution `FIXED`).
   - Add planning labels, versions, or milestone associations.
   - Link related issues (e.g. `BLOCKS`, `DUPLICATE_OF`) and GitHub pull requests.
10. **Notification Center**: Trigger an event or mention and check the bell icon in the top header.
11. **Settings**: Go to `/dashboard/settings` and test component creation, label management, version archival, milestone tracking, and workflow visualization.
12. **Log Out**: Click your avatar menu in the top right → **Log out**. Verify protected routes redirect to `/login`.
13. **GitHub OAuth**: On `/login`, click **Continue with GitHub** and verify the browser reaches GitHub’s authorization page, then complete the flow with a disposable GitHub account and confirm the callback returns to TraceBox.
14. **GitHub integration**: In `/dashboard/settings/integrations`, click **Connect GitHub**, complete the GitHub App installation, select an accessible repository, and configure target branches such as `main` or `release/*`. Create the test issue in TraceBox first, then open a PR in the bound repository with `Fixes <PROJECT_KEY>-<NUMBER>` in its title/body and target the configured branch. Verify the normalized PR link appears, then merge it and verify `RESOLVED / FIXED`. A commit containing `Refs <PROJECT_KEY>-<NUMBER>` should create a reference without auto-resolving. Test a repository that is not selected and confirm it cannot be chosen or queried.
15. **Restricted issues**: Set an issue to restricted, grant only project members, verify an ungranted member cannot open/search/read its comments, attachments, labels, links, or notifications.
16. **Custom fields and API**: Create a custom field, set its value on an issue, create narrow read/write tokens, verify allowed and denied scopes, test pagination and search/milestones/comments, then revoke a token and verify `401` responses.

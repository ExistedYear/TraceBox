# Release Validation Log

## 1. GitHub OAuth Authentication
- **Status**: Source flow implemented. A fresh deployment still requires external provider configuration; a provider error is not fixed in application code until these settings exist.
- **Setup requirements**:
  1. **GitHub Developer Settings** (`https://github.com/settings/developers` → OAuth Apps):
     - **Homepage URL**: `http://localhost:3000` (or `https://<your-vercel-domain>.vercel.app`)
     - **Authorization callback URL**:
       ```text
       https://<your-supabase-project-ref>.supabase.co/auth/v1/callback
       ```
     - Copy **Client ID** and generate a **Client Secret**.
  2. **Supabase Dashboard** (`Authentication` → `Providers` → `GitHub`):
     - Enable GitHub provider and paste `Client ID` and `Client Secret`.
  3. **Supabase URL Configuration** (`Authentication` → `URL Configuration`):
     - **Site URL**: `https://<your-vercel-domain>.vercel.app` (or `http://localhost:3000`)
     - **Redirect URLs**:
       - `https://<your-vercel-domain>.vercel.app/**`
      - `http://localhost:3000/**`

## 1.1 GitHub App repository connection
- **Status**: Hosted flow verified on 2026-08-28 with a private repository. It still requires a GitHub App installation and Vercel server variables in each deployment.
- GitHub login and repository access are intentionally separate. Login creates the TraceBox session; **Connect GitHub** in project settings performs an explicit App installation.
- The callback verifies the signed TraceBox state and checks the installation by paginating the user-token `GET /user/installations` response before persisting it. GitHub does not provide `GET /user/installations/{installation_id}`.
- Repository access is read-only and selected per GitHub account/organization. The project can bind multiple verified repositories.
- A PR containing `Fixes BUG-1` was linked through the signed webhook and resolved after merging into the configured `main` branch. Delivery idempotency and lifecycle handling remain implemented; daily reconciliation and broader multi-user/API testing remain to be exercised.

---

## 2. Password recovery and signup validation
- **Status**: Implemented.
- `/login` now has a **Forgot password?** entry point.
- `/forgot-password` sends a recovery email through Supabase Auth.
- `/reset-password` updates the password after the recovery session is established.
- Signup requires matching password and confirmation fields.

## 3. External deployment validation

- **Status**: Partially complete; remaining items are environment verification, not the resolved GitHub callback/webhook defects.
- The linked project is reconciled through migration `202608260078`, including forward-only drift repairs, database-bounded API issue queries, tenant-scoped profile visibility, role/project-scoped GitHub catalogs, and live API token-owner project membership. Compare the linked ledger and live catalog before every future push.
- The GitHub App installation, repository binding, webhook PR linking, and branch-aware merge resolution path are verified on the hosted deployment.
- Still verify the private `issue-attachments` bucket, Storage policies, Realtime publication, Auth redirect URLs, API scopes, both reconciliation paths (including protected `/api/attachments/reconcile`, which is not in the existing Vercel cron), and broader multi-user/RLS behavior. Template, custom-field, attachment, and API-token browser journeys also remain external checks.

## 4. Live-test limitation

Source-level gates and the core hosted GitHub flow pass. The committed `playwright/` suite provides credential-free public/protection smoke and explicitly skips fixture-dependent account journeys when fixtures are absent. API and webhook tests mock GitHub boundaries and require no GitHub environment file. The older ignored `qa/live/` suite remains optional for deployment-specific checks; never commit its environment, browser state, or generated artifacts.

## 5. Persistent Contributors panel

- **Status**: Source defect resolved. The persistent project Contributors panel and its complete RPC-backed management flow are implemented. Hosted two-user validation remains an external release check, not missing source work.
- Add a dedicated **Contributors** panel for each project. It should remain directly accessible in the project shell rather than being hidden inside unrelated settings tabs; default it open on the project-facing screen.
- The panel should show each contributor’s avatar/display name, organization role, project role, and access state.
- It should provide the complete contributor workflow: invite a user, add an existing workspace member, assign/change project role, remove project access, and clearly report pending invitations or failed actions.
- The panel must use authenticated server-side RPCs and RLS; contributors must never be managed through unrestricted browser table writes.
- Acceptance: an owner/maintainer can open a project, see its contributors in the separate panel, invite or add a second contributor, assign a role, and remove that access. The second contributor can sign in and immediately find the project without manual SQL.

The original note also said “add public contributions for repos.” Public GitHub contribution attribution is repository/commit identity and submission metadata, not a TraceBox product feature. It is therefore outside this bug; no unfinished in-product contribution feature is implied.

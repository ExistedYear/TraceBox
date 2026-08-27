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
- **Status**: Implemented in source; requires a GitHub App installation and Vercel server variables.
- GitHub login and repository access are intentionally separate. Login creates the TraceBox session; **Connect GitHub** in project settings performs an explicit App installation.
- The callback verifies the signed TraceBox state and checks the installation through GitHub user authorization before persisting it.
- Repository access is read-only and selected per GitHub account/organization. The project can bind multiple verified repositories.
- Verify App webhook events, delivery idempotency, lifecycle status changes, branch-aware auto-resolution, and six-hour reconciliation after deployment.

---

## 2. Password recovery and signup validation
- **Status**: Implemented.
- `/login` now has a **Forgot password?** entry point.
- `/forgot-password` sends a recovery email through Supabase Auth.
- `/reset-password` updates the password after the recovery session is established.
- Signup requires matching password and confirmation fields.

## 3. External deployment validation

- **Status**: Pending external setup, not a source-code defect.
- Apply migrations `202608260001` through `202608260040` to the intended Supabase project.
- Verify the private `issue-attachments` bucket, Storage policies, Realtime publication, Auth redirect URLs, Vercel server-only variables, and GitHub webhook.
- Run the full live flow documented in `deployment.md`, including restricted issue isolation, attachment lifecycle, API-token scopes, and webhook linking.

## 4. Live-test limitation

The source-level gates pass, but hosted behavior must be verified after the commit is deployed. The local-only `qa/live/` suite checks route presence, OAuth redirect behavior, API scope behavior, webhook HMAC validation, and optional disposable writes. It must be run with the production URL and secrets supplied through its ignored `.env` file.

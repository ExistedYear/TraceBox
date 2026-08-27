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

### 1.3 Apply Database Migrations (1 through 29) via SQL Script

You do **not** need the Supabase CLI. You can apply all 29 migrations directly in the Supabase web dashboard:

#### Method A: Single Consolidated Script (Recommended)

1. Open the Supabase Dashboard → click **SQL Editor** in the left sidebar.
2. Click **+ New Query**.
3. Open the file `supabase/full_schema.sql` from this repository (which consolidates all 29 ordered migrations).
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

---

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

3. **GitHub OAuth (Optional)**:
   - Go to GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
   - Application name: `TraceBox`
   - Homepage URL: `https://<your-vercel-app-name>.vercel.app`
   - Authorization callback URL: `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
   - Copy Client ID and Client Secret into Supabase **Authentication** → **Providers** → **GitHub**.

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
   ```
2. Start the local server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:3000` in your browser.

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

In the Vercel **Environment Variables** section, add the following (for Production, Preview, and Development):

| Variable Name | Value | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Your Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOi...` | Your Supabase Anon Public Key |

*(Never add `SUPABASE_SERVICE_ROLE_KEY` to Vercel client environment variables).*

### 3.4 Deploy

1. Click **Deploy**.
2. Vercel will run `npm run build`, generate static/dynamic pages, and deploy to your production domain (e.g. `https://tracebox.vercel.app`).

---

## Step 4: How to Reset / Remove Migration History Without Deleting Data

If you need to clear or reset the recorded migration history (for example, to re-baseline migrations, resolve out-of-sync CLI records, or clean up tracking metadata) **without dropping tables or losing any existing rows in your database**:

### Method 1: Clear the Migration Tracking Table in SQL Editor (Web Dashboard)
Supabase tracks applied migrations in an internal table called `supabase_migrations.schema_migrations`. Your actual application data lives in the `public` schema (`public.issues`, `public.projects`, `public.profiles`, etc.).

To clear the recorded migration history without touching any table or row data:
1. Open Supabase Dashboard → **SQL Editor**.
2. Run:
   ```sql
   -- This only clears the migration tracking log; your tables and data in public.* remain 100% intact.
   TRUNCATE TABLE supabase_migrations.schema_migrations;
   ```
3. To remove only specific migration versions from the record:
   ```sql
   DELETE FROM supabase_migrations.schema_migrations
   WHERE version >= '202608260015';
   ```

### Method 2: Mark Migrations as Reverted via Supabase CLI (Without Running Down DDL)
If you are using the CLI and want to mark migrations as unapplied in the tracking state without modifying tables:
```bash
npx supabase migration repair --status reverted <migration_version>
```
To mark migrations as already applied (so Supabase skips executing them again while keeping your existing schema and data intact):
```bash
npx supabase migration repair --status applied <migration_version>
```

---

## Step 5: Live End-to-End Verification Walkthrough

Once deployed (or running locally), verify the full user experience across all 20 phases:

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

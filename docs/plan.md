# Bugzilla Reconstruction — Deployment Foundation Plan

## Goal

Create the smallest production-ready foundation for the project so that:

- the frontend is deployed on Vercel
- the backend is running on Supabase
- authentication works
- the application can read/write to Supabase securely
- database migrations are version-controlled
- local development and production environments are configured
- future features can be shipped incrementally without restructuring the project

This phase is intentionally limited to infrastructure and boilerplate.

## Current repository status

This foundation plan is historical and complete as a deployment-foundation milestone. Product source implementation continues through Phase 20 in `docs/tracebox-main-plan.md`; remaining UI, integration, and hosted-validation gaps are tracked in `docs/incomplete.md`, and the current deployment checklist is maintained in `deployment.md`.

---

# 1. Stack

Use:

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase PostgreSQL
- Supabase Auth
- Supabase Storage
- Supabase Realtime
- Vercel
- Zod
- React Hook Form

Do not add unnecessary infrastructure yet.

Do not add:

- Redis
- external search engines
- queues
- microservices
- Docker deployment
- Kubernetes
- AI features

---

# 2. Repository Initialization

Create a Next.js project.

Recommended settings:

```text
TypeScript: Yes
ESLint: Yes
Tailwind CSS: Yes
src/ directory: Yes
App Router: Yes
Turbopack: Yes
```

Install the initial dependencies required for Supabase and form validation.

Suggested core packages:

```text
@supabase/supabase-js
@supabase/ssr
zod
react-hook-form
@hookform/resolvers
```

Initialize shadcn/ui.

Only add the components required for the initial shell.

Recommended first components:

```text
button
input
card
dropdown-menu
avatar
separator
sheet
sonner
```

---

# 3. Initial Repository Structure

Use approximately:

```text
src/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   │   └── page.tsx
│   │   └── signup/
│   │       └── page.tsx
│   │
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   └── dashboard/
│   │       └── page.tsx
│   │
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts
│   │
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
│
├── components/
│   ├── ui/
│   ├── auth/
│   └── layout/
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   │
│   ├── auth/
│   ├── validation/
│   └── utils.ts
│
├── types/
│   └── database.ts
│
└── middleware.ts

supabase/
├── migrations/
├── seed.sql
└── config.toml
```

Keep feature-specific folders out until features actually exist.

---

# 4. Supabase Project Setup

Create a new Supabase project.

Enable:

```text
PostgreSQL
Auth
Storage
Realtime
```

For the initial phase, authentication should support:

```text
Email + Password
GitHub OAuth
```

GitHub OAuth can be added immediately if credentials are available.

Otherwise deploy with email/password first and add GitHub login afterward.

---

# 5. Supabase CLI

Install and initialize the Supabase CLI.

The project repository should contain:

```text
supabase/
```

Use migrations for every schema change.

Do not manually make production-only schema changes through the dashboard without creating a migration afterward.

The expected workflow should become:

```text
make schema change locally
↓
create migration
↓
test locally
↓
commit migration
↓
apply to production
```

---

# 6. Environment Variables

Create:

```text
.env.local
```

Required variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Rules:

```text
NEXT_PUBLIC_SUPABASE_URL
→ safe for frontend use

NEXT_PUBLIC_SUPABASE_ANON_KEY
→ safe for frontend use when RLS is configured

SUPABASE_SERVICE_ROLE_KEY
→ server only
→ never expose to browser code
→ never commit to Git
```

Add `.env.local` to `.gitignore`.

Provide:

```text
.env.example
```

Example:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

No real secrets belong in `.env.example`.

---

# 7. Supabase Client Setup

Create separate Supabase clients.

## Browser Client

```text
src/lib/supabase/client.ts
```

Used by Client Components.

## Server Client

```text
src/lib/supabase/server.ts
```

Used by:

```text
Server Components
Server Actions
Route Handlers
```

It must handle the authenticated user's cookies correctly.

## Admin Client

Do not create a globally exposed admin client.

If service-role access is needed later, create a server-only utility and ensure it cannot be imported into client bundles.

---

# 8. Authentication Middleware

Add middleware that refreshes Supabase authentication sessions.

Protected routes:

```text
/dashboard/*
```

Unauthenticated users attempting to access protected routes should be redirected to:

```text
/login
```

Authenticated users opening:

```text
/login
/signup
```

may optionally be redirected to:

```text
/dashboard
```

Do not rely solely on middleware for authorization.

Database access must still be protected through RLS.

---

# 9. Initial Database Schema

Do not build the entire future schema yet.

Create only what is needed for the deployed foundation.

## profiles

```text
profiles

id UUID PRIMARY KEY
display_name TEXT
avatar_url TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

`profiles.id` should reference:

```text
auth.users.id
```

Create a database trigger that automatically creates a profile when a new Supabase Auth user is created.

---

# 10. Row Level Security

Enable RLS immediately.

For `profiles`:

```text
SELECT
→ authenticated users may read profiles

UPDATE
→ user may update only their own profile
```

Do not disable RLS to make development easier.

The system must be designed assuming RLS stays enabled permanently.

---

# 11. Initial Migration

The first migration should contain:

```text
profiles table
profile timestamps
new-user profile creation trigger
RLS enablement
profile SELECT policy
profile UPDATE policy
```

Name migrations clearly.

Example:

```text
202608260001_initial_profiles.sql
```

Future migrations should follow the same pattern.

---

# 12. Database Types

Generate TypeScript types from the Supabase schema.

Store them in:

```text
src/types/database.ts
```

Use generated types when creating Supabase clients.

Regenerate types after schema changes.

Avoid manually maintaining duplicate database interfaces unless necessary for domain-specific derived types.

---

# 13. Initial Pages

The first deployment only needs the following pages.

## `/`

Simple landing page.

Required content:

```text
project name
short description
Login button
Get Started button
```

Keep this minimal.

## `/login`

Support:

```text
email
password
login button
GitHub login button if configured
signup link
```

## `/signup`

Support:

```text
display name
email
password
create account button
login link
```

## `/dashboard`

Protected route.

Display:

```text
Welcome, <display name>

Authenticated as:
<email>

Deployment Status

✓ Next.js
✓ Vercel
✓ Supabase
✓ Authentication
✓ Database connection
```

This page exists primarily to prove the entire stack works.

---

# 14. Application Shell

Create a minimal authenticated layout.

Suggested desktop shell:

```text
┌─────────────────────────────────────────────┐
│ Logo / Project Name        User Avatar      │
├───────────────┬─────────────────────────────┤
│ Dashboard     │                             │
│               │        Page Content         │
│               │                             │
└───────────────┴─────────────────────────────┘
```

Only include navigation that actually exists.

Initial sidebar:

```text
Dashboard
```

Do not add fake navigation for features that have not been implemented.

The sidebar can grow continuously as features ship.

---

# 15. UI Guidelines

Establish basic UI consistency before shipping feature work.

Use:

```text
shadcn/ui
Tailwind CSS
Lucide icons
```

General rules:

- no huge gradients
- no excessive cards
- no placeholder lorem ipsum
- no unnecessary explanatory text
- desktop-first developer-tool layout
- responsive enough for tablet/mobile
- dark mode can be added now if trivial, otherwise later
- maintain information density suitable for a developer product

Create reusable layout components such as:

```text
AppSidebar
AppHeader
UserMenu
PageHeader
```

Do not prematurely build a large design system.

---

# 16. Error Handling

Add a basic global strategy for errors.

Use:

```text
Next.js error boundaries
toast notifications
server-side logging
structured API errors
```

Do not expose:

```text
database errors
SQL details
service-role credentials
stack traces
```

to production users.

---

# 17. Loading States

Every asynchronous page should have a reasonable loading state.

Create:

```text
loading.tsx
```

where useful.

Use skeletons only where they improve the experience.

Avoid excessive loading animations.

---

# 18. Vercel Setup

Connect the GitHub repository to Vercel.

Configure:

```text
Production branch: main
Framework preset: Next.js
```

Add environment variables in Vercel:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Set them for:

```text
Production
Preview
Development
```

Use separate Supabase projects for preview environments later if necessary.

For now, preview deployments may use the development Supabase instance if the team understands the implications.

---

# 19. Supabase Auth URLs

Configure Supabase Auth URL settings.

Production site URL:

```text
https://<vercel-production-domain>
```

Add allowed redirect URLs for:

```text
http://localhost:3000/**
https://<vercel-production-domain>/**
https://*.vercel.app/**
```

When a custom domain is added, add it explicitly.

Ensure OAuth providers use the correct Supabase callback URL.

---

# 20. GitHub OAuth

If implementing GitHub login immediately:

Create a GitHub OAuth application.

Configure the callback URL using the callback URL supplied by Supabase.

Store:

```text
GitHub Client ID
GitHub Client Secret
```

inside Supabase Auth provider configuration.

Do not expose the GitHub client secret in frontend environment variables.

Test:

```text
GitHub login
→ Supabase callback
→ session created
→ profile created
→ redirect to dashboard
```

---

# 21. Vercel Deployment Test

The initial deployment is complete only when the production URL supports this full flow:

```text
Open application
↓
Create account
↓
Profile automatically created
↓
Login
↓
Dashboard opens
↓
Reload page
↓
Session remains active
↓
Logout
↓
Protected dashboard redirects to login
```

Also verify GitHub OAuth if enabled.

---

# 22. Database Connection Test

The dashboard should perform at least one authenticated database query.

Example:

```text
read current user's profile
```

Display the returned display name.

This verifies:

```text
Vercel
→ Next.js
→ Supabase Auth session
→ PostgreSQL
→ RLS
→ application
```

all work end-to-end.

---

# 23. Production Security Minimum

Before considering the boilerplate complete:

- RLS must be enabled on all exposed public tables
- service-role key must only be used server-side
- secrets must not exist in Git history
- `.env.local` must be ignored
- production Auth redirect URLs must be restricted
- profile update policies must prevent editing other users
- production build must pass
- lint must pass
- TypeScript must pass
- authentication routes must be tested
- dashboard must be inaccessible when logged out

---

# 24. Scripts

Recommended package scripts:

```text
dev
build
start
lint
typecheck
test
```

Optional Supabase helper scripts:

```text
db:start
db:stop
db:reset
db:types
```

Agents may add these if useful.

---

# 25. README

Create a concise README covering:

```text
project overview
technology stack
local setup
environment variables
Supabase CLI setup
running migrations
running development server
building
deploying
```

Do not put the full product roadmap into README.

`plan.md` remains the implementation roadmap.

---

# 26. Initial CI

If straightforward, create GitHub Actions for:

```text
npm install
lint
typecheck
build
```

Run on:

```text
pull_request
push to main
```

Do not make CI setup block the initial deployment if it causes unnecessary delay.

Vercel's own build checks are sufficient for the first deployment.

---

# 27. Definition of Done

This phase is complete when all of the following work:

```text
✓ GitHub repository exists
✓ Next.js application runs locally
✓ Tailwind works
✓ shadcn/ui is initialized
✓ Supabase project exists
✓ Supabase CLI is configured
✓ migrations are version controlled
✓ profiles table exists
✓ RLS is enabled
✓ user profile trigger works
✓ email/password signup works
✓ login works
✓ logout works
✓ auth middleware works
✓ protected dashboard works
✓ authenticated Supabase query works
✓ database types are generated
✓ Vercel project exists
✓ production environment variables are configured
✓ production deployment succeeds
✓ production signup/login works
✓ production dashboard works
✓ production database connection works
```

---

# 28. Do Not Build Yet

Do not implement the actual Bugzilla reconstruction features during this phase.

Specifically leave these for subsequent plans:

```text
organizations
projects
project members
components
issues
comments
labels
attachments
milestones
versions
workflows
notifications
search
saved views
analytics
triage
duplicate detection
GitHub issue/PR integration
custom fields
release readiness
API tokens
```

The purpose of this phase is only to establish a clean deployable base.

---

# 29. Continuous Shipping Strategy

Once this foundation is deployed, development should move in small vertical slices.

Recommended future sequence:

```text
Foundation
↓
Organizations + Projects
↓
Issue Creation
↓
Issue List + Issue Detail
↓
Comments + Activity
↓
Components + Versions + Milestones
↓
Workflow + Assignment
↓
Search + Filters
↓
Notifications
↓
Dependencies + Duplicates
↓
Analytics
↓
Advanced / Innovation Features
```

Each slice should be:

```text
implemented
↓
migrated
↓
tested
↓
merged
↓
deployed
```

Avoid giant feature branches.

The production deployment should remain usable after every merge.

---

# 30. Agent Instruction

The agent implementing this plan should prioritize:

1. correctness
2. deployment
3. database security
4. maintainable structure
5. minimal unnecessary abstraction

Do not start future product features during this phase.

If a design choice is uncertain, choose the simplest implementation that:

- works correctly on Vercel
- works correctly with Supabase
- keeps RLS enabled
- can be extended later without major migration work

The final result of this phase should be a small but fully deployed application that proves the entire Vercel + Supabase stack before additional product functionality is introduced.

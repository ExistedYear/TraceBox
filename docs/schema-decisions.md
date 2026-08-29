# TraceBox Schema Decisions

This document records intentional differences between the historical roadmap in `docs/archive/tracebox-main-plan.md` and the production contract represented by the ordered migrations. The migrations, generated `Database` type, active plans, and this decision record are authoritative for current behavior.

| Historical idea | Current decision | Reason and observable contract |
|---|---|---|
| A separate profile `username` | Not implemented; identity uses immutable Auth user ID plus `profiles.display_name` and optional `avatar_url`. | Mentions persist user IDs and display labels, so uniqueness does not depend on a renameable username. Profile rows are readable only by the user or collaborators sharing a workspace. |
| Saved-view owner/scope columns from early sketches | Use `created_by`, `project_id`, `organization_id`, and `visibility` (`PRIVATE`, `PROJECT`, `ORGANIZATION`). | This is the shipped sharing model. Owners manage lifecycle; RLS resolves visibility. Stable links use `?view=<uuid>`. |
| Notification email-delivery columns | In-app notifications only. | Preferences cover retained in-app categories. The product does not advertise email notification delivery, and the schema intentionally has no email queue/provider state. Auth emails remain a Supabase Auth concern. |
| A generic integration secret reference | GitHub App credentials are server environment variables; installations, repositories, bindings, artifacts, and deliveries use normalized tables. | GitHub private keys, client secrets, installation tokens, webhook secrets, and payloads are never exposed to browser tables. `project_integrations` remains a compatibility projection, not a secret store or canonical repository model. |
| Issue visibility values including `PUBLIC` | Canonical values are `PROJECT` and `RESTRICTED`. | Historical `PUBLIC` input is normalized to `PROJECT` by reconciliation migrations. `can_view_issue` is the common authorization boundary for restricted issue-owned data. |
| Seeded demo workspaces/issues | `supabase/seed.sql` is intentionally empty. | Production and clean development resets create no synthetic tenant data. Browser/database suites create isolated fixtures explicitly so demo identities cannot be confused with real accounts. |

Applied migration files are immutable deployment history. When a deployed contract differs from a historical file or a new audit finds drift, the repair is a new forward-only migration; editing an already-recorded version is never considered a deployment mechanism.

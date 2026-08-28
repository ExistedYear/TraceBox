# TraceBox Collaboration, Roles, and GitHub Dashboard Plan

## Objective

Build a complete collaboration and integration administration experience around the authorization model TraceBox already uses.

The finished product must let a workspace owner or project maintainer invite people, assign project roles, understand effective access, and administer GitHub without using Supabase SQL manually. Developers must be able to use repository-bound pull-request features without seeing controls they cannot execute. Every badge and control must reflect backend authorization rather than duplicated client assumptions.

This plan covers only:

- authentication and invitation entry points that affect collaboration;
- workspace and project membership;
- Developer and Maintainer role experiences;
- role-aware dashboard navigation and badges;
- GitHub App installation, repository binding, automation, health, and PR-linking UI;
- tests for those paths.

It does not redesign the general issue tracker, reports, planning, or unrelated settings.

---

## Product semantics

### Authentication is not authorization

TraceBox has one account system. A user may authenticate with:

- email and password; or
- GitHub OAuth through Supabase Auth.

There will not be separate “Developer login” and “Maintainer login” pages. `DEVELOPER` and `MAINTAINER` are project roles assigned after authentication.

GitHub OAuth is also separate from GitHub App repository access:

```text
GitHub OAuth login
  -> proves the user identity to Supabase
  -> creates/opens a TraceBox session

GitHub App installation
  -> grants a TraceBox workspace read access to selected repositories
  -> may only be managed by an effective project Maintainer
```

The login and integration pages must state this distinction explicitly.

### Effective role hierarchy

Workspace roles remain:

```text
OWNER > ADMIN > MEMBER > VIEWER
```

Project roles remain:

```text
MAINTAINER > DEVELOPER > REPORTER > VIEWER
```

Effective project-role rules:

1. Workspace `OWNER` and `ADMIN` always resolve to project `MAINTAINER`.
2. Other workspace members use their explicit `project_members.role`.
3. A user without project access has no project role.
4. UI badges must display the effective role returned by the backend.
5. UI visibility is convenience only; RPCs and route handlers remain the authorization boundary.

### Capability matrix

| Capability | Owner/Admin | Maintainer | Developer | Reporter/Viewer |
|---|---:|---:|---:|---:|
| View workspace members | Yes | Yes, for maintained projects | Yes, project members only | Optional project roster only |
| Invite workspace users | Yes | Current project only, as workspace Member | No | No |
| Change workspace role | Yes | No | No | No |
| Assign project roles | Yes | Yes, within maintained project | No | No |
| Remove project access | Yes | Yes, within maintained project | No | No |
| Install/reconnect GitHub App | Yes | Yes | No | No |
| Sync repository access | Yes | Yes | No | No |
| Bind/unbind repositories | Yes | Yes | No | No |
| Configure primary repo/branches/auto-resolve | Yes | Yes | No | No |
| View GitHub health and bound repositories | Yes | Yes | Yes | No settings access |
| Search and link existing pull requests | Yes | Yes | Yes | No |
| View linked PR cards on visible issues | Yes | Yes | Yes | Yes |
| Retry project-scoped failed webhook work | Yes | Yes | No | No |

Project Maintainers may invite an external email only as a workspace `MEMBER`, and only with access to a project they maintain. They cannot grant workspace `ADMIN` or `OWNER`.

TraceBox will continue to request read-only GitHub App permissions. Creating branches, commits, or pull requests from TraceBox is not part of this release because it would require new GitHub write permissions and a separate security review.

---

## Current-state findings

### Already implemented and reusable

- Supabase email/password and GitHub OAuth login.
- Cookie-backed workspace/project selection.
- `organization_members` and `project_members` role tables.
- `project_role(project_id)` with workspace Owner/Admin precedence.
- `can_manage_project(project_id)` and RLS-backed project access.
- Verified GitHub App installation callback.
- Installation/repository lifecycle statuses.
- Multi-repository project bindings.
- Explicit primary repository support.
- Target branches and branch-aware automatic resolution.
- Repository refresh/reconciliation.
- Durable webhook delivery records, replay leases, capped retries, and payload cleanup.
- Pull-request search, authoritative PR linking, normalized artifacts, automatic reference parsing, and CI summaries.

### Missing or incomplete user experience

- No invitation table, acceptance flow, or member-management RPCs.
- No supported dashboard flow to add a Developer or Maintainer.
- No way to change or revoke project roles from the product.
- The effective role is shown only in the settings header, not consistently in the application shell.
- Login copy does not explain that GitHub login does not grant repository access.
- A user with a pending invitation is sent toward onboarding rather than invitation acceptance.
- GitHub management controls disappear for Developers without an explanation.
- The repository “Refresh” action does not explain that it performs repository synchronization.
- Installation status cards show raw state but not recommended recovery actions.
- Permission completeness, webhook health, recent delivery failures, replay state, and reconciliation state are not presented in the UI.
- Auto-resolution and target-branch inputs are coupled to repository connection; there is no clear save action for an existing binding.
- Repositories are displayed as a compact list rather than an administrable table with health and automation state.
- Backend webhook replay/cleanup routes are cron-secret operations and have no project-scoped Maintainer UI.
- Test documentation mentions behavior that has no dashboard control and can imply TraceBox creates PRs, which it does not.

---

## Target information architecture

Add these settings destinations:

```text
Project settings
├── Project configuration
├── Members & access
├── Issue templates
├── Custom fields & API
└── Integrations
    └── GitHub
```

The application header/user menu will show the selected workspace, project, and effective project-role badge. The badge links to **Members & access**.

### Members & access page

Route:

```text
/dashboard/settings/members
```

Sections:

1. **Your access**
   - effective project role;
   - workspace role;
   - concise capability summary;
   - explanation when workspace Admin/Owner grants implicit Maintainer access.

2. **Project members**
   - avatar, display name, email;
   - workspace role;
   - explicit project role;
   - effective project role;
   - membership source (`Workspace admin`, `Direct project access`, `Invitation`);
   - status and joined date;
   - role selector and remove action when authorized.

3. **Pending invitations**
   - email;
   - intended workspace/project roles;
   - inviter;
   - expiry;
   - copy link, resend, and revoke actions.

4. **Invite collaborator**
   - email;
   - project role;
   - workspace role only for Owner/Admin;
   - optional additional project assignments for Owner/Admin;
   - clear role descriptions before submission.

### GitHub integration page

Rebuild the current integration manager into five surfaces:

1. **Access banner**
   - effective role badge;
   - explicit description of what this user can do;
   - Developers see disabled management actions with “Maintainer required” help instead of disappearing controls.

2. **Connection overview**
   - overall state: Healthy, Action required, Pending approval, Revoked, Suspended, or Not connected;
   - GitHub account/organization;
   - installation ID for diagnostics;
   - last verified time;
   - accessible/bound repository counts;
   - expected versus granted permissions;
   - status-specific action: Install, Reconnect, Request approval, Open GitHub settings, or Refresh.

3. **Project repositories**
   - repository name and privacy;
   - installation status;
   - access/archived state;
   - primary indicator;
   - default branch;
   - last synchronized time;
   - target branch patterns;
   - auto-resolution toggle;
   - Save, Make primary, and Disconnect actions.

4. **Automation and webhook health**
   - last successful webhook;
   - recent processed/failed delivery counts;
   - terminal failures;
   - last reconciliation result;
   - manual repository sync;
   - Maintainer-only retry action for eligible project deliveries;
   - no raw payload or restricted issue metadata in the browser.

5. **Usage guide**
   - Developers link an existing PR from an issue;
   - `Fixes BUG-1` creates a derived `FIXES` relationship;
   - merging into a configured target branch may resolve the issue;
   - `Refs BUG-1` links without resolving;
   - TraceBox does not create PRs or push code.

---

## Database design

Add migration `202608260044_collaboration_access_dashboard.sql`.

### `organization_invitations`

```text
id uuid primary key
organization_id uuid not null
email text not null
normalized_email text not null
organization_role text not null default MEMBER
token_hash text not null unique
invited_by uuid not null
expires_at timestamptz not null
accepted_at timestamptz null
accepted_by uuid null
revoked_at timestamptz null
created_at timestamptz not null
updated_at timestamptz not null
```

Constraints:

- role is one of `ADMIN`, `MEMBER`, `VIEWER`; invitations never create another Owner;
- normalized email is lowercase and trimmed;
- one active invitation per organization/email;
- expiry is bounded;
- token hashes are stored, raw tokens are returned only when created or rotated.

### `project_invitation_roles`

```text
invitation_id uuid
project_id uuid
role text
created_at timestamptz
primary key (invitation_id, project_id)
```

The project must belong to the invitation’s organization.

### `membership_events`

```text
id uuid primary key
organization_id uuid not null
project_id uuid null
actor_id uuid not null
subject_user_id uuid null
subject_email text null
event_type text not null
old_role text null
new_role text null
metadata jsonb not null default '{}'
created_at timestamptz not null
```

Events include invitation created/revoked/accepted, member added/removed, workspace role changed, and project role changed. Clients may read events only when they can manage the relevant scope. Inserts are RPC-only.

### Membership RPCs

Add security-definer RPCs with explicit grants and top-down row locking:

```text
create_collaboration_invitation(...)
rotate_collaboration_invitation_token(invitation_id)
revoke_collaboration_invitation(invitation_id)
accept_collaboration_invitation(raw_token)
set_workspace_member_role(organization_id, user_id, role)
set_project_member_role(project_id, user_id, role)
remove_project_member(project_id, user_id)
remove_workspace_member(organization_id, user_id)
get_current_access_context(project_id)
```

Rules enforced in SQL:

- no self-promotion;
- only Owner/Admin changes workspace roles;
- project Maintainer operations are confined to maintained projects;
- a project Maintainer-created invitation always uses workspace role `MEMBER`;
- no removal/demotion of the workspace Owner;
- no removal of the last effective project Maintainer;
- no project membership without workspace membership;
- accepting an invitation requires the authenticated user’s normalized verified email to match;
- acceptance is one-time and transactionally creates/updates all membership rows;
- expired or revoked invitations cannot be accepted;
- all changes write `membership_events`.

RLS remains enabled. Browser clients receive SELECT access only where required and mutate through RPCs.

### GitHub operational read model

Add a project-scoped function or server query that returns a sanitized integration summary:

```text
get_project_github_health(project_id)
```

It should derive:

- effective connection state;
- expected/missing permissions;
- active, pending, suspended, revoked, and permission-update installations;
- accessible and bound repository counts;
- latest successful/failed webhook timestamps and counts;
- latest repository sync timestamp;
- eligible replay count.

Do not expose webhook payloads, secrets, installation tokens, private keys, or restricted issue metadata.

Add a project-scoped Maintainer RPC/server action for replaying eligible deliveries associated with repositories bound to that project. Keep the existing cron-secret endpoint for global repair.

---

## Server and API design

### Shared access helper

Create:

```text
src/lib/project-access.ts
```

It returns a typed structure:

```ts
type ProjectAccessContext = {
  workspaceRole: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  explicitProjectRole: "MAINTAINER" | "DEVELOPER" | "REPORTER" | "VIEWER" | null;
  effectiveProjectRole: "MAINTAINER" | "DEVELOPER" | "REPORTER" | "VIEWER" | null;
  source: "WORKSPACE_ADMIN" | "PROJECT_MEMBERSHIP" | "NONE";
  capabilities: {
    manageWorkspaceMembers: boolean;
    manageProjectMembers: boolean;
    manageGithub: boolean;
    linkGithubPullRequests: boolean;
    viewGithubSettings: boolean;
  };
};
```

Pages use this helper for presentation. API routes and RPCs still independently authorize every mutation.

Extend `WorkspaceContext` with the current workspace role and active-project access context so the header, navigation, and pages render the same role without repeated ad hoc comparisons.

### Collaboration routes

```text
GET    /api/collaboration/members?project_id=...
POST   /api/collaboration/invitations
PATCH  /api/collaboration/invitations/[invitationId]
DELETE /api/collaboration/invitations/[invitationId]
PATCH  /api/collaboration/members/[userId]
DELETE /api/collaboration/members/[userId]
GET    /invite/[token]
POST   /api/collaboration/invitations/accept
```

Routes validate UUIDs and Zod payloads, map expected SQL errors to safe messages, return typed JSON, and never log raw invitation tokens.

### GitHub routes

Retain existing routes and make their responsibilities explicit:

```text
GET  /api/github/repositories       complete sanitized dashboard state
POST /api/github/connect            Maintainer installation flow
POST /api/github/sync               Maintainer repository reconciliation
POST /api/github/bind               create binding
PATCH /api/github/bind              save automation settings for existing binding
DELETE /api/github/bind             remove binding, preserve history
POST /api/github/primary            set explicit primary repository
GET  /api/github/health             sanitized project health/activity
POST /api/github/retry              project-scoped eligible replay
```

Every response should include stable error codes such as:

```text
AUTH_REQUIRED
MAINTAINER_REQUIRED
INSTALLATION_REVOKED
INSTALLATION_SUSPENDED
PERMISSION_UPDATE_REQUIRED
REPOSITORY_ACCESS_REMOVED
PROJECT_ARCHIVED
RATE_LIMITED
```

The frontend maps these codes to state-specific actions and copy.

---

## Authentication and invitation UX

### Login/signup page

Update the GitHub button copy to:

```text
Continue with GitHub
Sign in only — repository access is connected separately by a project Maintainer.
```

Preserve a safe `next` target through email/password login, signup confirmation, and GitHub OAuth callback.

When `next` points to an invitation:

- login says “Sign in to accept your TraceBox invitation”;
- signup says “Create an account to join the workspace”;
- after authentication, the user returns to the invitation acceptance page.

### Invitation acceptance page

Route:

```text
/invite/[token]
```

States:

- signed out: show workspace/project names and sign-in/signup actions;
- signed in with matching email: show roles and Accept invitation;
- signed in with another email: explain the mismatch and allow account switching;
- expired/revoked/already accepted: show a stable recovery message;
- accepted: set workspace/project cookies and redirect to the invited project dashboard.

### OAuth profile synchronization

Normalize GitHub OAuth metadata server-side after session exchange:

- use GitHub `name`/`full_name` as a display-name fallback;
- use `avatar_url` when the profile has no custom avatar;
- never overwrite a user-edited display name or avatar;
- never derive a TraceBox project role from GitHub organization or repository membership.

---

## Frontend components

Create or extract:

```text
src/components/access/role-badge.tsx
src/components/access/access-summary.tsx
src/components/access/permission-gate.tsx
src/components/settings/collaboration-manager.tsx
src/components/settings/invite-member-dialog.tsx
src/components/settings/member-role-editor.tsx
src/components/settings/pending-invitations.tsx
src/components/settings/github-connection-overview.tsx
src/components/settings/github-repository-table.tsx
src/components/settings/github-automation-editor.tsx
src/components/settings/github-health-panel.tsx
```

Conventions:

- server pages fetch authoritative initial state;
- interactive leaves use local state and reload from typed routes after mutations;
- never optimistically display a role change before the RPC succeeds;
- disabled actions include a visible explanation;
- state labels use friendly text plus machine-readable status details where useful;
- use `Surface` and the existing compact TraceBox design language;
- all labels remain visible in narrow layouts;
- dialogs name the affected workspace, project, member, and resulting role.

### Role badges

Use consistent colors and labels:

```text
Owner       violet
Admin       amber
Maintainer  emerald
Developer   blue
Reporter    zinc
Viewer      neutral
```

The badge tooltip/popover explains whether the role is direct or inherited from workspace administration.

### Permission-aware rendering

Do not completely hide core integration state from Developers. Render the same dashboard with:

- health and repository data visible;
- management fields read-only;
- a “Maintainer required” badge and concise explanation;
- PR search/linking available from issue pages.

Reporter/Viewer users continue to see linked PR cards on issues they can view, but not the integration administration route.

---

## GitHub dashboard state behavior

| Backend state | Dashboard presentation | Maintainer action |
|---|---|---|
| No installation | Not connected | Install GitHub App |
| `PENDING` | Waiting for organization approval | Open/request approval |
| `ACTIVE` | Connected | Refresh or configure repositories |
| `SUSPENDED` | Suspended by GitHub | Open GitHub settings |
| `REVOKED` | Access revoked | Reinstall GitHub App |
| `NEEDS_PERMISSION_UPDATE` | Permission update required | Review and approve permissions |
| Repository inaccessible | Access removed | Update selected repositories |
| Repository archived | Archived | Choose another primary repository |
| Recent webhook failures | Automation degraded | Retry eligible deliveries / inspect summary |
| GitHub rate limited | Temporarily delayed | Show reset time; do not mark revoked |

Old revoked installations remain visible in a collapsed history section. The primary dashboard state comes from the newest relevant installation, not simply the presence of any installation row.

Repository automation settings must be edited per binding. Selecting a repository loads that repository’s saved branch patterns and auto-resolution value; pressing **Save automation** persists changes through a dedicated update route. Connecting another repository must not change the primary repository or overwrite another binding’s settings.

---

## Testing strategy

### Unit tests

Add Vitest coverage for:

- role hierarchy and capability mapping;
- access-source labels;
- invitation payload validation;
- normalized email behavior;
- safe invitation redirect handling;
- GitHub health-state derivation;
- expected-versus-granted permission comparison;
- GitHub error-code-to-UI-state mapping;
- target-branch editor parsing.

### Database integration tests

Add local Supabase tests for:

- Owner/Admin effective Maintainer access;
- project Maintainer invitation boundaries;
- Developer self-promotion denial;
- cross-organization project assignment denial;
- email mismatch, expiry, revocation, and invitation replay denial;
- idempotent invitation acceptance;
- last-Maintainer and Owner removal protection;
- membership event creation;
- GitHub management RPC denial for Developers;
- Developer PR-link RPC allowance;
- project-scoped webhook retry isolation.

### Browser QA

Extend the ignored `qa/live/` suite with disposable accounts:

1. Owner invites a Developer.
2. Developer signs up through the invitation link.
3. Invitation acceptance opens the correct workspace/project.
4. Header and Settings display `Developer`.
5. Developer sees GitHub health but cannot mutate installation/bindings.
6. Developer searches and links an existing PR.
7. Maintainer changes the user to Reporter; GitHub settings access disappears after refresh.
8. Maintainer restores Developer access.
9. Maintainer installs/reconnects the App and binds a repository.
10. Maintainer edits and saves target branches and auto-resolution.
11. A PR containing `Fixes KEY-1` auto-links.
12. Merge into an unconfigured branch does not resolve.
13. Merge into a configured branch resolves.
14. Revoking the installation shows a recovery state without deleting history.
15. Reinstalling creates/activates access and repository sync recovers.

Tests must assert both visibility and server rejection. A hidden button alone is not an authorization test.

### Manual acceptance checklist

- No SQL Editor step is required to create a collaborator.
- A GitHub-authenticated user and an email/password user can accept invitations.
- Login provider never changes project role.
- Every page shows the same effective role for the active project.
- Switching projects updates the badge and available controls.
- Developers understand why management controls are disabled.
- Maintainers can save automation settings for an existing binding.
- Revoked/suspended/pending/permission-update states have clear recovery actions.
- Webhook health can be understood without opening Vercel or Supabase.
- The UI never claims TraceBox can create PRs.

---

## Implementation sequence

### Phase 1 — Access contract

1. Add shared role/capability types and `project-access` server helper.
2. Extend workspace context with workspace and effective project roles.
3. Add reusable role badge and access summary.
4. Replace page-local role comparisons where practical.
5. Add unit tests for capability mapping.

### Phase 2 — Collaboration schema and RPCs

1. Add migration 044 tables, indexes, constraints, RLS, and grants.
2. Implement invitation lifecycle RPCs.
3. Implement workspace/project role mutation RPCs.
4. Implement removal protections and membership audit events.
5. Regenerate `full_schema.sql` and database types.
6. Add local database authorization tests.

### Phase 3 — Invitation-aware authentication

1. Add invitation validation/acceptance routes.
2. Preserve invitation `next` through password and GitHub OAuth flows.
3. Add invitation acceptance page and account-mismatch recovery.
4. Redirect accepted users into the correct workspace/project.
5. Improve GitHub-login-versus-App copy.
6. Add safe OAuth profile synchronization.

### Phase 4 — Members & access dashboard

1. Add settings navigation destination and server page.
2. Build member roster and effective-role display.
3. Build invite dialog and pending-invitation list.
4. Build role edit and access removal flows.
5. Add permission explanations and confirmation dialogs.
6. Verify responsive and keyboard behavior.

### Phase 5 — Role-aware application shell

1. Put workspace/project role badges in the header/user menu.
2. Update badges when workspace/project cookies change.
3. Ensure navigation derives from capabilities.
4. Show explicit read-only states instead of silently missing controls.

### Phase 6 — GitHub administration dashboard

1. Split the current integration manager into overview, repositories, automation, and health components.
2. Add sanitized GitHub health endpoint/read model.
3. Add existing-binding automation update route.
4. Add project-scoped eligible webhook retry route.
5. Add status-specific installation recovery actions.
6. Add permission and synchronization summaries.
7. Keep revoked installation history collapsed and distinguish the active installation.

### Phase 7 — Developer PR experience alignment

1. Keep PR search/linking available to Developers.
2. Label manual versus automatic relationships.
3. Show why an automatic resolution did or did not run.
4. Link from issue PR cards to project automation settings for Maintainers.
5. Remove any documentation or UI suggestion that TraceBox creates PRs.

### Phase 8 — Verification and documentation

1. Run lint, typecheck, unit tests, migration checks, and production build.
2. Reset a local Supabase project and run access/RLS tests.
3. Extend and run the local-only multi-user Playwright suite.
4. Test hosted email/password and GitHub OAuth invitation acceptance.
5. Test all GitHub installation lifecycle states practical in the test account.
6. Update README, deployment guide, incomplete audits, handoff, and AGENTS.

---

## Delivery boundaries

The first shippable cut is complete only when:

- a Maintainer can invite a Developer without SQL;
- the Developer can accept the invitation using either supported login provider;
- both users see accurate role badges for the selected project;
- backend and frontend agree on every GitHub capability;
- Developers can link existing PRs but cannot mutate GitHub configuration;
- Maintainers can install, synchronize, bind, configure, diagnose, and recover GitHub integration state from the dashboard;
- automatic resolution settings are visible and independently saveable;
- authorization and lifecycle paths are covered by database and browser tests.

Anything requiring GitHub write permissions—creating PRs, pushing commits, commenting on PRs, or modifying labels—must remain a separate future proposal.

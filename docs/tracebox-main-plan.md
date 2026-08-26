# TraceBox — Main Implementation Plan

## Status

The deployment foundation is complete.

Current deployment:

```text
https://trace-box.vercel.app/
```


Implementation status: Phases 1–5 are complete in the repository. Phase 6 — Assignment + Workflow — is next.
This plan assumes the following are already working:

- Next.js + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase project
- Supabase Auth
- Supabase PostgreSQL
- Supabase client/server utilities
- basic RLS foundation
- user profiles
- authenticated dashboard
- Vercel deployment
- environment variables
- version-controlled Supabase migrations

From this point onward, development should continuously ship the actual TraceBox product in small vertical slices.

---

# 1. Product Goal

TraceBox is a modern developer-focused bug and issue tracking platform inspired by the core problem solved by Bugzilla.

The goal is not to recreate Bugzilla's interface. Preserve its useful ideas:

- structured bug tracking
- projects and components
- versions and milestones
- priority and severity
- configurable workflows
- issue assignment
- comments and collaboration
- dependencies
- duplicate tracking
- detailed history
- strong permissions
- powerful search
- saved queries
- reporting
- release-oriented tracking

Reconstruct them around:

- modern UI
- fast issue creation
- fast triage
- keyboard-friendly workflows
- realtime collaboration
- clean developer navigation
- strong security
- release intelligence
- actionable analytics

---

# 2. Product Principles

## Developer-first

Prefer:

```text
dense tables
keyboard shortcuts
quick actions
command palette
compact forms
clear hierarchy
fast navigation
```

Avoid:

```text
giant decorative cards
marketing-style gradients
verbose helper text
slow multi-step forms
fake dashboard statistics
excessive whitespace
```

## Database-backed rules

Important rules must not exist only in React.

Enforce important authorization and workflow behavior through PostgreSQL RLS, database functions, constraints, or trusted server-side logic.

## Continuous shipping

Preferred loop:

```text
migration
↓
domain/backend logic
↓
UI
↓
tests
↓
merge
↓
deploy
```

Every phase must leave production usable.

## Vertical slices

A feature is not done when only its UI exists.

Each feature should include:

```text
database
RLS
validation
backend mutation/query
UI
loading/error states
tests
deployment
```

## Do not over-engineer

Do not add Redis, Elasticsearch, Kafka, microservices, GraphQL, Kubernetes, or a separate auth server unless a real requirement appears later.

---

# 3. Target Stack

```text
Next.js App Router
TypeScript
Tailwind CSS
shadcn/ui
Supabase PostgreSQL
Supabase Auth
Supabase Storage
Supabase Realtime
Supabase Edge Functions
Supabase Cron
Zod
React Hook Form
TanStack Table
Recharts
Lucide Icons
```

Optional later:

```text
TanStack Query
cmdk
dnd-kit
```

---

# 4. High-Level Architecture

```text
Browser
│
├── Server Components
│   └── authenticated data reads
│
├── Client Components
│   └── interactive UI
│
├── Server Actions
│   └── product mutations
│
├── Route Handlers
│   ├── public API
│   └── webhooks
│
└── Supabase
    ├── PostgreSQL
    │   ├── data
    │   ├── RLS
    │   ├── functions
    │   ├── triggers
    │   └── search
    ├── Auth
    ├── Storage
    ├── Realtime
    ├── Cron
    └── Edge Functions
```

The database remains the source of truth.

---

# 5. Product Hierarchy

```text
Organization / Workspace
    │
    ├── Project
    │     ├── Components
    │     ├── Versions
    │     ├── Milestones
    │     ├── Labels
    │     ├── Workflow
    │     └── Issues
    │
    └── Members
```

Each issue belongs to exactly one project.

---

# 6. Target Database Schema

Do not create every table immediately. Create tables as their feature phases are implemented.

## 6.1 profiles

Existing table.

Target fields:

```text
id UUID PRIMARY KEY REFERENCES auth.users(id)
display_name TEXT
avatar_url TEXT
username TEXT UNIQUE
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## 6.2 organizations

```text
id UUID PRIMARY KEY
name TEXT NOT NULL
slug TEXT UNIQUE NOT NULL
owner_id UUID NOT NULL REFERENCES profiles(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## 6.3 organization_members

```text
organization_id UUID
user_id UUID
role TEXT
joined_at TIMESTAMPTZ

PRIMARY KEY (organization_id, user_id)
```

Roles:

```text
OWNER
ADMIN
MEMBER
VIEWER
```

---

## 6.4 projects

```text
id UUID PRIMARY KEY
organization_id UUID NOT NULL
name TEXT NOT NULL
key TEXT NOT NULL
slug TEXT NOT NULL
description TEXT
next_issue_number BIGINT DEFAULT 1
is_archived BOOLEAN DEFAULT FALSE
created_by UUID NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Constraints:

```text
UNIQUE (organization_id, slug)
UNIQUE (organization_id, key)
```

Example:

```text
name = Authentication Service
key = AUTH
```

Issue IDs then become:

```text
AUTH-1
AUTH-2
AUTH-3
```

---

## 6.5 project_members

```text
project_id UUID
user_id UUID
role TEXT
created_at TIMESTAMPTZ

PRIMARY KEY (project_id, user_id)
```

Roles:

```text
MAINTAINER
DEVELOPER
REPORTER
VIEWER
```

---

## 6.6 components

```text
id UUID PRIMARY KEY
project_id UUID NOT NULL
name TEXT NOT NULL
description TEXT
default_assignee_id UUID
is_archived BOOLEAN DEFAULT FALSE
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Constraint:

```text
UNIQUE(project_id, name)
```

---

## 6.7 versions

```text
id UUID PRIMARY KEY
project_id UUID NOT NULL
name TEXT NOT NULL
released_at TIMESTAMPTZ
is_released BOOLEAN DEFAULT FALSE
is_archived BOOLEAN DEFAULT FALSE
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## 6.8 milestones

```text
id UUID PRIMARY KEY
project_id UUID NOT NULL
name TEXT NOT NULL
description TEXT
due_at TIMESTAMPTZ
status TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Status:

```text
PLANNED
ACTIVE
COMPLETED
CANCELLED
```

---

## 6.9 labels

```text
id UUID PRIMARY KEY
project_id UUID NOT NULL
name TEXT NOT NULL
description TEXT
color TEXT
created_at TIMESTAMPTZ
```

Constraint:

```text
UNIQUE(project_id, name)
```

---

## 6.10 workflow_states

```text
id UUID PRIMARY KEY
project_id UUID NOT NULL
name TEXT NOT NULL
category TEXT NOT NULL
position INTEGER NOT NULL
color TEXT
is_initial BOOLEAN DEFAULT FALSE
is_terminal BOOLEAN DEFAULT FALSE
created_at TIMESTAMPTZ
```

Categories:

```text
TRIAGE
OPEN
IN_PROGRESS
REVIEW
RESOLVED
CLOSED
```

The visible name can differ from the category.

---

## 6.11 workflow_transitions

```text
id UUID PRIMARY KEY
project_id UUID NOT NULL
from_state_id UUID NOT NULL
to_state_id UUID NOT NULL
required_role TEXT
created_at TIMESTAMPTZ
```

---

## 6.12 issues

```text
id UUID PRIMARY KEY
project_id UUID NOT NULL
issue_number BIGINT NOT NULL

title TEXT NOT NULL
description TEXT

type TEXT NOT NULL
status_id UUID NOT NULL
resolution TEXT

priority TEXT
severity TEXT

reporter_id UUID NOT NULL
assignee_id UUID

component_id UUID
affected_version_id UUID
target_milestone_id UUID

environment TEXT
steps_to_reproduce TEXT
expected_behavior TEXT
actual_behavior TEXT

visibility TEXT DEFAULT 'PROJECT'

created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
resolved_at TIMESTAMPTZ
closed_at TIMESTAMPTZ
```

Constraint:

```text
UNIQUE(project_id, issue_number)
```

Issue types:

```text
BUG
ENHANCEMENT
TASK
SECURITY
PERFORMANCE
REGRESSION
```

Priority:

```text
P0
P1
P2
P3
P4
```

Severity:

```text
BLOCKER
CRITICAL
MAJOR
MINOR
TRIVIAL
```

Resolution:

```text
FIXED
DUPLICATE
WONT_FIX
INVALID
CANNOT_REPRODUCE
WORKS_AS_EXPECTED
```

Visibility:

```text
PROJECT
RESTRICTED
```

---

## 6.13 issue_labels

```text
issue_id UUID
label_id UUID

PRIMARY KEY(issue_id, label_id)
```

---

## 6.14 comments

```text
id UUID PRIMARY KEY
issue_id UUID NOT NULL
author_id UUID NOT NULL
body TEXT NOT NULL
edited_at TIMESTAMPTZ
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Prefer soft deletion later if comment deletion becomes necessary.

---

## 6.15 attachments

```text
id UUID PRIMARY KEY
issue_id UUID NOT NULL
uploader_id UUID NOT NULL
filename TEXT NOT NULL
storage_path TEXT NOT NULL
mime_type TEXT
size_bytes BIGINT
created_at TIMESTAMPTZ
```

Files live in Supabase Storage.

---

## 6.16 issue_watchers

```text
issue_id UUID
user_id UUID
created_at TIMESTAMPTZ

PRIMARY KEY(issue_id, user_id)
```

---

## 6.17 issue_links

```text
id UUID PRIMARY KEY
source_issue_id UUID NOT NULL
target_issue_id UUID NOT NULL
relationship TEXT NOT NULL
created_by UUID NOT NULL
created_at TIMESTAMPTZ
```

Relationships:

```text
BLOCKS
DEPENDS_ON
DUPLICATE_OF
RELATES_TO
CAUSED_BY
REGRESSION_OF
```

Prevent self-links.

---

## 6.18 issue_events

Immutable audit log.

```text
id UUID PRIMARY KEY
issue_id UUID NOT NULL
actor_id UUID
event_type TEXT NOT NULL
field_name TEXT
old_value JSONB
new_value JSONB
metadata JSONB
created_at TIMESTAMPTZ
```

Examples:

```text
ISSUE_CREATED
STATUS_CHANGED
ASSIGNEE_CHANGED
PRIORITY_CHANGED
SEVERITY_CHANGED
COMMENT_ADDED
LABEL_ADDED
LABEL_REMOVED
LINK_ADDED
ATTACHMENT_ADDED
RESOLVED
REOPENED
```

Clients should not write arbitrary audit rows directly.

---

## 6.19 issue_access

Used for restricted issues.

```text
issue_id UUID
user_id UUID
granted_by UUID
created_at TIMESTAMPTZ

PRIMARY KEY(issue_id, user_id)
```

---

## 6.20 saved_views

```text
id UUID PRIMARY KEY
owner_id UUID NOT NULL
project_id UUID
name TEXT NOT NULL
filters JSONB NOT NULL
visibility TEXT DEFAULT 'PRIVATE'
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Visibility:

```text
PRIVATE
PROJECT
ORGANIZATION
```

---

## 6.21 notifications

```text
id UUID PRIMARY KEY
user_id UUID NOT NULL
actor_id UUID
issue_id UUID
type TEXT NOT NULL
data JSONB
read_at TIMESTAMPTZ
created_at TIMESTAMPTZ
```

Types:

```text
MENTION
ASSIGNED
COMMENT
STATUS_CHANGED
ISSUE_LINKED
MILESTONE_CHANGED
WATCHED_ISSUE_UPDATED
```

---

## 6.22 notification_preferences

```text
user_id UUID PRIMARY KEY
mentions BOOLEAN DEFAULT TRUE
assignments BOOLEAN DEFAULT TRUE
comments BOOLEAN DEFAULT TRUE
status_changes BOOLEAN DEFAULT TRUE
watch_updates BOOLEAN DEFAULT TRUE
email_mentions BOOLEAN DEFAULT FALSE
email_assignments BOOLEAN DEFAULT FALSE
email_digest BOOLEAN DEFAULT FALSE
updated_at TIMESTAMPTZ
```

---

## 6.23 issue_templates

```text
id UUID PRIMARY KEY
project_id UUID NOT NULL
name TEXT NOT NULL
description TEXT
issue_type TEXT
body_template TEXT
default_priority TEXT
default_severity TEXT
default_component_id UUID
created_by UUID
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## 6.24 custom_fields

Later feature.

```text
id UUID PRIMARY KEY
project_id UUID NOT NULL
name TEXT NOT NULL
field_type TEXT NOT NULL
config JSONB
is_required BOOLEAN DEFAULT FALSE
created_at TIMESTAMPTZ
```

Types:

```text
TEXT
NUMBER
BOOLEAN
DATE
SINGLE_SELECT
MULTI_SELECT
USER
```

---

## 6.25 issue_custom_values

```text
issue_id UUID
custom_field_id UUID
value JSONB

PRIMARY KEY(issue_id, custom_field_id)
```

---

## 6.26 integrations

Later feature.

```text
id UUID PRIMARY KEY
project_id UUID NOT NULL
type TEXT NOT NULL
config JSONB
secret_reference TEXT
is_enabled BOOLEAN DEFAULT TRUE
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Do not store plaintext secrets in frontend-readable configuration.

---

# 7. Authorization Model

Organization roles:

```text
OWNER
ADMIN
MEMBER
VIEWER
```

Project roles:

```text
MAINTAINER
DEVELOPER
REPORTER
VIEWER
```

Suggested permission matrix:

| Action | Viewer | Reporter | Developer | Maintainer |
|---|---:|---:|---:|---:|
| View project | ✓ | ✓ | ✓ | ✓ |
| View normal issues | ✓ | ✓ | ✓ | ✓ |
| Create issue |  | ✓ | ✓ | ✓ |
| Comment |  | ✓ | ✓ | ✓ |
| Edit own issue |  | ✓ | ✓ | ✓ |
| Edit general issue fields |  |  | ✓ | ✓ |
| Assign issue |  |  | ✓ | ✓ |
| Change priority/severity |  |  | ✓ | ✓ |
| Transition issue |  |  | ✓ | ✓ |
| Manage components |  |  |  | ✓ |
| Manage versions |  |  |  | ✓ |
| Manage milestones |  |  |  | ✓ |
| Manage workflow |  |  |  | ✓ |
| Manage project members |  |  |  | ✓ |
| Archive project |  |  |  | ✓ |

Organization owners/admins additionally manage workspace settings and membership.

---

# 8. RLS Strategy

RLS must remain enabled for every exposed table.

Recommended helper functions:

```text
is_org_member(org_id)
is_org_admin(org_id)
is_project_member(project_id)
project_role(project_id)
can_manage_project(project_id)
can_view_issue(issue_id)
can_edit_issue(issue_id)
can_comment_on_issue(issue_id)
can_transition_issue(issue_id)
```

Restricted issue rule:

```text
visibility = PROJECT
→ normal project access

visibility = RESTRICTED
→ reporter
   OR project maintainer
   OR explicit issue_access grant
```

Restricted issues must also be hidden from unauthorized:

```text
search results
counts
analytics
notifications
realtime events
attachments
saved views
```

---

# 9. Human-Readable Issue IDs

Use:

```text
PROJECTKEY-ISSUENUMBER
```

Examples:

```text
TRACE-1
AUTH-42
WEB-184
```

Issue creation must atomically:

```text
lock/increment project counter
create issue
create audit event
return issue
```

Never calculate issue numbers in the browser.

---

# 10. Default Workflow

New projects automatically receive:

```text
Triage
Open
In Progress
In Review
Resolved
Closed
Reopened
```

Suggested transitions:

```text
Triage → Open
Triage → In Progress

Open → In Progress
Open → Resolved

In Progress → In Review
In Progress → Resolved

In Review → In Progress
In Review → Resolved

Resolved → Closed
Resolved → Reopened

Closed → Reopened

Reopened → In Progress
Reopened → Resolved
```

Require resolution when entering a resolved state.

Clear resolution when reopening.

---

# 11. Core Backend Mutations

Create trusted server/database operations for:

```text
create_organization()
create_project()
invite_member()

create_issue()
update_issue()
assign_issue()
transition_issue()
resolve_issue()
reopen_issue()

add_comment()
edit_comment()

add_label()
remove_label()

watch_issue()
unwatch_issue()

add_issue_link()
remove_issue_link()
mark_duplicate()

create_attachment_metadata()
```

Each important mutation should:

```text
authenticate
validate
authorize
perform transaction
write audit event
generate notifications
return result
```

Use Zod at the application boundary.

---

# 12. Main Routes

Target route structure:

```text
/
├── login
├── signup
├── onboarding
│
└── [workspace]
    ├── overview
    ├── inbox
    ├── projects
    │   └── [project]
    │       ├── overview
    │       ├── issues
    │       ├── issues/new
    │       ├── issues/[issueKey]
    │       ├── triage
    │       ├── board
    │       ├── components
    │       ├── versions
    │       ├── milestones
    │       ├── milestones/[id]
    │       ├── reports
    │       └── settings
    │           ├── general
    │           ├── members
    │           ├── components
    │           ├── versions
    │           ├── workflow
    │           ├── labels
    │           └── integrations
    │
    ├── search
    ├── notifications
    └── settings
```

Do not create empty placeholder pages for unimplemented features.

---

# 13. Navigation

Workspace navigation:

```text
Overview
Projects
My Issues
Notifications
Search
```

Project navigation:

```text
Overview
Issues
Triage
Milestones
Reports
Settings
```

Only expose items when the related feature exists.

---

# 14. Organization and Project Onboarding

If a new user belongs to no organization:

```text
Create workspace
↓
Create first project
↓
Enter project
```

Workspace fields:

```text
Workspace name
Workspace slug
```

Project fields:

```text
Project name
Project key
Description
```

On project creation:

```text
create project
create maintainer membership
create default workflow states
create default workflow transitions
```

Prefer transactional creation.

---

# 15. Issue Creation UX

Required fields:

```text
Title
Description
Type
Component
```

Defaults:

```text
Status = Triage
Priority = P2
Severity = Major
Reporter = current user
```

Advanced fields:

```text
Priority
Severity
Assignee
Affected Version
Target Milestone
Labels
Environment
Steps to Reproduce
Expected Behaviour
Actual Behaviour
Visibility
```

Use progressive disclosure instead of showing every field immediately.

After submission, navigate directly to the new issue.

---

# 16. Issue List

Use a dense table.

Columns:

```text
ID
Title
Status
Priority
Severity
Component
Assignee
Milestone
Updated
```

Features:

```text
sorting
filtering
pagination
column visibility
saved views
bulk select
bulk updates later
```

Use TanStack Table.

Do not replace the main issue list with cards.

---

# 17. Issue Detail Page

Recommended structure:

```text
TRACE-184 · Authentication crashes after session expiry
Bug · Critical · P1

─────────────────────────────────────────────

DESCRIPTION

...

─────────────────────────────────────────────

ACTIVITY

...

[ Write a comment... ]

                         ┌────────────────────┐
                         │ Status             │
                         │ In Progress        │
                         │                    │
                         │ Assignee           │
                         │ Neeraj             │
                         │                    │
                         │ Component          │
                         │ Authentication     │
                         │                    │
                         │ Milestone          │
                         │ v1.1               │
                         │                    │
                         │ Labels             │
                         │ regression         │
                         └────────────────────┘
```

Main column:

```text
Description
Steps to Reproduce
Expected Behaviour
Actual Behaviour
Attachments
Dependencies
Activity
Comments
```

Sidebar:

```text
Status
Resolution
Priority
Severity
Assignee
Reporter
Component
Affected Version
Target Milestone
Labels
Visibility
Created
Updated
```

Allow inline field editing where sensible.

---

# 18. Comments

Support:

```text
Markdown
code blocks
mentions
issue references
basic formatting
```

Examples:

```text
@neeraj can you reproduce this on Windows?
```

```text
Looks related to TRACE-141.
```

Issue references should become links.

Mentioned users receive notifications.

---

# 19. Activity Timeline

Merge meaningful changes and comments into a clean timeline.

Example:

```text
09:14  Neeraj created TRACE-184

09:17  Priority
       P2 → P1

09:18  Assignee
       Unassigned → Adithya

10:04  Status
       Open → In Progress

10:47  Added dependency
       TRACE-176

11:32  Neeraj commented
       "I can reproduce this on Firefox..."

12:01  Status
       In Progress → Resolved

12:01  Resolution
       Fixed
```

Never expose raw audit JSON directly.

---

# 20. Components

Maintainers can manage:

```text
name
description
default assignee
archived state
```

When a component is chosen during issue creation, optionally preselect its default assignee.

Component page can later show:

```text
open issues
unresolved critical issues
recent issues
default assignee
```

---

# 21. Versions

Maintainers can:

```text
create
rename
mark released
archive
```

Issues use:

```text
Affected Version
```

---

# 22. Milestones

Milestones represent target releases/checkpoints.

Fields:

```text
name
description
due date
status
```

Milestone detail should show:

```text
total issues
resolved issues
open issues
blockers
critical issues
completion percentage
```

Metric clicks should lead to filtered issue lists.

---

# 23. Labels

Project-scoped labels.

Examples:

```text
regression
frontend
backend
needs-info
good-first-issue
security
performance
```

Allow:

```text
create
rename
change color
archive/delete
```

Make adding/removing labels fast from issue detail.

---

# 24. Watchers

Users can:

```text
Watch issue
Unwatch issue
```

Automatic watching:

```text
reporter
assignee
```

Optionally:

```text
mentioned users
```

Watching affects notifications, not authorization.

---

# 25. Issue Relationships

Supported relations:

```text
Blocks
Depends on
Duplicate of
Related to
Caused by
Regression of
```

Display relationships naturally from both sides.

Prevent duplicates and invalid self-links.

---

# 26. Duplicate Handling

When marking an issue duplicate:

```text
select canonical issue
↓
create DUPLICATE_OF link
↓
set status to resolved
↓
resolution = DUPLICATE
↓
create audit event
↓
notify watchers
```

Provide direct navigation to the canonical issue.

---

# 27. Duplicate Suggestions

While creating an issue, show potential duplicates.

Initial implementation:

```text
PostgreSQL Full Text Search
+
pg_trgm title similarity
```

Possible score:

```text
title similarity
+
description rank
+
same component bonus
+
same affected version bonus
+
open issue bonus
```

Example:

```text
Possible duplicates

TRACE-193   Login loop after session expiry      91%
TRACE-151   OAuth callback repeats               76%
TRACE-129   Session refresh redirect loop         64%
```

Suggestions should never block submission.

---

# 28. Search

## Quick Search

Examples:

```text
TRACE-184
login crash
oauth redirect
```

Exact issue keys should navigate quickly.

## Advanced Search

Filters:

```text
Status
Resolution
Priority
Severity
Type
Assignee
Reporter
Component
Version
Milestone
Label
Created date
Updated date
Text
```

Represent active filters as compact chips.

---

# 29. Saved Views

Allow saving the current issue filter set.

Examples:

```text
My Critical Issues
Open Authentication Bugs
v1.2 Release Blockers
Unassigned Regressions
```

Visibility:

```text
Private
Project
Organization
```

Each saved view should have a stable URL.

---

# 30. Triage Inbox

One of the core differentiators.

Triage queue includes issues with:

```text
status = TRIAGE
```

and optionally issues missing important classification.

Suggested keyboard actions:

```text
A → Assign
P → Priority
S → Severity
C → Component
D → Duplicate
E → Edit
Enter → Open
```

Allow rapid inline changes without opening every issue.

---

# 31. Command Palette

Add after core routes are stable.

Shortcut:

```text
Ctrl + K
```

Actions:

```text
Create issue
Open issue
Search issues
Go to project
View my issues
Open notifications
Assign issue to me
Move issue to In Progress
```

Reuse existing backend actions.

---

# 32. Notifications

Provide an in-app inbox.

Examples:

```text
Adithya mentioned you in TRACE-184
TRACE-192 was assigned to you
TRACE-155 moved to Review
TRACE-144 was marked as duplicate
```

Support:

```text
mark read
mark all read
link to issue
```

Avoid notifying the actor about their own action.

---

# 33. Realtime

Use Supabase Realtime selectively for:

```text
new comments
status changes
assignment changes
notifications
```

Recommended behavior:

```text
database event
↓
invalidate/refetch relevant state
```

The database remains authoritative.

---

# 34. Attachments

Use Supabase Storage.

Recommended path:

```text
issues/
    <project_uuid>/
        <issue_uuid>/
            <unique_file_name>
```

Enforce:

```text
file size limits
allowed MIME types
authorization
private storage rules
```

Restricted issue attachments must never be public.

---

# 35. Issue Templates

Example templates:

## Bug Report

```text
Description

Steps to reproduce
1.
2.
3.

Expected behaviour

Actual behaviour

Environment

Logs
```

## Security Vulnerability

```text
Affected component
Attack vector
Impact
Proof of concept
Affected versions
Suggested mitigation
```

## Performance Issue

```text
Baseline
Observed behaviour
Hardware
Profiling results
Regression version
```

Templates can define:

```text
body
issue type
default component
default labels
default priority
default severity
```

---

# 36. Project Overview

Show useful operational data:

```text
Open Issues
Critical Issues
Issues Assigned to Me
Awaiting Triage
Due Milestones
Recently Updated Issues
```

Keep analytics minimal here.

---

# 37. Analytics

Add after core issue tracking is stable.

Metrics:

```text
Open issues
Created issues
Resolved issues
Resolution rate
Median resolution time
Issue age
Stale issues
Critical unresolved
Issues by component
Issues by priority
Issues by assignee
Issues by milestone
```

Charts:

```text
Created vs Resolved
Backlog over time
Issues by status
Issues by component
Resolution duration
```

---

# 38. Release Readiness

Create a milestone/release readiness page.

Example:

```text
Release: v1.2

Readiness: 76%

2 Blockers
5 Critical issues
3 unresolved regressions
41 / 52 issues resolved
0 untriaged security reports
```

Top risks:

```text
TRACE-177 — Database corruption
TRACE-193 — OAuth regression
TRACE-201 — Memory leak
```

Use explainable rules rather than an arbitrary AI score.

Possible factors:

```text
resolved percentage
blocker count
critical count
regression count
unresolved security count
overdue milestone status
```

Show users why the score has its value.

---

# 39. Stale Issue Detection

Initial default:

```text
issue unresolved
AND
updated_at older than 30 days
```

Surface stale issues in:

```text
overview
reports
saved views
```

Do not automatically close stale issues.

---

# 40. GitHub Integration

Implement only after the tracker is mature.

Per project:

```text
connected GitHub repository
```

Features:

```text
link PR to issue
link commit to issue
show PR status
show merged status
show CI status where practical
```

Recognize TraceBox keys:

```text
TRACE-184
```

Optional automation:

```text
PR merged
+
contains "Fixes TRACE-184"
↓
resolve issue
```

Make automatic resolution configurable.

Validate webhook signatures.

---

# 41. Public API

Later expose an application API.

Suggested routes:

```text
GET    /api/v1/issues
POST   /api/v1/issues
GET    /api/v1/issues/:issueKey
PATCH  /api/v1/issues/:issueKey
POST   /api/v1/issues/:issueKey/comments

GET    /api/v1/projects
GET    /api/v1/milestones
GET    /api/v1/search
```

Token scopes:

```text
issues:read
issues:write
comments:write
projects:read
```

Store hashed tokens only.

---

# 42. Frontend Structure

Target as the app expands:

```text
src/
├── app/
│   ├── (auth)/
│   ├── (app)/
│   └── api/
│
├── components/
│   ├── ui/
│   ├── layout/
│   ├── issues/
│   ├── comments/
│   ├── projects/
│   ├── milestones/
│   ├── search/
│   └── reports/
│
├── features/
│   ├── organizations/
│   ├── projects/
│   ├── issues/
│   ├── workflows/
│   ├── notifications/
│   ├── search/
│   └── integrations/
│
├── lib/
│   ├── supabase/
│   ├── auth/
│   ├── permissions/
│   ├── validation/
│   └── utils/
│
└── types/
```

Keep domain logic outside giant React components.

---

# 43. UI Rules

Use:

```text
Tailwind CSS
shadcn/ui
Lucide icons
```

Design direction:

```text
clean
dense
professional
developer-focused
fast
neutral
```

Avoid:

```text
giant rounded marketing cards
large gradients
unnecessary animations
excessive helper copy
oversized typography
```

Prefer:

```text
tables
panels
drawers
command menus
compact toolbars
filter chips
inline editing
keyboard shortcuts
```

---

# 44. Markdown Security

Descriptions and comments may contain Markdown.

Support:

```text
headings
lists
links
code blocks
inline code
quotes
tables
```

Do not allow arbitrary raw HTML by default.

Sanitize rendered content.

---

# 45. Error Handling

Standard error categories:

```text
VALIDATION_ERROR
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
CONFLICT
INTERNAL_ERROR
```

Never expose:

```text
SQL
stack traces
database internals
secrets
```

to production users.

---

# 46. Optimistic UI

Good candidates:

```text
watch/unwatch
label changes
simple status changes
mark notification read
```

Be conservative for:

```text
issue creation
complex transitions
duplicate resolution
permission changes
```

---

# 47. Testing Strategy

## Unit tests

Use Vitest for:

```text
validators
formatters
query parsing
permission helpers
readiness calculations
search scoring helpers
```

## Database tests

Use pgTAP for:

```text
RLS
restricted issue access
membership rules
workflow rules
issue number allocation
```

Always test denied cases.

## End-to-end tests

Use Playwright for:

```text
signup/login
create workspace
create project
create issue
view issue
comment
assign
transition
search
restricted issue access
```

---

# 48. Security Requirements

Verify regularly:

```text
RLS enabled
service-role never exposed
restricted issues properly hidden
Storage policies mirror issue access
Markdown sanitized
webhook signatures validated
API tokens hashed
server actions authorize
role escalation blocked
audit events protected
```

---

# 49. Performance

Likely indexes:

```text
issues(project_id)
issues(project_id, issue_number)
issues(status_id)
issues(assignee_id)
issues(component_id)
issues(target_milestone_id)
issues(updated_at)

comments(issue_id, created_at)
issue_events(issue_id, created_at)
notifications(user_id, read_at, created_at)
```

Search indexes:

```text
GIN full-text index
pg_trgm index on issue title
```

Paginate large lists.

Never load the entire issue table into the browser.

---

# 50. Observability

Start with:

```text
Vercel logs
Supabase logs
structured server errors
```

Add Sentry later only if useful.

---

# 51. Migration Discipline

Every production schema change requires a migration.

Example names:

```text
202608270001_create_organizations.sql
202608270002_create_projects.sql
202608280001_create_issues.sql
```

Never rewrite migrations already deployed to production.

---

# 52. Seed Data

Once issue tracking exists, create local development seed data:

```text
Demo workspace
Demo project
3 components
2 versions
2 milestones
default workflow
10-20 issues
comments
labels
```

Never automatically seed production.

---

# 53. CI/CD

Main:

```text
lint
typecheck
tests
build
↓
Vercel production
```

Pull requests:

```text
lint
typecheck
tests
build
↓
Vercel preview
```

Keep database migration deployment controlled.

---

# 54. Implementation Roadmap

## Phase 1 — Organizations and Projects

Build:

```text
organizations
organization_members
projects
project_members
workspace onboarding
project creation
workspace/project switchers
RLS
```

Done when:

```text
user can create workspace
creator becomes OWNER
owner can create project
creator becomes MAINTAINER
unauthorized users cannot access either
production deploy works
```

---

## Phase 2 — Components + Default Workflow

Build:

```text
components
workflow_states
workflow_transitions
default workflow generation
basic project settings
```

Done when:

```text
maintainers can manage components
new projects have a valid workflow
workflow is queryable by the app
```

---

## Phase 3 — Core Issue Creation

Build:

```text
issues
human-readable issue IDs
create_issue transaction
issue form
basic issue page
creation audit event
```

Done when:

```text
TRACE-1 can be created and opened
```

This is the first major product milestone.

---

## Phase 4 — Issue List + Editing

Build:

```text
issue table
pagination
sorting
basic filters
priority
severity
type
component
assignee
inline editing
```

Done when TraceBox is usable as a basic bug tracker.

---

## Phase 5 — Comments + Activity

Build:

```text
comments
Markdown
activity timeline
issue_events
mentions groundwork
```

Done when developers can collaborate directly on issues.

---

## Phase 6 — Assignment + Workflow

Build:

```text
assign_issue
transition_issue
resolution
reopen
workflow validation
status UI
```

Done when issues move through a controlled lifecycle.

---

## Phase 7 — Labels + Versions + Milestones

Build:

```text
labels
versions
milestones
issue associations
milestone detail page
```

Done when issues can be organized around releases.

---

## Phase 8 — Watchers + Notifications

Build:

```text
issue_watchers
notifications
basic preferences
in-app inbox
assignment notifications
mention notifications
status notifications
```

---

## Phase 9 — Realtime

Add:

```text
new comments
important issue updates
notifications
```

---

## Phase 10 — Search + Saved Views

Build:

```text
Postgres FTS
pg_trgm
quick search
advanced filters
saved views
shareable views
```

---

## Phase 11 — Dependencies + Duplicates

Build:

```text
issue_links
dependency display
duplicate resolution
duplicate suggestions
```

---

## Phase 12 — Triage Inbox

Build:

```text
triage queue
inline classification
keyboard controls
duplicate suggestions integration
```

This should be a headline demo feature.

---

## Phase 13 — Attachments

Build:

```text
Supabase Storage
attachment metadata
upload UI
download authorization
restricted storage policies
```

---

## Phase 14 — Reports + Analytics

Build:

```text
project metrics
created vs resolved
backlog
issue age
resolution time
component breakdown
priority breakdown
```

---

## Phase 15 — Release Readiness

Build:

```text
milestone readiness
blocker detection
critical issue detection
regression detection
risk list
explainable readiness score
```

This should be another headline feature.

---

## Phase 16 — Command Palette + Keyboard UX

Build:

```text
Ctrl+K palette
issue navigation
project navigation
create issue
my issues
quick status actions
```

---

## Phase 17 — Issue Templates

Build:

```text
issue_templates
project settings UI
template selection
```

---

## Phase 18 — Restricted Security Issues

Build thoroughly:

```text
issue_access
restricted visibility
explicit access grants
restricted search
restricted analytics
restricted realtime
restricted storage
```

This phase requires dedicated RLS tests.

---

## Phase 19 — GitHub Integration

Build:

```text
repository connection
webhooks
issue references
PR links
commit links
merge state
optional automatic resolution
```

---

## Phase 20 — Custom Fields + Public API

Only after the main tracker is stable.

Build:

```text
custom_fields
issue_custom_values
API tokens
public REST API
token scopes
```

---

# 55. Demo Story

A strong final demo:

```text
1. Create a project
2. Create components
3. Report a bug
4. Show duplicate suggestions
5. Submit it
6. Triage it
7. Assign it
8. Move it to In Progress
9. Add a comment
10. Link a blocker
11. Add it to a milestone
12. Resolve it
13. Show immutable activity history
14. Open release readiness
15. Show release blockers
16. Search for issues
17. Open a saved view
```

This demonstrates both reconstruction and innovation.

---

# 56. Product Success Criteria

TraceBox should eventually demonstrate:

```text
✓ modern issue creation
✓ workspaces and projects
✓ components
✓ versions and milestones
✓ priority and severity
✓ controlled workflow
✓ assignment
✓ comments
✓ labels
✓ watchers
✓ audit history
✓ dependencies
✓ duplicate handling
✓ search
✓ saved views
✓ notifications
✓ realtime updates
✓ triage workflow
✓ attachments
✓ analytics
✓ release readiness
✓ restricted security issues
✓ strong RLS
✓ Vercel deployment
✓ Supabase backend
```

---

# 57. Do Not Prioritize Yet

Do not prioritize:

```text
AI chatbot
AI bug rewriting
AI code fixing
full chat
video calls
mobile app
plugin marketplace
complex automation builder
custom scripting language
dozens of themes
microservices
external search cluster
```

The issue tracker itself must be excellent first.

---

# 58. Agent Execution Rules

1. Do not implement later phases prematurely.
2. Every schema change requires a migration.
3. Never disable RLS as a shortcut.
4. Never expose the Supabase service-role key to client code.
5. Important mutations must validate authentication and authorization server-side.
6. Do not create fake navigation for unfinished features.
7. Keep production deployable after each merged phase.
8. Prefer the existing architecture over adding new libraries.
9. If a choice is unspecified, choose the simplest secure implementation that is extensible.
10. Do not sacrifice backend correctness for frontend speed.

---

# 59. Immediate Next Task

Begin with:

```text
Organizations + Projects
```

Implement:

```text
organizations table
organization_members table
projects table
project_members table
RLS policies
workspace onboarding
workspace switcher
project creation
project switcher
```

Acceptance criteria:

```text
✓ authenticated user can create a workspace
✓ creator becomes OWNER
✓ owner can create a project
✓ creator becomes project MAINTAINER
✓ project keys are unique within workspace
✓ unauthorized users cannot access workspace/project data
✓ navigation reflects current workspace/project
✓ migration is committed
✓ local build passes
✓ production deploy succeeds
```

Once this is deployed, continue immediately with:

```text
Components + Default Workflow
```

and then proceed through the roadmap phase by phase.

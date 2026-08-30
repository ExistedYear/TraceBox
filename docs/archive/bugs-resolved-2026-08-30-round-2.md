# Resolved product issues — 2026-08-30

This record preserves the second submitted bug list and the implemented outcome.

| Report | Resolution |
|---|---|
| Confirmation/OAuth required a refresh before onboarding | The Auth callback now writes exchanged session cookies onto the redirect response, so dashboard/onboarding sees the session immediately. |
| Email-change placeholder exposed Auth configuration language | Replaced with direct user-facing confirmation instructions. |
| Project switcher formatting was unclear | Project keys and names now use stable aligned columns with clearer hierarchy. |
| Settings looked broken without a selected project | Settings now shows a project chooser, create action for administrators, and archived-project recovery. |
| Invitations did not send email | Workspace/project invitations now go through a same-origin authenticated server route that attempts Supabase Auth email delivery and retains the secure manual link as fallback. |
| Notification switches did not look or move like switches | Rebuilt the control with a visible thumb, valid sizing, animated translation, focus ring, disabled state, and switch semantics. |
| No public workspace directory | Migration 082 adds opt-in visibility, safe aggregate discovery, and explicit MEMBER/REPORTER joining; `/dashboard/discover` provides the UI. |
| Audit explorer appeared in both sidebar and settings | Removed the duplicate settings entry; Audit remains in project navigation. |
| General quality review requested | Main-agent review includes typecheck, lint, tests, production build, migration verification, linked SQL lint, secret scan, and manual authorization/data-flow review before release. |

No active bug tracker is kept in `docs/`; new verified issues should be filed in the repository issue tracker.

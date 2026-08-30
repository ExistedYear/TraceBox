# Production bug register

Last reviewed: 30 August 2026

This file records defects observed during the hosted, two-account TraceBox pass and their disposition in the current source tree. A checklist item that could not be exercised because a provider or credential was unavailable is listed separately as a test gap; it is not treated as a product bug.

## Fixed in the current source tree

| ID | Severity | Area | Production evidence | Resolution | Deployment status |
|---|---|---|---|---|---|
| TB-001 | High | Hydration / navigation | React minified error `#418` remained reproducible on fresh authenticated issue routes after the earlier date/accent fixes. | In addition to deterministic dates and accent state, the theme toggle now gates `next-themes`' browser-derived `resolvedTheme` until mount. Its server render and first client render therefore use the same label and icon even when a saved theme exists. | Source fixed; repeat the authenticated console pass after deployment. |
| TB-002 | High | Client runtime / route transitions | The hydration replacement caused delayed Next.js stream fragments to raise repeated null-`parentNode` errors. Mutations persisted, but the client could display stale state until reload. | Removed the remaining shared-shell hydration mismatch in the theme toggle; the stream errors are a downstream symptom of TB-001. | Source fixed with TB-001; repeat rapid route transitions after deployment. |
| TB-003 | Medium | GitHub operations copy | The empty state rendered “eligible retryies”. | Singular/plural copy now renders “retry” or “retries,” with a regression test. | Fixed and test-covered. |
| TB-004 | Medium | Issue creation navigation | A success toast could appear while the browser remained on the creation route. | Successful creation clears the draft guard, locks the submit action, replaces the route with the new issue, and keeps an “Open issue” toast action as recovery. | Fixed and test-covered. |
| TB-005 | Medium | Trace AI provider response | Hosted Analyze returned `AI_INVALID_RESPONSE`; deterministic intelligence continued to work. | The Gemini client now ignores reasoning-only response parts before JSON parsing and requests the model's minimal supported thinking level to reduce reasoning latency and output-budget use. | Source fixed and provider-contract tested; repeat Analyze after deployment. |

## Not bugs; still unverified before submission

- Email confirmation, recovery, email-change, and email-delivery journeys were intentionally skipped per the test request.
- GitHub App installation, repository binding, PR checks, webhook signatures, retries, and reconciliation require a configured GitHub App and were only verified through the disconnected/empty states.
- REST API/token lifecycle and leak tests require a bearer token and direct API access; the in-app browser blocked the API navigation.
- The full custom-field type matrix, all issue-link relationship permutations, invalid/self-link rejection, stale-edit conflict handling across two tabs, keyboard-only shortcuts, and 768px/1440px responsive passes still need dedicated execution.
- Attachment upload and listing passed with a harmless text file; size/type/path rejection, interrupted uploads, signed-download expiry, visibility-loss behavior, orphan reconciliation, and deletion were not all exercised.
- CSV export controls rendered, but the in-app browser did not expose a detectable download event; verify the file manually in a normal browser.

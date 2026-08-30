# Production bug register

Last reviewed: 30 August 2026 — live desktop retest

This file records defects observed during hosted TraceBox verification and their disposition in the current source tree. Provider-specific setup and operational guidance belongs in `docs/deployment.md`.

## Fixed in the current source tree

| ID | Severity | Area | Production evidence | Resolution | Deployment status |
|---|---|---|---|---|---|
| TB-001 | High | Hydration / navigation | React minified error `#418` remained reproducible on fresh authenticated issue routes after the earlier date/accent fixes. | In addition to deterministic dates and accent state, the theme toggle now gates `next-themes`' browser-derived `resolvedTheme` until mount. Its server render and first client render therefore use the same label and icon even when a saved theme exists. | Fixed, deployed in `fb60840`, and verified in fresh authenticated desktop tabs with zero console errors. |
| TB-002 | High | Client runtime / route transitions | The hydration replacement caused delayed Next.js stream fragments to raise repeated null-`parentNode` errors. Mutations persisted, but the client could display stale state until reload. | Removed the remaining shared-shell hydration mismatch in the theme toggle; the stream errors were a downstream symptom of TB-001. | Fixed and verified after deployment; rapid route navigation across all non-GitHub routes is clean. |
| TB-003 | Medium | GitHub operations copy | The empty state rendered “eligible retryies”. | Singular/plural copy now renders “retry” or “retries,” with a regression test. | Fixed and test-covered. |
| TB-004 | Medium | Issue creation navigation | A success toast could appear while the browser remained on the creation route. | Successful creation clears the draft guard, locks the submit action, replaces the route with the new issue, and keeps an “Open issue” toast action as recovery. | Fixed and verified live: complete issue creation navigated to `/dashboard/issues/E2E-1`. |
| TB-005 | Medium | Trace AI provider response | Hosted Analyze returned `AI_INVALID_RESPONSE`; deterministic intelligence continued to work. | The Gemini client now ignores reasoning-only response parts before JSON parsing and requests the model's minimal supported thinking level to reduce reasoning latency and output-budget use. | Fixed and verified live: Analyze returned validated advisory suggestions and atomic apply succeeded. |

- CSV export controls rendered, but the in-app browser did not expose a detectable download event; verify the file manually in a normal browser.

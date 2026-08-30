# Bug status

Reviewed on 30 August 2026.

| Report | Status | Resolution |
|---|---|---|
| Password-reset email could not be sent | Working; provider quota was exhausted | Production Auth logs recorded `over_email_send_rate_limit`. The reset route and callback are correct, and the UI now explains the rate limit safely. Retry after the built-in quota resets. |
| Duplicate or invalid accounts do not show safe errors | Fixed in code | The UI now maps stable Supabase Auth error codes to safe messages and never displays unknown provider details. Supabase may intentionally conceal an existing signup account to prevent account enumeration. |
| Workspace invite email is unavailable | Working fallback; existing Auth user cannot be re-invited by Supabase Auth | Production logs recorded `email_exists`. The TraceBox invitation remains valid and returns its one-time manual acceptance link. |
| Change-email reports a generic failure | Working; provider quota was exhausted | Production Auth logs recorded `over_email_send_rate_limit`. Stable Auth error codes now produce actionable feedback. Secure email change can consume two messages. |

## Production email checklist

1. Set the hosted Site URL and allow redirects for the Auth callback, password reset, and invitation routes.
2. Space built-in Auth email tests so signup confirmation does not exhaust the recovery or email-change quota.
3. Test recovery with an existing confirmed account.
4. Test a Supabase Auth invitation only with a new Auth address; share the TraceBox manual link with existing users.
5. If a request fails, inspect Logs, then Auth Logs for its stable error code. Do not expose raw provider errors to users.
6. Configure custom SMTP only when reliable public delivery or a higher sending allowance is required.

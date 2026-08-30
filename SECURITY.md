# Security Policy

## Supported version

Security fixes are applied to the latest `main` branch and the live deployment. Older commits and forks are not maintained.

## Report a vulnerability

Do not open a public GitHub issue for an unpatched vulnerability.

Use GitHub's private vulnerability reporting page:

1. Open the repository's **Security** tab.
2. Choose **Advisories**.
3. Select **Report a vulnerability**.
4. Include affected routes or components, reproduction steps, expected impact, and a safe proof of concept if available.

If private reporting is unavailable, contact the repository owner privately through their GitHub profile and ask for a secure reporting channel. Do not send secrets or customer data in the first message.

## Response process

- A maintainer reviews and acknowledges the report.
- Scope and severity are confirmed before details are published.
- Fixes are developed privately when disclosure would put users at risk.
- An advisory and credit are published after affected deployments are updated, unless the reporter asks not to be credited.

Response times are best effort. This open-source project has no guaranteed service-level agreement.

## Security boundaries

TraceBox uses:

- Supabase Auth for identity and session refresh.
- PostgreSQL Row Level Security for tenant and issue isolation.
- `can_view_issue` for restricted issue-owned data.
- Narrow SQL functions for privileged and atomic writes.
- Private Storage with signed attachment URLs.
- Server-only service-role, GitHub App, webhook, cron, and Groq credentials.
- Signed and idempotent GitHub webhook processing.
- Bounded, redacted AI input with no restricted or security issue inference.
- Immutable browser-facing audit history.

## Secrets

Never include these in a report, commit, screenshot, fixture, or public log:

- `.env.local` or production environment files
- Supabase service-role or secret keys
- GitHub App private keys or client secrets
- GitHub webhook secrets
- Groq API keys
- cron secrets
- TraceBox API bearer tokens
- invitation tokens, signed URLs, cookies, or browser storage
- real customer issue content or personal information

The credentials `demo@123.com` / `demo123` are intentional public demo data. They may exist in a local database or the hosted demonstration, carry only ordinary user access, and must never be granted privileged credentials or access to real tenant data.

## Safe testing

Use a disposable Supabase project and accounts you own. Do not test the live deployment in a way that changes or exposes another user's data. Do not run denial-of-service tests, send unsolicited email, or access third-party repositories without permission.

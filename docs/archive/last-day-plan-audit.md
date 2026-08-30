# Trace Intelligence Implementation Audit

Audited on 2026-08-30 against the implementation, migrations 080–081, the linked Supabase ledger, and the retained [`last_day_plan.md`](last_day_plan.md) specification.

## Shipped boundary

Trace Intelligence is implemented as an advisory layer around existing deterministic TraceBox systems:

- deterministic defect-report quality for BUG, REGRESSION, PERFORMANCE, and SECURITY issues;
- structured triage suggestions for component, severity, priority, assignee, regression likelihood, follow-up questions, and up to three deterministic duplicate candidates;
- side-by-side duplicate comparison followed by the existing atomic duplicate-resolution RPC;
- natural-language parsing into the existing validated issue-filter and canonical URL contract;
- release-risk briefs that explain, but never calculate or replace, the database readiness score;
- a bounded, permission-filtered blocking/dependency graph with a text-tree fallback.

Provider-backed work is never automatic. Users explicitly choose Analyze, Parse, or Generate. Missing provider configuration and provider failures leave the deterministic product available.

## Security and authorization

- `OPENROUTER_API_KEY` and the native OpenRouter HTTP client stay in server-only modules. No `NEXT_PUBLIC_*` provider variable exists.
- POST routes require an authenticated Supabase user, a same-origin browser request, a bounded JSON body, valid UUID inputs, current project membership, and feature-specific live-access checks.
- Restricted issues and issues with type `SECURITY` are excluded from external inference. The same rule applies to duplicate candidates and release-risk contributors, not only the primary issue.
- Provider context excludes comments, attachment bodies, webhook payloads, email addresses, tokens, GitHub configuration, and raw provider feedback. Included non-restricted defect text is bounded and recursively redacted before hashing or transmission.
- OpenRouter output uses strict JSON Schema and is parsed again with Zod. Every returned identity is checked against the exact supplied allowlist.
- Natural search never produces SQL. It can only populate the existing filter DTO.
- AI never receives a privileged mutation path. Selected triage fields use `apply_issue_triage_updates`, which composes existing edit and assignment authorization inside one optimistic transaction.

## Cache and request controls

Migration 080 owns two RLS-enabled, RPC-only tables:

- `ai_analysis_cache` stores viewer/project/feature/input/version keys and bounded validated JSON results;
- `ai_request_ledger` records leases and terminal request state for budgets and single-flight behavior.

Direct browser reads and writes are revoked. Cache keys include model, schema, and prompt versions. Results expire within a bounded TTL. Claims are serialized per canonical input, limited to 30 requests per user and 200 per project per hour, and return explicit hit/claimed/pending/rate-limited states.

Every result is viewer-scoped. Reads and completion recheck project membership, primary issue visibility, and every issue whose data contributed to provider context. Restricting, deleting, or losing access to any contributing issue makes the cached result unreadable even before TTL cleanup.

## Provider contract

- Provider: OpenRouter
- Model: `z-ai/glm-5.2:free`
- Response mode: OpenAI-compatible JSON Schema structured output
- Request timeout: 8 seconds
- Application context cap: 24,000 serialized characters
- Output cap: 4,096 completion tokens and 20,000 response characters

Production operators must review current OpenRouter provider terms, region/data-transfer requirements, free-endpoint rate limits, and data controls before configuring the key. Redaction does not convert arbitrary issue content into non-sensitive data.

## Verification status

Completed in this checkout:

- lint: zero errors; three existing React Compiler compatibility warnings;
- TypeScript: passed;
- Vitest: 236 tests across 43 files passed without GitHub, OpenRouter, or real application environment files;
- production build: passed with all six intelligence routes;
- migration chain: 84 contiguous files and synchronized `full_schema.sql`;
- linked Supabase: ledger now matches 001–084, the final dry run reports no pending migrations, linked SQL lint returns zero errors, and linked types were regenerated after the latest type-changing migration; migration 081 remains the forward correction for the audited three-hop/five-hop blast-radius mismatch.

The intelligence pgTAP file contains 35 assertions covering direct-DML denial, cross-user/project isolation, single-flight, budgets, primary and contributing-issue revocation, bounded graph context, cleanup, and atomic rollback. GitHub Actions run 33294663307 replayed all 84 migrations and passed all 276 database assertions across 16 files. A live OpenRouter response and authenticated multi-user browser run remain operator checks because no provider or disposable-account credentials are committed.

## Deliberate limitations

- AI output is advisory and may be wrong; confidence is displayed, not treated as authority.
- Provider-backed controls are hidden when `OPENROUTER_API_KEY` is absent.
- Release briefs are disabled when the selected scope contains a visible restricted or security issue.
- Blast radius follows current issue relationships; it does not infer undeclared source-code dependencies.
- No AI-generated explanation is persisted into issue history unless a user separately writes ordinary issue content.

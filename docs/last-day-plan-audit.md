# Last-Day Trace Intelligence Plan Audit

Audited on 2026-08-29 against the `adihtya` branch, the hosted Supabase contract through migration 079, the current TraceBox source, and current official Groq documentation. This is a review of [`last_day_plan.md`](last_day_plan.md), not an implementation record. The reviewed file was not edited, staged, or implemented during this audit.

## Verdict

The plan has a strong product direction and the right foundational rules: AI remains advisory, existing deterministic systems remain canonical, human approval is required, structured output is validated, restricted issues stay away from external inference, and provider failure cannot block core TraceBox workflows.

It is not safe to execute literally yet. The security and lifecycle corrections below must be incorporated into the implementation checklist first. After those corrections, the P0/P1 ordering is realistic; Blast Radius should remain optional.

## External assumptions verified

- Groq currently lists `openai/gpt-oss-120b` as a production model and documents JSON Object and JSON Schema modes: [model documentation](https://console.groq.com/docs/model/openai/gpt-oss-120b) and [supported models](https://console.groq.com/docs/models).
- Groq currently supports `response_format.type = "json_schema"`; strict schemas require every property to be required, nullable unions for optional values, and `additionalProperties: false`: [Structured Outputs](https://console.groq.com/docs/structured-outputs).
- The free-plan limits are finite and can be exhausted by unique analyses, so caching alone is not an abuse-control mechanism: [rate limits](https://console.groq.com/docs/rate-limits).
- Ordinary inference is not retained by default, but reliability/abuse logs may retain inputs and outputs for up to 30 days unless Zero Data Retention is enabled: [Your Data in GroqCloud](https://console.groq.com/docs/your-data).

Model availability, schema-mode support, rate limits, and data controls are mutable provider facts. Re-check them immediately before implementation and deployment. Do not silently substitute a different model.

## Required corrections before implementation

### 1. Cache authorization must follow live access

`viewer_id = auth.uid()` is necessary but insufficient. A user who loses project or restricted-issue access must not retain access to cached content derived from that project or issue.

The cache read/write contract must also verify current project membership and current issue visibility. Issue-derived rows should carry the relevant issue identity and be unreadable when `can_view_issue(issue_id)` becomes false. Release/search rows need an equivalent live project boundary. Add bounded expiry and purge behavior for revoked access, deleted context, model/prompt-version changes, and expired rows.

Trusted cache writes must use a narrow server-only RPC or an authenticated RLS path. Do not expose a generic service-role cache writer.

### 2. Restricted context means every supplied record

The plan blocks Groq when the primary issue is restricted, but a normal primary issue could still include a restricted duplicate candidate, and a release brief could include a restricted top-risk issue. That would disclose restricted content externally even though the primary request is not restricted.

Never send restricted issue titles, descriptions, metadata, derived explanations, or identifiers from any context position. Exclude restricted candidates from external inference even when the viewer can see them, and keep restricted release-risk details in deterministic local UI. If safe context cannot be assembled without them, skip inference.

### 3. Add request budgets and single-flight behavior

Cache misses can be manufactured with unique text, and double-clicks can race before either result is stored. Add per-user and per-project request budgets, a bounded input size, a single-flight/advisory lock keyed by the canonical hash, and an idempotent cache upsert. Return `AI_RATE_LIMITED` without affecting deterministic workflows.

Do not retry provider 429/5xx responses automatically in the interactive request. A user-controlled retry can run after `Retry-After` where present.

### 4. Make provider privacy an operator gate

Redaction reduces accidental secret disclosure but does not make arbitrary issue content non-sensitive. Deployment instructions must require review of provider terms, region/data-transfer requirements, and Groq Data Controls. Enable Zero Data Retention where available before sending production issue content. Document that non-restricted user content is transmitted to an external processor and obtain whatever organization/user disclosure is appropriate.

Never send comments, attachment bodies, webhook payloads, email addresses, access tokens, integration configuration, or raw provider feedback payloads. Redaction must recursively traverse the exact serialized context and run before hashing/logging/provider calls.

### 5. Constrain cost and latency explicitly

The 5–8 second target needs an abortable timeout, bounded output tokens, bounded context, and an explicit supported reasoning effort. The current free-plan token budget is much smaller than the model context window, so a 131K context limit is not an application budget.

Store provider/model/prompt/schema versions in the canonical hash. Never log prompts or raw provider output. Record only safe operational metadata such as duration, cache state, feature, normalized failure category, and token counts.

### 6. Translate Zod schemas to Groq's strict subset

The logical TypeScript schemas are suitable, but the provider JSON Schema must follow Groq's supported subset. All fields should be required at the schema layer, optional semantic values should be nullable, objects should reject additional properties, arrays and strings should have application bounds, and confidence should be an integer from 0 through 100.

Still parse the response with Zod and validate component, assignee, issue, version, milestone, and label IDs against the exact supplied allowlists. Strict provider output does not replace application authorization.

### 7. Apply-selected must be atomic and conflict-aware

Sequentially composing multiple existing RPCs could apply only part of a selected recommendation set. Use the existing optimistic issue-update transaction where it covers the fields, or add one narrow atomic wrapper that performs the same authorization, validation, audit, notification, archive, and `updated_at` checks. Report conflicts without overwriting concurrent human edits.

AI output must never choose a workflow transition unless the UI separately presents a currently valid transition and the existing transition RPC authorizes it.

### 8. Scope report quality to defect reports

The proposed rubric is appropriate for `BUG`, `REGRESSION`, `PERFORMANCE`, and possibly `SECURITY` issues. It would misleadingly penalize ordinary `TASK` and `ENHANCEMENT` issues for lacking reproduction evidence. Define the eligible issue types, or provide a separate non-defect completeness rubric. Restricted security reports can use the deterministic calculation locally.

Attachment evidence must use authorized metadata only and distinguish a failed metadata query from “no evidence.”

### 9. Keep demo data out of production seed history

TraceBox intentionally keeps `supabase/seed.sql` empty. Demo content should be an explicit, idempotent, non-production fixture/script with clearly fake accounts and a cleanup path. It must not be added to the ordered production migration chain or run automatically on hosted customer data.

### 10. Separate source gates from operator gates

Fresh-clone checks, provider smoke, production deployment, ZDR settings, demo rehearsal, screenshots, and submission are operator-owned external gates. The coding agent can prepare commands and documentation but must not mark them complete without direct evidence from the actual environment.

## Clarifications that should be added

- Define one feature authorization matrix: who may request analysis, view a cached result, apply each suggestion, and invalidate results.
- Define cache retention, maximum row/result size, cleanup scheduling, and whether users can explicitly refresh an analysis.
- Define an AI response version so old cached JSON is never parsed as a new schema.
- Validate the final client bundle for `GROQ_API_KEY` and provider SDK imports; `server-only` should be enforced at the module boundary.
- Use POST-only server entry points with authenticated user context, origin/CSRF protections appropriate to the chosen Next.js mechanism, body-size limits, and safe JSON error responses.
- Preserve deterministic candidate ordering in fallback and make AI reranking visibly advisory.
- Make a “cached” badge reflect application-cache state, not Groq's separate volatile prompt cache.
- Ensure no generated explanation is written into immutable issue history unless a human explicitly submits it as ordinary issue content.
- Add accessibility assertions for async announcements, focus after Apply/Compare, and non-color confidence labels.
- Test access revocation after a cache entry exists, not only cross-user reads at creation time.

## Current implementation boundary

The current submission branch intentionally contains none of this future scope:

- no Groq dependency or provider key contract
- no AI cache table or migration
- no AI server route/action
- no report-quality or blast-radius implementation
- no AI triage, natural-language filter parser, duplicate explanation, or release brief UI

That is the correct state for this audit. The existing product and submission documentation do not advertise Trace Intelligence as implemented. [`feature-testing-checklist.md`](feature-testing-checklist.md) explicitly excludes it.

## Execution recommendation

Before future implementation, update the live checklist in `last_day_plan.md` with the ten required corrections above. Then implement P0 in small vertical slices, verify the restricted/cache revocation matrix before any provider smoke, and enter feature freeze before considering P2. If P0 cannot be proven against real authorization and provider-failure behavior, ship the current deterministic TraceBox product rather than exposing a partial AI surface.

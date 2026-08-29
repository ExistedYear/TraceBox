import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { deriveGithubInstallationHealth, expectedGithubPermissions, githubFailureCategory, isGithubDeliveryRetryEligible } from "../src/lib/github-operations";
import { scopeGithubRepositoryCatalog } from "../src/lib/github-repository-visibility";

const migration = readFileSync(new URL("../supabase/migrations/202608260064_phase13_github_operations.sql", import.meta.url), "utf8");
const processor = readFileSync(new URL("../src/lib/github-webhook-processor.ts", import.meta.url), "utf8");
const retryRoute = readFileSync(new URL("../src/app/api/github/retry/route.ts", import.meta.url), "utf8");

describe("GitHub operations read-model helpers", () => {
  it("compares the required read permissions without exposing values", () => {
    expect(expectedGithubPermissions({ contents: "read", metadata: "read", pull_requests: "write" })).toEqual(["checks"]);
    expect(expectedGithubPermissions({ contents: "none", metadata: "read", pull_requests: "read", checks: "read" })).toEqual(["contents"]);
  });

  it("derives lifecycle health in recovery order", () => {
    expect(deriveGithubInstallationHealth({ installations: [] })).toBe("NOT_CONNECTED");
    expect(deriveGithubInstallationHealth({ installations: [{ status: "PENDING", permissions: {} }] })).toBe("PENDING_APPROVAL");
    expect(deriveGithubInstallationHealth({ installations: [{ status: "ACTIVE", permissions: { contents: "read", metadata: "read", pull_requests: "read", checks: "read" } }] })).toBe("HEALTHY");
    expect(deriveGithubInstallationHealth({ installations: [{ status: "ACTIVE", permissions: { contents: "read", metadata: "read" } }] })).toBe("PERMISSION_UPDATE_REQUIRED");
  });

  it("maps failures to safe categories and respects the retry budget", () => {
    expect(githubFailureCategory("GitHub rate limit reached")).toBe("RATE_LIMITED");
    expect(githubFailureCategory("Processing failed after the maximum retry attempts.", 8)).toBe("RETRY_BUDGET_EXHAUSTED");
    expect(githubFailureCategory("permission missing for repository")).toBe("AUTHORIZATION");
    const now = Date.parse("2026-08-29T00:00:00.000Z");
    expect(isGithubDeliveryRetryEligible({ status: "FAILED", attempt_count: 2, next_retry_at: "2026-08-28T23:59:00.000Z" }, now)).toBe(true);
    expect(isGithubDeliveryRetryEligible({ status: "FAILED", attempt_count: 8, next_retry_at: null }, now)).toBe(false);
    expect(isGithubDeliveryRetryEligible({ status: "PROCESSED", attempt_count: 1, next_retry_at: null }, now)).toBe(false);
  });

  it("keeps delivery history project-scoped and payload-free", () => {
    expect(migration).toContain("and d.github_repository_id is null");
    expect(migration).toContain("where pgr.project_id = p_project_id");
    expect(migration).toContain("and public.can_view_issue(i.id)");
    expect(migration).toContain("'error', null");
    expect(migration).not.toContain("'payload', s.payload");
  });

  it("associates processed deliveries without changing the existing resolver", () => {
    expect(processor).toContain("record_github_webhook_delivery_issue");
    expect(processor).toContain("processGithubWebhookPayload(admin, delivery.payload ?? {}, delivery.event_name, delivery.action, deliveryId)");
    expect(processor).toContain("p_resolution_applied: resolutionApplied");
    expect(processor).toContain('db.rpc("resolve_issue_from_github"');
  });

  it("queues retries through the authenticated database boundary", () => {
    expect(retryRoute).toContain('auth.getUser()');
    expect(retryRoute).toContain('role !== "MAINTAINER"');
    expect(retryRoute).toContain('rpc("request_github_webhook_retry"');
    expect(migration).toContain("v_delivery.attempt_count >= 8");
    expect(migration).toContain("v_delivery.payload_cleared_at is not null");
  });

  it("scopes developer catalogs to bound repositories and their installations", () => {
    const catalog = scopeGithubRepositoryCatalog({
      role: "DEVELOPER",
      installations: [{ id: "installation-a" }, { id: "installation-b" }],
      repositories: [{ id: "repository-a", installation_id: "installation-a" }, { id: "repository-b", installation_id: "installation-b" }],
      bindings: [{ github_repository_id: "repository-a" }],
    });
    expect(catalog.repositories).toEqual([{ id: "repository-a", installation_id: "installation-a" }]);
    expect(catalog.installations).toEqual([{ id: "installation-a" }]);
  });

  it("keeps the organization catalog for maintainers", () => {
    const catalog = scopeGithubRepositoryCatalog({
      role: "MAINTAINER",
      installations: [{ id: "installation-a" }, { id: "installation-b" }],
      repositories: [{ id: "repository-a", installation_id: "installation-a" }, { id: "repository-b", installation_id: "installation-b" }],
      bindings: [{ github_repository_id: "repository-a" }],
    });
    expect(catalog.repositories).toHaveLength(2);
    expect(catalog.installations).toHaveLength(2);
  });
});

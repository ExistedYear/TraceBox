import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_GITHUB_WEBHOOK_BODY_BYTES } from "@/lib/github-operations";

const authRequest = vi.fn();
const visibleIssues = vi.fn();
const createAdmin = vi.fn();
const processDelivery = vi.fn();
const afterCallback = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: authRequest,
  filterApiVisibleIssues: visibleIssues,
  createAdminClient: createAdmin,
}));
vi.mock("@/lib/github-webhook-processor", () => ({ processGithubWebhookDelivery: processDelivery }));
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: afterCallback };
});

function query(data: unknown, error: unknown = null) {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "range"]) q[method] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => ({ data, error }));
  q.then = (resolve: (value: unknown) => unknown) => resolve({ data, error });
  return q;
}

function apiClient(project: unknown, issue: unknown, rpc = vi.fn(async () => ({ data: null, error: null }))) {
  return { from: vi.fn((table: string) => query(table === "projects" ? project : issue)), rpc };
}

const context = { tokenHash: "hash", tokenId: "token", userId: "user", organizationId: "org", organizationRole: "MEMBER", scopes: ["issues:read", "issues:write"] };

beforeEach(() => {
  vi.clearAllMocks();
  visibleIssues.mockResolvedValue(["issue"]);
  process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
});

describe("public API route contracts", () => {
  it("returns bearer auth failures before querying an issue", async () => {
    authRequest.mockResolvedValue({ response: Response.json({ error: "Missing Bearer token." }, { status: 401 }) });
    const { GET } = await import("@/app/api/v1/issues/[issueKey]/route");
    const response = await GET(new Request("http://localhost/api/v1/issues/APP-1") as never, { params: Promise.resolve({ issueKey: "APP-1" }) });
    expect(response.status).toBe(401);
    expect(authRequest).toHaveBeenCalledWith(expect.any(Request), "issues:read");
  });

  it("preserves scope denial as 403", async () => {
    authRequest.mockResolvedValue({ response: Response.json({ error: "API token lacks issues:write scope." }, { status: 403 }) });
    const { PATCH } = await import("@/app/api/v1/issues/[issueKey]/route");
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ title: "nope" }) }) as never, { params: Promise.resolve({ issueKey: "APP-1" }) });
    expect(response.status).toBe(403);
  });

  it("rejects malformed and unsupported PATCH bodies with contract statuses", async () => {
    const client = apiClient({ id: "project" }, { id: "issue" });
    authRequest.mockResolvedValue({ client, context });
    const { PATCH } = await import("@/app/api/v1/issues/[issueKey]/route");
    const params = { params: Promise.resolve({ issueKey: "APP-1" }) };
    expect((await PATCH(new Request("http://localhost", { method: "PATCH", body: "not-json" }) as never, params)).status).toBe(400);
    expect((await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ unknown: true }) }) as never, params)).status).toBe(422);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("passes the validated PATCH contract to the API RPC", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const client = apiClient({ id: "project" }, { id: "issue" }, rpc);
    authRequest.mockResolvedValue({ client, context });
    const { PATCH } = await import("@/app/api/v1/issues/[issueKey]/route");
    const updates = { title: "Updated title", description: null, priority: "P1" };
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify(updates) }) as never, { params: Promise.resolve({ issueKey: "APP-1" }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("api_update_issue", expect.objectContaining({ p_issue_id: "issue", p_token_hash: "hash", p_updates: updates }));
  });

  it("does not expose restricted issues filtered by the authorization boundary", async () => {
    const client = apiClient({ id: "project" }, { id: "issue", project_id: "project", visibility: "RESTRICTED", reporter_id: "other", assignee_id: null });
    authRequest.mockResolvedValue({ client, context });
    visibleIssues.mockResolvedValue([]);
    const { GET } = await import("@/app/api/v1/issues/[issueKey]/route");
    const response = await GET(new Request("http://localhost") as never, { params: Promise.resolve({ issueKey: "APP-1" }) });
    expect(response.status).toBe(404);
  });
});

describe("GitHub webhook route boundary", () => {
  function signedRequest(body: string, headers: Record<string, string> = {}) {
    const signature = createHmac("sha256", "test-secret").update(body).digest("hex");
    return new Request("http://localhost/api/webhooks/github", { method: "POST", body, headers: { "x-hub-signature-256": `sha256=${signature}`, "x-github-delivery": "delivery-1", "x-github-event": "push", ...headers } });
  }

  it("rejects invalid HMAC before persistence", async () => {
    const { POST } = await import("@/app/api/webhooks/github/route");
    const response = await POST(new Request("http://localhost", { method: "POST", body: "{}", headers: { "x-hub-signature-256": "sha256=bad", "x-github-delivery": "d", "x-github-event": "push" } }) as never);
    expect(response.status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("persists once, acknowledges duplicates, and queues processing", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { id: "delivery" }, error: null }).mockResolvedValueOnce({ data: null, error: null });
    createAdmin.mockReturnValue({ rpc });
    processDelivery.mockResolvedValue(true);
    const { POST } = await import("@/app/api/webhooks/github/route");
    const body = JSON.stringify({ action: "opened", repository: { id: 42 }, installation: { id: 7 } });
    const response = await POST(signedRequest(body) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, queued: true });
    expect(rpc).toHaveBeenCalledWith("record_github_webhook_delivery", expect.objectContaining({ p_delivery_id: "delivery-1", p_event_name: "push", p_github_repository_id: 42, p_github_installation_id: 7 }));
    expect(afterCallback).toHaveBeenCalledOnce();
    await afterCallback.mock.calls[0][0]();
    expect(processDelivery).toHaveBeenCalledWith("delivery-1");

    rpc.mockResolvedValueOnce({ data: null, error: null });
    const duplicate = await POST(signedRequest(body) as never);
    expect(await duplicate.json()).toEqual({ accepted: true, duplicate: true });
  });

  it("returns safe errors for malformed JSON and persistence failures", async () => {
    const { POST } = await import("@/app/api/webhooks/github/route");
    const malformed = await POST(signedRequest("{") as never);
    expect(malformed.status).toBe(400);
    createAdmin.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "XX", message: "db detail" } }) });
    const failed = await POST(signedRequest("{}") as never);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Could not record webhook delivery." });
  });

  it("rejects declared and actual oversized payloads before persistence", async () => {
    const { POST } = await import("@/app/api/webhooks/github/route");
    const declaredTooLarge = await POST(signedRequest("{}", { "content-length": String(MAX_GITHUB_WEBHOOK_BODY_BYTES + 1) }) as never);
    expect(declaredTooLarge.status).toBe(413);
    expect(createAdmin).not.toHaveBeenCalled();

    const oversized = `{"message":"${"🙂".repeat(Math.ceil(MAX_GITHUB_WEBHOOK_BODY_BYTES / 4))}"}`;
    const actualTooLarge = await POST(signedRequest(oversized, { "content-length": "1" }) as never);
    expect(actualTooLarge.status).toBe(413);
    expect(createAdmin).not.toHaveBeenCalled();
  });
});

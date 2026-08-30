import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { claimAiAnalysis, getCachedAiAnalysis, type AiCacheKey } from "@/lib/ai/cache";

const key: AiCacheKey = {
  feature: "TRIAGE",
  projectId: "00000000-0000-4000-a000-000000000001",
  issueId: "00000000-0000-4000-a000-000000000002",
  contextIssueIds: ["00000000-0000-4000-a000-000000000002", "00000000-0000-4000-a000-000000000003"],
  inputHash: "a".repeat(64),
  model: "model-test",
};

describe("Trace Intelligence cache adapter", () => {
  it("checks cache without claiming a provider lease", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ result: { confidence: 90 } }], error: null });
    await expect(getCachedAiAnalysis(key, { rpc })).resolves.toEqual({ confidence: 90 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_ai_analysis_cache", expect.objectContaining({ p_feature: "TRIAGE" }));
  });

  it("passes every contributing issue to the live-access claim contract", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ status: "CLAIMED", request_id: "claim-1" }], error: null });
    await expect(claimAiAnalysis(key, { rpc })).resolves.toMatchObject({ status: "CLAIMED", claimId: "claim-1" });
    expect(rpc).toHaveBeenCalledWith("claim_ai_analysis", expect.objectContaining({ p_context_issue_ids: key.contextIssueIds }));
  });
});

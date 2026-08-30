import "server-only";
import { createClient } from "@/lib/supabase/server";
import { AI_PROMPT_VERSION, AI_SCHEMA_VERSION, type AiCacheFeature } from "./config";
import { AiError } from "./errors";

export type AiClaim = { claimId?: string; status: "HIT" | "CLAIMED" | "IN_PROGRESS" | "MISS"; result?: unknown; expiresAt?: string | null };
type DbClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> };
export type AiCacheKey = { feature: AiCacheFeature; projectId: string; inputHash: string; model: string; schemaVersion?: string; promptVersion?: string; issueId?: string | null; contextIssueIds?: string[] };

export async function getCachedAiAnalysis(key: AiCacheKey, db?: DbClient): Promise<unknown | null> {
  const client = db ?? await createClient() as unknown as DbClient;
  const { data, error } = await client.rpc("get_ai_analysis_cache", { p_project_id: key.projectId, p_issue_id: key.issueId ?? null, p_feature: key.feature, p_input_hash: key.inputHash, p_model_version: key.model, p_schema_version: key.schemaVersion ?? AI_SCHEMA_VERSION, p_prompt_version: key.promptVersion ?? AI_PROMPT_VERSION });
  if (error) throw new AiError("AI_CONTEXT_UNAVAILABLE");
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" && "result" in row ? (row as { result: unknown }).result : null;
}

/** All cache mutations are transactional SQL RPCs. No browser/table cache writes are permitted. */
export async function claimAiAnalysis(key: AiCacheKey, db?: DbClient): Promise<AiClaim> {
  const client = db ?? await createClient() as unknown as DbClient;
  const { data, error } = await client.rpc("claim_ai_analysis", { p_project_id: key.projectId, p_issue_id: key.issueId ?? null, p_feature: key.feature, p_input_hash: key.inputHash, p_model_version: key.model, p_schema_version: key.schemaVersion ?? AI_SCHEMA_VERSION, p_prompt_version: key.promptVersion ?? AI_PROMPT_VERSION, p_context_issue_ids: key.contextIssueIds ?? [] });
  if (error) throw new AiError("AI_CONTEXT_UNAVAILABLE");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { status: "MISS" };
  const value = row as Record<string, unknown>;
  const rawStatus = String(value.status ?? ""); const status = rawStatus === "HIT" || rawStatus === "SUCCEEDED" ? "HIT" : rawStatus === "PENDING" ? "IN_PROGRESS" : rawStatus === "RATE_LIMITED" ? "IN_PROGRESS" : rawStatus === "CLAIMED" ? "CLAIMED" : "MISS";
  if (rawStatus === "RATE_LIMITED") throw new AiError("AI_RATE_LIMITED");
  return { status, claimId: typeof value.request_id === "string" ? value.request_id : undefined, result: value.result, expiresAt: typeof value.retry_after === "string" ? value.retry_after : null };
}
export async function completeAiAnalysis(key: AiCacheKey, claimId: string | undefined, result: unknown, db?: DbClient): Promise<void> {
  const client = db ?? await createClient() as unknown as DbClient;
  if (!claimId) throw new AiError("AI_CONTEXT_UNAVAILABLE");
  const { error } = await client.rpc("complete_ai_analysis", { p_request_id: claimId, p_result: result });
  if (error) throw new AiError("AI_CONTEXT_UNAVAILABLE");
}
export async function failAiAnalysis(key: AiCacheKey, claimId: string | undefined, db?: DbClient, errorCode: string = "AI_PROVIDER_ERROR"): Promise<void> {
  const client = db ?? await createClient() as unknown as DbClient;
  if (claimId) await client.rpc("fail_ai_analysis", { p_request_id: claimId, p_error_code: errorCode });
}

export async function withAiCache<T>(key: AiCacheKey, generate: () => Promise<T>, parse: (value: unknown) => T | null, db?: DbClient): Promise<{ result: T; cached: boolean }> {
  const claim = await claimAiAnalysis(key, db);
  const hit = claim.result === undefined ? null : parse(claim.result);
  if (claim.status === "HIT" && hit !== null) return { result: hit, cached: true };
  if (claim.status === "IN_PROGRESS") throw new AiError("AI_CLAIM_CONFLICT");
  if (claim.status !== "CLAIMED" && claim.status !== "MISS") throw new AiError("AI_CONTEXT_UNAVAILABLE");
  try {
    const result = await generate();
    await completeAiAnalysis(key, claim.claimId, result, db);
    return { result, cached: false };
  } catch (error) {
    await failAiAnalysis(key, claim.claimId, db);
    throw error;
  }
}

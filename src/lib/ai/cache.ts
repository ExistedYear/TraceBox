import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { AiCacheFeature } from "./config";

type CacheLookupParams = {
  feature: AiCacheFeature;
  projectId: string;
  inputHash: string;
  issueId?: string | null;
  milestoneId?: string | null;
};

type CacheStoreParams = CacheLookupParams & {
  model: string;
  result: unknown;
  expiresAt?: string | null;
};

export async function lookupAiCache(params: CacheLookupParams): Promise<unknown | null> {
  const supabase = await createClient();
  const supabaseAny = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (col: string, val: string) => { eq: (col: string, val: string) => { eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: { result: unknown; expires_at: string | null } | null; error: unknown }> } } };
      };
    };
  };
  const { data, error } = await (supabaseAny.from("ai_analysis_cache").select("result, expires_at").eq("feature", params.feature).eq("project_id", params.projectId).eq("input_hash", params.inputHash).maybeSingle() as Promise<{ data: { result: unknown; expires_at: string | null } | null; error: unknown }>);
  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.result as unknown;
}

export async function storeAiCache(params: CacheStoreParams): Promise<void> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const viewerId = auth.user?.id;
  if (!viewerId) return;

  const payload: Record<string, unknown> = {
    viewer_id: viewerId,
    project_id: params.projectId,
    feature: params.feature,
    input_hash: params.inputHash,
    model: params.model,
    result: params.result as never,
  };
  if (params.issueId) payload.issue_id = params.issueId;
  if (params.milestoneId) payload.milestone_id = params.milestoneId;
  if (params.expiresAt) payload.expires_at = params.expiresAt;

  const supabaseAny2 = supabase as unknown as { from: (table: string) => { upsert: (payload: unknown, opts: unknown) => Promise<{ error: { code?: string; message: string } | null }> } };
  const { error } = await supabaseAny2.from("ai_analysis_cache").upsert(payload as never, {
    onConflict: "viewer_id,feature,project_id,input_hash",
  });
  if (error) {
    console.error("ai cache store failed", { code: (error as { code?: string }).code, message: error.message });
  }
}

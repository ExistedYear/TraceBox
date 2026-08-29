export const AI_MODEL = "openai/gpt-oss-120b";

export const AI_TIMEOUT_MS = 8000;

export const AI_CACHE_FEATURES = ["TRIAGE", "SEARCH", "RELEASE"] as const;

export type AiCacheFeature = (typeof AI_CACHE_FEATURES)[number];

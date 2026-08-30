export const AI_MODEL = "z-ai/glm-5.2:free";
export const AI_TIMEOUT_MS = 8_000;
export const AI_MAX_QUERY_CHARS = 200;
export const AI_MAX_BODY_BYTES = 64 * 1024;
export const AI_MAX_CONTEXT_CHARS = 24_000;
export const AI_MAX_OUTPUT_CHARS = 20_000;
export const AI_PROMPT_VERSION = "2026-08-29.1";
export const AI_SCHEMA_VERSION = "1";

export const AI_CACHE_FEATURES = ["TRIAGE", "REPORT_QUALITY", "DUPLICATE_EXPLANATION", "NATURAL_LANGUAGE_SEARCH", "RELEASE_RISK", "BLAST_RADIUS"] as const;
export type AiCacheFeature = (typeof AI_CACHE_FEATURES)[number];

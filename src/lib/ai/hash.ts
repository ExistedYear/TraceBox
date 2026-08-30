import { createHash } from "node:crypto";
import { AI_MODEL, AI_PROMPT_VERSION, AI_SCHEMA_VERSION } from "./config";

export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}
export function sha256Hex(input: string): string { return createHash("sha256").update(input).digest("hex"); }
export function canonicalHash(value: unknown, model = AI_MODEL, schemaVersion = AI_SCHEMA_VERSION, promptVersion = AI_PROMPT_VERSION): string {
  return sha256Hex(canonicalStringify({ model, schemaVersion, promptVersion, input: value }));
}

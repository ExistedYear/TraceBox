import { createHash } from "node:crypto";

export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(obj[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function canonicalHash(value: unknown, model: string): string {
  const serialized = canonicalStringify(value);
  return sha256Hex(`${model}::${serialized}`);
}

import { NextRequest, NextResponse } from "next/server";
import { AI_MAX_BODY_BYTES } from "./config";
import { AiError, userFacingMessage, type AiErrorCode } from "./errors";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
export function getRequestLogId(request: NextRequest): string | undefined {
  const value = request.headers.get("x-request-id") ?? request.headers.get("x-vercel-id");
  if (!value) return undefined;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
  return sanitized || undefined;
}
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  try { return new URL(origin).origin === request.nextUrl.origin; } catch { return false; }
}
export async function boundedJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > AI_MAX_BODY_BYTES) throw new AiError("AI_REQUEST_TOO_LARGE");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > AI_MAX_BODY_BYTES) throw new AiError("AI_REQUEST_TOO_LARGE");
  try { const value = JSON.parse(raw) as unknown; return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
}
export function errorResponse(error: unknown, request?: NextRequest): NextResponse {
  const ai = error instanceof AiError ? error : new AiError("AI_PROVIDER_ERROR");
  console.error("Trace Intelligence request failed", {
    event: "trace_intelligence_request_failed",
    route: request?.nextUrl.pathname,
    requestId: request ? getRequestLogId(request) : undefined,
    code: ai.code,
    httpStatus: ai.status,
    errorType: error instanceof Error ? error.name : typeof error,
  });
  return NextResponse.json({ code: ai.code, message: userFacingMessage(ai.code as AiErrorCode) }, { status: ai.status });
}
export function jsonError(code: AiErrorCode, status?: number): NextResponse { return NextResponse.json({ code, message: userFacingMessage(code) }, { status: status ?? new AiError(code).status }); }

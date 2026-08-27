import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type GithubConnectState = {
  state: string;
  userId: string;
  organizationId: string;
  projectId: string;
  expiresAt: number;
};

function stateSecret() {
  const secret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!secret) throw new Error("GITHUB_APP_CLIENT_SECRET is not configured.");
  return secret;
}

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string) {
  return createHmac("sha256", stateSecret()).update(value).digest("base64url");
}

export function createGithubConnectState(input: Omit<GithubConnectState, "state" | "expiresAt">, lifetimeSeconds = 600) {
  const state = randomBytes(32).toString("base64url");
  const payload: GithubConnectState = { ...input, state, expiresAt: Math.floor(Date.now() / 1000) + lifetimeSeconds };
  const encoded = encode(JSON.stringify(payload));
  return { state, cookieValue: `${encoded}.${sign(encoded)}`, maxAge: lifetimeSeconds };
}

export function verifyGithubConnectState(cookieValue: string | undefined, state: string | null): GithubConnectState | null {
  if (!cookieValue || !state) return null;
  const [encoded, providedSignature] = cookieValue.split(".");
  if (!encoded || !providedSignature) return null;
  const expectedSignature = sign(encoded);
  const provided = Buffer.from(providedSignature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GithubConnectState;
    if (payload.state !== state || payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

type AuthErrorLike = { name?: string; message?: string; code?: string; status?: number } | null | undefined;

/** Supabase reports an anonymous or expired request as an auth error, not a successful null user. */
export function isMissingAuthSession(error: AuthErrorLike) {
  if (!error) return false;
  if (error.name === "AuthSessionMissingError" || error.message === "Auth session missing!") return true;
  const message = error.message?.toLowerCase() ?? "";
  const code = error.code?.toLowerCase() ?? "";
  return (
    code === "refresh_token_not_found" ||
    code === "session_not_found" ||
    code === "bad_jwt" ||
    message.includes("auth session missing") ||
    message.includes("refresh token not found") ||
    message.includes("session not found") ||
    message.includes("jwt expired") ||
    message.includes("invalid refresh token") ||
    message.includes("missing sub claim") ||
    message.includes("token is expired") ||
    message.includes("invalid token")
  );
}


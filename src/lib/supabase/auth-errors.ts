type AuthErrorLike = { name?: string; message?: string } | null | undefined;

/** Supabase reports an anonymous request as an auth error, not a successful null user. */
export function isMissingAuthSession(error: AuthErrorLike) {
  return error?.name === "AuthSessionMissingError" || error?.message === "Auth session missing!";
}

export function getSafeAuthErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "The email or password is incorrect.";
  }

  if (normalized.includes("email not confirmed")) {
    return "Please confirm your email address before signing in.";
  }

  if (normalized.includes("user already registered")) {
    return "An account with this email already exists.";
  }

  if (normalized.includes("password should be at least")) {
    return "Choose a password with at least 8 characters.";
  }

  return "Something went wrong. Please try again.";
}

export function getSafeWorkspaceErrorMessage(error: { code?: string; message?: string }) {
  if (error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "")) {
    if (/organizations_slug_key/i.test(error.message ?? "")) {
      return "That workspace URL is already taken. Try another slug.";
    }
    if (/(projects_organization_id_key_key|projects_organization_id_slug_key)/i.test(error.message ?? "")) {
      return "A project with that key already exists in this workspace.";
    }
    return "That name is already taken.";
  }

  if (error.message === "NOT_ORG_ADMIN") {
    return "Only workspace owners and admins can create projects.";
  }

  return "Something went wrong. Please try again.";
}

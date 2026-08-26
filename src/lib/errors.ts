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
  const msg = error.message ?? "";

  if (error.code === "23505" || /duplicate key|unique constraint/i.test(msg)) {
    if (/organizations_slug/i.test(msg)) {
      return "That workspace URL is already taken. Try another slug.";
    }
    if (/projects_organization_id_(key|slug)/i.test(msg) || /Key \(organization_id, (key|slug)\)/i.test(msg)) {
      return "A project with that key already exists in this workspace.";
    }
    return "That name or key is already taken.";
  }

  if (/NOT_ORG_ADMIN/i.test(msg)) {
    return "Only workspace owners and admins can create projects.";
  }

  if (/AUTH_REQUIRED/i.test(msg)) {
    return "You must be signed in to perform this action.";
  }

  if (error.code === "22023" || /VALIDATION/i.test(msg) || /check constraint/i.test(msg)) {
    if (/key/i.test(msg)) {
      return "Project key must be 2–10 uppercase letters or numbers (e.g. AUTH, CORE).";
    }
    if (/name/i.test(msg)) {
      return "Project name must be 2–80 characters.";
    }
    return "Please check the entered values and try again.";
  }

  return "Something went wrong. Please try again.";
}

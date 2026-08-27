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

export function getSafeWorkspaceErrorMessage(error: { code?: string; message?: string; details?: string; hint?: string }) {
  const msg = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  const code = error.code ?? "";

  if (code === "23505" || /duplicate key|unique constraint/i.test(msg)) {
    if (/organizations_slug/i.test(msg)) {
      return "That workspace URL is already taken. Try another slug.";
    }
    if (/projects_organization_id_(key|slug)/i.test(msg) || /Key \(organization_id, (key|slug)\)/i.test(msg)) {
      return "A project with that key already exists in this workspace.";
    }
    return "That name or key is already taken.";
  }

  if (/PROJECT_ARCHIVED/i.test(msg)) {
    return "This project is archived and cannot be modified.";
  }

  if (/INVALID_ASSIGNEE/i.test(msg)) {
    return "Selected assignee is not an eligible member of this project.";
  }

  if (/INVALID_COMPONENT/i.test(msg)) {
    return "Selected component is invalid or archived.";
  }

  if (/NOT_ALLOWED/i.test(msg)) {
    return "You do not have permission to perform this action.";
  }

  if (/NOT_ORG_ADMIN/i.test(msg)) {
    return "Only workspace owners and admins can create projects.";
  }

  if (/AUTH_REQUIRED/i.test(msg)) {
    return "You must be signed in to perform this action.";
  }
  if (code === "23503" || /foreign key/i.test(msg)) {
    return "Referenced workspace or profile not found.";
  }

  if (code === "22P02" || /invalid input syntax for type uuid/i.test(msg)) {
    return "Invalid workspace identifier.";
  }

  if (code === "PGRST202" || /function.*does not exist|could not find the function/i.test(msg)) {
    return "Database function not found. Please apply the latest migrations to Supabase (`npx supabase db push`).";
  }

  if (code === "42P01" || /relation.*does not exist/i.test(msg)) {
    return "Database table not found. Please apply the latest migrations to Supabase (`npx supabase db push`).";
  }

  if (code === "22023" || /VALIDATION/i.test(msg) || /check constraint/i.test(msg)) {
    if (/key/i.test(msg)) {
      return "Project key must be 2–10 uppercase letters or numbers (e.g. AUTH, CORE).";
    }
    if (/name/i.test(msg)) {
      return "Project name must be 2–80 characters.";
    }
    return "Please check the entered values and try again.";
  }

  if (code === "42501" || /permission denied|row-level security/i.test(msg)) {
    return "Permission denied. Workspace owners and admins only.";
  }

  return "Something went wrong. Please try again.";
}

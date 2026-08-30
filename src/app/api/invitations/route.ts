import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/api-auth";
import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  try { return new URL(origin).origin === request.nextUrl.origin; } catch { return false; }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
  const projectId = typeof body?.projectId === "string" ? body.projectId : null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const organizationRole = typeof body?.organizationRole === "string" ? body.organizationRole : "MEMBER";
  const projectRole = typeof body?.projectRole === "string" ? body.projectRole : null;
  if (!UUID.test(organizationId) || (projectId && !UUID.test(projectId)) || !EMAIL.test(email)) return NextResponse.json({ error: "Invitation details are invalid." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError && !isMissingAuthSession(authError)) return NextResponse.json({ error: "Could not verify your session." }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Sign in to create an invitation." }, { status: 401 });
  const { data, error } = await supabase.rpc("create_organization_invitation", {
    p_organization_id: organizationId,
    p_email: email,
    p_organization_role: organizationRole,
    p_project_id: projectId ?? undefined,
    p_project_role: projectRole ?? undefined,
  });
  if (error) return NextResponse.json({ error: error.message.includes("VALIDATION") ? "Invitation details are invalid." : "You cannot create this invitation." }, { status: error.code === "42501" ? 403 : 400 });
  const invitation = Array.isArray(data) ? data[0] : data;
  if (!invitation?.token) return NextResponse.json({ error: "Invitation could not be created." }, { status: 500 });
  const link = `${request.nextUrl.origin}/invite/${invitation.token}`;
  let emailSent = false;
  try {
    const { error: emailError } = await createAdminClient().auth.admin.inviteUserByEmail(email, { redirectTo: link });
    emailSent = !emailError;
    if (emailError) console.error("Invitation email delivery failed", { code: emailError.code, message: emailError.message, invitationId: invitation.id });
  } catch (cause) {
    console.error("Invitation email service unavailable", { error: cause instanceof Error ? cause.message : "unknown", invitationId: invitation.id });
  }
  return NextResponse.json({ invitation: { id: invitation.id, email: invitation.email, expires_at: invitation.expires_at, link }, emailSent });
}

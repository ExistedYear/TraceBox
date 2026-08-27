import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createGithubConnectState } from "@/lib/github-connect-state";
import { getGithubAppClientId, getGithubAppSlug } from "@/lib/github-app";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function redirectToSettings(request: NextRequest) {
  const url = new URL("/dashboard/settings/integrations", request.url);
  url.searchParams.set("github", "error");
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId || !UUID_RE.test(projectId)) return NextResponse.json({ error: "Valid project_id is required." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { data: project } = await supabase.from("projects").select("id, organization_id, is_archived").eq("id", projectId).maybeSingle();
  const { data: role } = await supabase.rpc("project_role", { p_project_id: projectId });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (project.is_archived) return NextResponse.json({ error: "Archived projects cannot connect GitHub." }, { status: 409 });
  if (role !== "DEVELOPER" && role !== "MAINTAINER") return NextResponse.json({ error: "Only Developers and Maintainers can connect GitHub." }, { status: 403 });

  try {
    const { state, cookieValue, maxAge } = createGithubConnectState({
      userId: user.id,
      organizationId: project.organization_id,
      projectId,
    });
    const installUrl = new URL(`https://github.com/apps/${encodeURIComponent(getGithubAppSlug())}/installations/new`);
    installUrl.searchParams.set("state", state);
    installUrl.searchParams.set("nonce", randomUUID());
    installUrl.searchParams.set("client_id", getGithubAppClientId());
    const response = NextResponse.redirect(installUrl);
    response.cookies.set("tb_github_connect_state", cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge,
      path: "/api/github",
    });
    return response;
  } catch (error) {
    console.error("GitHub connection is not configured", { error: error instanceof Error ? error.message : "unknown" });
    return redirectToSettings(request);
  }
}

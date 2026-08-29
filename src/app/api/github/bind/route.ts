import { NextRequest, NextResponse } from "next/server";

import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error && !isMissingAuthSession(error)) {
    console.error("GitHub repository binding authentication lookup failed", { code: error.code, message: error.message });
    return { supabase: null, authFailed: true };
  }
  return { supabase: user ? supabase : null, authFailed: false };
}

async function readBody(request: NextRequest, requireAutomation = false) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const projectId = typeof body.project_id === "string" ? body.project_id : "";
    const repositoryId = typeof body.github_repository_id === "string" ? body.github_repository_id : "";
    if (requireAutomation && (!Array.isArray(body.target_branches) || typeof body.auto_resolve_enabled !== "boolean")) return null;
    const targetBranches = Array.isArray(body.target_branches) ? body.target_branches.filter((branch): branch is string => typeof branch === "string").map((branch) => branch.trim()).filter(Boolean) : ["main"];
    if (!UUID_RE.test(projectId) || !UUID_RE.test(repositoryId) || targetBranches.length === 0 || targetBranches.length > 20 || targetBranches.some((branch) => branch.length > 120)) return null;
    return { projectId, repositoryId, isPrimary: body.is_primary !== false, autoResolveEnabled: body.auto_resolve_enabled !== false, targetBranches };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const { supabase, authFailed } = await getAuthenticatedClient();
  if (authFailed) return NextResponse.json({ error: "Could not verify authentication." }, { status: 500 });
  if (!supabase) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid GitHub repository binding." }, { status: 400 });
  const { data: role, error: roleError } = await (supabase as any).rpc("project_role", { p_project_id: body.projectId });
  if (roleError) return NextResponse.json({ error: "Could not verify project access." }, { status: 500 });
  if (role !== "MAINTAINER") return NextResponse.json({ error: "Only Maintainers can manage repository bindings." }, { status: 403 });
  const { error } = await (supabase as any).rpc("bind_github_repository", {
    p_project_id: body.projectId,
    p_github_repository_id: body.repositoryId,
    p_is_primary: body.isPrimary,
    p_auto_resolve_enabled: body.autoResolveEnabled,
    p_target_branches: body.targetBranches,
  });
  if (error) {
    console.error("GitHub repository binding failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "Could not connect that GitHub repository." }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { supabase, authFailed } = await getAuthenticatedClient();
  if (authFailed) return NextResponse.json({ error: "Could not verify authentication." }, { status: 500 });
  if (!supabase) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid GitHub repository binding." }, { status: 400 });
  const { data: role, error: roleError } = await (supabase as any).rpc("project_role", { p_project_id: body.projectId });
  if (roleError) return NextResponse.json({ error: "Could not verify project access." }, { status: 500 });
  if (role !== "MAINTAINER") return NextResponse.json({ error: "Only Maintainers can manage repository bindings." }, { status: 403 });
  const { error } = await (supabase as any).rpc("unbind_github_repository", { p_project_id: body.projectId, p_github_repository_id: body.repositoryId });
  if (error) {
    console.error("GitHub repository unbinding failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "Could not disconnect that GitHub repository." }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const { supabase, authFailed } = await getAuthenticatedClient();
  if (authFailed) return NextResponse.json({ error: "Could not verify authentication." }, { status: 500 });
  if (!supabase) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await readBody(request, true);
  if (!body) return NextResponse.json({ error: "Invalid GitHub automation settings." }, { status: 400 });
  const { data: role, error: roleError } = await (supabase as any).rpc("project_role", { p_project_id: body.projectId });
  if (roleError) return NextResponse.json({ error: "Could not verify project access." }, { status: 500 });
  if (role !== "MAINTAINER") return NextResponse.json({ error: "Only Maintainers can manage repository bindings." }, { status: 403 });

  const { data: binding, error: bindingError } = await (supabase as any)
    .from("project_github_repositories")
    .select("is_primary")
    .eq("project_id", body.projectId)
    .eq("github_repository_id", body.repositoryId)
    .maybeSingle();
  if (bindingError) {
    console.error("GitHub automation binding lookup failed", { code: bindingError.code, message: bindingError.message });
    return NextResponse.json({ error: "Could not load that GitHub repository binding." }, { status: 500 });
  }
  if (!binding) return NextResponse.json({ error: "That GitHub repository is not connected to this project." }, { status: 404 });

  const { error } = await (supabase as any).rpc("bind_github_repository", {
    p_project_id: body.projectId,
    p_github_repository_id: body.repositoryId,
    p_is_primary: binding.is_primary,
    p_auto_resolve_enabled: body.autoResolveEnabled,
    p_target_branches: body.targetBranches,
  });
  if (error) {
    console.error("GitHub automation settings update failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "Could not save GitHub automation settings." }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { projectSettingsSchema, workflowDefinitionSchema } from "@/lib/validation/project-settings";

const migration = readFileSync(new URL("../supabase/migrations/202608260049_phase7_project_workflow_admin.sql", import.meta.url), "utf8");

const states = [
  { id: "11111111-1111-1111-1111-111111111111", clientId: "open", name: "Open", category: "OPEN" as const, position: 0, color: "", isInitial: true, isTerminal: false },
  { id: "22222222-2222-2222-2222-222222222222", clientId: "done", name: "Done", category: "CLOSED" as const, position: 10, color: "", isInitial: false, isTerminal: true },
];

describe("project and workflow administration", () => {
  it("validates project metadata while keeping the key out of the mutation contract", () => {
    expect(projectSettingsSchema.safeParse({ name: "TraceBox", description: "Issue tracking" }).success).toBe(true);
    expect(projectSettingsSchema.safeParse({ name: "x", description: "" }).success).toBe(false);
    expect(Object.keys(projectSettingsSchema.shape)).not.toContain("key");
  });

  it("rejects invalid workflow drafts before publication", () => {
    expect(workflowDefinitionSchema.safeParse({ states, transitions: [{ fromClientId: "open", toClientId: "done", requiredRole: "REPORTER", requiresResolution: true }] }).success).toBe(true);
    expect(workflowDefinitionSchema.safeParse({ states: states.map((state) => ({ ...state, isInitial: true })), transitions: [] }).success).toBe(false);
    expect(workflowDefinitionSchema.safeParse({ states, transitions: [{ fromClientId: "open", toClientId: "missing", requiredRole: "", requiresResolution: false }] }).success).toBe(false);
    expect(workflowDefinitionSchema.safeParse({ states, transitions: [
      { fromClientId: "open", toClientId: "done", requiredRole: "", requiresResolution: false },
      { fromClientId: "open", toClientId: "done", requiredRole: "DEVELOPER", requiresResolution: true },
    ] }).success).toBe(false);
  });

  it("publishes the graph atomically with reachability and in-use deletion guards", () => {
    expect(migration).toContain("function public.replace_project_workflow");
    expect(migration).toContain("where id = p_project_id for update");
    expect(migration).toContain("STATE_IN_USE");
    expect(migration).toContain("Every state must be reachable from the initial state");
    expect(migration).toContain("Every state must have a path to a terminal state");
    expect(migration).toContain("workflow_states_one_initial_per_project_idx");
    expect(migration).toContain("requires_resolution boolean not null default false");
  });

  it("uses audited RPC-only project mutations", () => {
    expect(migration).toContain("revoke update on public.projects from anon, authenticated, public");
    expect(migration).toContain("function public.update_project_settings");
    expect(migration).toContain("function public.set_project_archived");
    expect(migration).toContain("PROJECT_UPDATED");
    expect(migration).toContain("WORKFLOW_PUBLISHED");
    expect(migration).toContain("revoke execute on function public.update_project_settings");
  });
});

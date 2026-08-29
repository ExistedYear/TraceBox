import { z } from "zod";

export const projectSettingsSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(80, "Keep the name under 80 characters."),
  description: z.string().trim().max(280, "Keep the description under 280 characters."),
});

export const WORKFLOW_CATEGORIES = ["TRIAGE", "OPEN", "IN_PROGRESS", "REVIEW", "RESOLVED", "CLOSED"] as const;
export const WORKFLOW_ROLES = ["", "VIEWER", "REPORTER", "DEVELOPER", "MAINTAINER"] as const;

export const workflowStateSchema = z.object({
  id: z.string().uuid().optional(),
  clientId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1, "Enter a state name.").max(40, "Keep state names under 40 characters."),
  category: z.enum(WORKFLOW_CATEGORIES),
  position: z.number().int().min(0).max(10_000),
  color: z.string().trim().max(32).optional(),
  isInitial: z.boolean(),
  isTerminal: z.boolean(),
});

export const workflowTransitionSchema = z.object({
  fromClientId: z.string().min(1),
  toClientId: z.string().min(1),
  requiredRole: z.enum(WORKFLOW_ROLES),
  requiresResolution: z.boolean(),
});

export const workflowDefinitionSchema = z.object({
  states: z.array(workflowStateSchema).min(2).max(50),
  transitions: z.array(workflowTransitionSchema).max(500),
}).superRefine(({ states, transitions }, ctx) => {
  if (states.filter((state) => state.isInitial).length !== 1) {
    ctx.addIssue({ code: "custom", path: ["states"], message: "Choose exactly one initial state." });
  }
  if (!states.some((state) => state.isTerminal)) {
    ctx.addIssue({ code: "custom", path: ["states"], message: "Choose at least one terminal state." });
  }
  if (new Set(states.map((state) => state.name.toLocaleLowerCase())).size !== states.length) {
    ctx.addIssue({ code: "custom", path: ["states"], message: "State names must be unique." });
  }
  if (new Set(states.map((state) => state.position)).size !== states.length) {
    ctx.addIssue({ code: "custom", path: ["states"], message: "State positions must be unique." });
  }
  const ids = new Set(states.map((state) => state.clientId));
  const edges = new Set<string>();
  for (const [index, transition] of transitions.entries()) {
    if (!ids.has(transition.fromClientId) || !ids.has(transition.toClientId)) {
      ctx.addIssue({ code: "custom", path: ["transitions", index], message: "Transition references a deleted state." });
    }
    if (transition.fromClientId === transition.toClientId) {
      ctx.addIssue({ code: "custom", path: ["transitions", index], message: "A state cannot transition to itself." });
    }
    const edge = `${transition.fromClientId}->${transition.toClientId}`;
    if (edges.has(edge)) ctx.addIssue({ code: "custom", path: ["transitions", index], message: "Duplicate transition." });
    edges.add(edge);
  }
});

export type ProjectSettingsValues = z.infer<typeof projectSettingsSchema>;
export type WorkflowStateValues = z.infer<typeof workflowStateSchema>;
export type WorkflowTransitionValues = z.infer<typeof workflowTransitionSchema>;

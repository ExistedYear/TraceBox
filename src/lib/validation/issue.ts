import { z } from "zod";

import { ISSUE_TYPES, PRIORITIES, SEVERITIES } from "@/lib/issues";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .optional()
    .or(z.literal(""));

export const issueCreateSchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(200, "Keep the title under 200 characters."),
  description: z.string().trim().max(10000, "Keep it under 10,000 characters.").optional().or(z.literal("")),
  type: z.enum(ISSUE_TYPES),
  component_id: z.string().uuid().optional().or(z.literal("")),
  priority: z.enum(PRIORITIES),
  severity: z.enum(SEVERITIES),
  assignee_id: z.string().uuid().optional().or(z.literal("")),
  environment: optionalText(2000),
  steps_to_reproduce: optionalText(5000),
  expected_behavior: optionalText(5000),
  actual_behavior: optionalText(5000),
  visibility: z.enum(["PROJECT", "RESTRICTED"]).optional(),
  access_user_ids: z.array(z.string().uuid()).max(100).optional(),
  template_id: z.string().uuid().optional().or(z.literal("")),
  custom_values: z.record(z.unknown()).optional(),
}).superRefine((value, ctx) => {
  if (!value.description?.trim() && !value.template_id) {
    ctx.addIssue({ code: "custom", path: ["description"], message: "Enter a description or choose a template." });
  }
});

/** REST payload shape for the atomic creation RPC. Template-backed fields may be omitted. */
export const issueCreatePayloadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10000).optional(),
  type: z.enum(ISSUE_TYPES).optional(),
  component_id: z.string().uuid().nullable().optional().or(z.literal("")),
  priority: z.enum(PRIORITIES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  assignee_id: z.string().uuid().nullable().optional().or(z.literal("")),
  environment: optionalText(2000),
  steps_to_reproduce: optionalText(5000),
  expected_behavior: optionalText(5000),
  actual_behavior: optionalText(5000),
  visibility: z.enum(["PROJECT", "RESTRICTED"]).optional(),
  access_user_ids: z.array(z.string().uuid()).max(100).optional(),
  template_id: z.string().uuid().nullable().optional().or(z.literal("")),
  custom_values: z.record(z.unknown()).optional(),
}).superRefine((value, ctx) => {
  if (!value.description?.trim() && !value.template_id) {
    ctx.addIssue({ code: "custom", path: ["description"], message: "Description is required unless a template supplies it." });
  }
});

export type IssueCreateValues = z.infer<typeof issueCreateSchema>;

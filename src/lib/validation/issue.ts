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
  description: z.string().trim().min(1, "Enter a description.").max(10000, "Keep it under 10,000 characters."),
  type: z.enum(ISSUE_TYPES),
  component_id: z.string().uuid("Select a component."),
  priority: z.enum(PRIORITIES),
  severity: z.enum(SEVERITIES),
  assignee_id: z.string().uuid().optional().or(z.literal("")),
  environment: optionalText(2000),
  steps_to_reproduce: optionalText(5000),
  expected_behavior: optionalText(5000),
  actual_behavior: optionalText(5000),
});

export type IssueCreateValues = z.infer<typeof issueCreateSchema>;

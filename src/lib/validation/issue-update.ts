import { z } from "zod";

import { ISSUE_TYPES, PRIORITIES, SEVERITIES } from "@/lib/issues";

/** Fields accepted by both the browser RPC and the public REST PATCH route. */
export const ISSUE_UPDATE_FIELDS = [
  "title",
  "description",
  "environment",
  "steps_to_reproduce",
  "expected_behavior",
  "actual_behavior",
  "priority",
  "severity",
  "type",
  "assignee_id",
  "component_id",
] as const;

const nullableText = (max: number) => z.string().trim().max(max).nullable();
const optionalUuid = z.string().uuid().or(z.literal("")).nullable();

export const issueUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: nullableText(10000).optional(),
    environment: nullableText(2000).optional(),
    steps_to_reproduce: nullableText(5000).optional(),
    expected_behavior: nullableText(5000).optional(),
    actual_behavior: nullableText(5000).optional(),
    priority: z.enum(PRIORITIES).optional(),
    severity: z.enum(SEVERITIES).optional(),
    type: z.enum(ISSUE_TYPES).optional(),
    assignee_id: optionalUuid.optional(),
    component_id: optionalUuid.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required." });

export type IssueUpdateValues = z.infer<typeof issueUpdateSchema>;
export type IssueUpdateField = (typeof ISSUE_UPDATE_FIELDS)[number];

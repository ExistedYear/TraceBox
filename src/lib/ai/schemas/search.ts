import { z } from "zod";

export const searchParseSchema = z.object({
  statuses: z.array(z.string().uuid()).max(10).default([]),
  resolutions: z.array(z.enum(["FIXED", "DUPLICATE", "WONT_FIX", "INVALID", "CANNOT_REPRODUCE", "WORKS_AS_EXPECTED"])).max(6).default([]),
  priorities: z.array(z.enum(["P0", "P1", "P2", "P3", "P4"])).max(5).default([]),
  severities: z.array(z.enum(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "TRIVIAL"])).max(5).default([]),
  types: z.array(z.enum(["BUG", "ENHANCEMENT", "TASK", "SECURITY", "PERFORMANCE", "REGRESSION"])).max(6).default([]),
  assignee: z.string().nullable().default(null),
  reporter: z.string().nullable().default(null),
  component_id: z.string().uuid().nullable().default(null),
  affected_version_id: z.string().uuid().nullable().default(null),
  target_milestone_id: z.string().uuid().nullable().default(null),
  labels: z.array(z.string().uuid()).max(10).default([]),
  text: z.string().max(200).nullable().default(null),
});

export type SearchParseResult = z.infer<typeof searchParseSchema>;

export const searchParseResponseSchema = searchParseSchema;

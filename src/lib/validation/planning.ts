import { z } from "zod";

export const labelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a label name.")
    .max(50, "Keep the label under 50 characters."),
  color: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Enter a valid hex color (e.g. #6366f1)"),
  description: z
    .string()
    .trim()
    .max(200, "Keep description under 200 characters.")
    .optional()
    .or(z.literal("")),
});

export const versionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a version name.")
    .max(80, "Keep version name under 80 characters."),
  description: z
    .string()
    .trim()
    .max(280, "Keep description under 280 characters.")
    .optional()
    .or(z.literal("")),
  released_at: z.string().optional().or(z.literal("")),
  is_released: z.boolean(),
});

export const MILESTONE_STATUSES = ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const milestoneSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a milestone name.")
    .max(80, "Keep milestone name under 80 characters."),
  description: z
    .string()
    .trim()
    .max(500, "Keep description under 500 characters.")
    .optional()
    .or(z.literal("")),
  due_at: z.string().optional().or(z.literal("")),
  status: z.enum(MILESTONE_STATUSES),
});

export type LabelValues = z.infer<typeof labelSchema>;
export type VersionValues = z.infer<typeof versionSchema>;
export type MilestoneValues = z.infer<typeof milestoneSchema>;

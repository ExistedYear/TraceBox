import { z } from "zod";

export const componentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a component name.")
    .max(80, "Keep the name under 80 characters."),
  description: z.string().trim().max(280, "Keep the description under 280 characters.").optional().or(z.literal("")),
  default_assignee_id: z.string().uuid().optional().or(z.literal("")),
});

export type ComponentValues = z.infer<typeof componentSchema>;

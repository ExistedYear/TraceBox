import { z } from "zod";

export const workspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(60, "Keep the name under 60 characters."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Enter at least 2 characters.")
    .max(60, "Keep the slug under 60 characters.")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single dashes."),
});

export const projectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(80, "Keep the name under 80 characters."),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "Use at least 2 characters.")
    .max(10, "Use at most 10 characters.")
    .regex(/^[A-Z][A-Z0-9]+$/, "Start with a letter, then letters or digits."),
  description: z.string().trim().max(280, "Keep the description under 280 characters.").optional().or(z.literal("")),
});

export type WorkspaceValues = z.infer<typeof workspaceSchema>;
export type ProjectValues = z.infer<typeof projectSchema>;

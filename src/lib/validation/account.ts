import { z } from "zod";

export const accountDisplayNameSchema = z.object({
  displayName: z.string().trim().min(2, "Use at least 2 characters.").max(120, "Keep your display name under 120 characters."),
});

export const accountEmailSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

export const accountPasswordSchema = z.object({
  password: z.string().min(8, "Use at least 8 characters.").max(72, "Keep your password under 72 characters."),
  confirmPassword: z.string().min(1, "Confirm your password."),
}).refine((values) => values.password === values.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
});

export type AccountDisplayNameValues = z.infer<typeof accountDisplayNameSchema>;
export type AccountEmailValues = z.infer<typeof accountEmailSchema>;
export type AccountPasswordValues = z.infer<typeof accountPasswordSchema>;

import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const signupSchema = z.object({
  displayName: z.string().trim().min(2, "Enter at least 2 characters.").max(120, "Keep your name under 120 characters."),
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters.").max(72, "Keep your password under 72 characters."),
  confirmPassword: z.string().min(1, "Confirm your password."),
}).refine((values) => values.password === values.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export const passwordRecoverySchema = z.object({ email: z.string().trim().email("Enter a valid email address.") });
export const passwordResetSchema = z.object({
  password: z.string().min(8, "Use at least 8 characters.").max(72, "Keep your password under 72 characters."),
  confirmPassword: z.string().min(1, "Confirm your password."),
}).refine((values) => values.password === values.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export type LoginValues = z.infer<typeof loginSchema>;
export type SignupValues = z.infer<typeof signupSchema>;
export type PasswordRecoveryValues = z.infer<typeof passwordRecoverySchema>;
export type PasswordResetValues = z.infer<typeof passwordResetSchema>;

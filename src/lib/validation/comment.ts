import { z } from "zod";

export const commentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Enter a comment.")
    .max(10000, "Keep it under 10,000 characters."),
});

export type CommentValues = z.infer<typeof commentSchema>;

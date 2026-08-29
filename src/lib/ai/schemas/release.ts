import { z } from "zod";

export const releaseBriefSchema = z.object({
  risk_level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  summary: z.string().min(1).max(600),
  primary_risks: z.array(
    z.object({
      issue_key: z.string().min(1).max(20),
      reason: z.string().min(1).max(300),
    }),
  ).max(5),
  recommendation: z.string().min(1).max(500),
});

export type ReleaseBrief = z.infer<typeof releaseBriefSchema>;

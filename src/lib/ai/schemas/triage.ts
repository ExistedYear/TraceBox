import { z } from "zod";

export const triageAnalysisSchema = z.object({
  component: z.object({
    component_id: z.string().uuid().nullable(),
    confidence: z.number().int().min(0).max(100),
    reason: z.string().min(1).max(500),
  }),
  severity: z.object({
    value: z.enum(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "TRIVIAL"]),
    confidence: z.number().int().min(0).max(100),
    reason: z.string().min(1).max(500),
  }),
  priority: z.object({
    value: z.enum(["P0", "P1", "P2", "P3", "P4"]),
    confidence: z.number().int().min(0).max(100),
    reason: z.string().min(1).max(500),
  }),
  assignee: z.object({
    user_id: z.string().uuid().nullable(),
    confidence: z.number().int().min(0).max(100),
    reason: z.string().min(1).max(500),
  }),
  regression: z.object({
    likelihood: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
    confidence: z.number().int().min(0).max(100),
    reason: z.string().min(1).max(500),
  }),
  follow_up_questions: z.array(
    z.object({
      question: z.string().min(1).max(280),
      reason: z.string().min(1).max(500),
    }),
  ).max(5),
  duplicate_analysis: z.array(
    z.object({
      issue_id: z.string().uuid(),
      likelihood: z.number().int().min(0).max(100),
      evidence: z.array(z.string().min(1).max(280)).max(6),
      differences: z.array(z.string().min(1).max(280)).max(6),
    }),
  ).max(3),
});

export type TriageAnalysis = z.infer<typeof triageAnalysisSchema>;

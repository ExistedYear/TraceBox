import { z } from "zod";
export const releaseBriefSchema = z.object({
  risk_level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), summary: z.string().min(1).max(600),
  primary_risks: z.array(z.object({ issue_key: z.string().min(1).max(40), reason: z.string().min(1).max(300) }).strict()).max(5),
  recommendation: z.string().min(1).max(500),
}).strict();
export type ReleaseBrief = z.infer<typeof releaseBriefSchema>;
export const RELEASE_JSON_SCHEMA = { type: "object", additionalProperties: false, required: ["risk_level","summary","primary_risks","recommendation"], properties: {
  risk_level: { type: "string", enum: ["LOW","MEDIUM","HIGH","CRITICAL"] }, summary: { type: "string" },
  primary_risks: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["issue_key","reason"], properties: { issue_key: { type: "string" }, reason: { type: "string" } } } }, recommendation: { type: "string" },
} } as const;

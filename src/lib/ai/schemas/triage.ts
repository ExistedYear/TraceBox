import { z } from "zod";
const recommendation = z.object({ confidence: z.number().int().min(0).max(100), reason: z.string().min(1).max(500) }).strict();
export const triageAnalysisSchema = z.object({
  component: recommendation.extend({ component_id: z.string().uuid().nullable() }),
  severity: recommendation.extend({ value: z.enum(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "TRIVIAL"]) }),
  priority: recommendation.extend({ value: z.enum(["P0", "P1", "P2", "P3", "P4"]) }),
  assignee: recommendation.extend({ user_id: z.string().uuid().nullable() }),
  regression: z.object({ likelihood: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]), confidence: z.number().int().min(0).max(100), reason: z.string().min(1).max(500) }).strict(),
  follow_up_questions: z.array(z.object({ question: z.string().min(1).max(280), reason: z.string().min(1).max(500) }).strict()).max(5),
  duplicate_analysis: z.array(z.object({ issue_id: z.string().uuid(), likelihood: z.number().int().min(0).max(100), evidence: z.array(z.string().min(1).max(280)).max(6), differences: z.array(z.string().min(1).max(280)).max(6) }).strict()).max(3),
}).strict();
export type TriageAnalysis = z.infer<typeof triageAnalysisSchema>;
export const TRIAGE_JSON_SCHEMA = { type: "object", additionalProperties: false, required: ["component","severity","priority","assignee","regression","follow_up_questions","duplicate_analysis"], properties: {
  component: { type: "object", additionalProperties: false, required: ["component_id","confidence","reason"], properties: { component_id: { type: ["string","null"] }, confidence: { type: "integer", minimum: 0, maximum: 100 }, reason: { type: "string" } } },
  severity: { type: "object", additionalProperties: false, required: ["value","confidence","reason"], properties: { value: { type: "string", enum: ["BLOCKER","CRITICAL","MAJOR","MINOR","TRIVIAL"] }, confidence: { type: "integer" }, reason: { type: "string" } } },
  priority: { type: "object", additionalProperties: false, required: ["value","confidence","reason"], properties: { value: { type: "string", enum: ["P0","P1","P2","P3","P4"] }, confidence: { type: "integer" }, reason: { type: "string" } } },
  assignee: { type: "object", additionalProperties: false, required: ["user_id","confidence","reason"], properties: { user_id: { type: ["string","null"] }, confidence: { type: "integer" }, reason: { type: "string" } } },
  regression: { type: "object", additionalProperties: false, required: ["likelihood","confidence","reason"], properties: { likelihood: { type: "string", enum: ["HIGH","MEDIUM","LOW","UNKNOWN"] }, confidence: { type: "integer" }, reason: { type: "string" } } },
  follow_up_questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["question","reason"], properties: { question: { type: "string" }, reason: { type: "string" } } }, maxItems: 5 },
  duplicate_analysis: { type: "array", items: { type: "object", additionalProperties: false, required: ["issue_id","likelihood","evidence","differences"], properties: { issue_id: { type: "string" }, likelihood: { type: "integer" }, evidence: { type: "array", items: { type: "string" } }, differences: { type: "array", items: { type: "string" } } } }, maxItems: 3 },
} } as const;

export type ReportQualityDetail = { key: string; label: string; points: number; earned: number; status: "present" | "partial" | "missing" };
export type ReportQuality = { score: number; present: string[]; missing: string[]; details: ReportQualityDetail[]; eligible: boolean; isRestricted: boolean };
export type IssueForQuality = { type?: string | null; visibility?: string | null; title?: string | null; description?: string | null; steps_to_reproduce?: string | null; expected_behavior?: string | null; actual_behavior?: string | null; environment?: string | null; affected_version_id?: string | null };
type Attachment = { filename?: string | null; mime_type?: string | null };
const allowedTypes = new Set(["BUG", "REGRESSION", "PERFORMANCE", "SECURITY"]);
function meaningful(value: string | null | undefined, min: number): boolean { const text = value?.trim() ?? ""; return text.length >= min && text.replace(/\s/g, "").length >= min; }
function steps(value: string | null | undefined): "present" | "partial" | "missing" { const text = value?.trim() ?? ""; if (text.length < 10) return "missing"; if (text.length >= 20 && (text.split("\n").filter(Boolean).length > 1 || /(^|\n)\s*(\d+[.)]|[-*])\s+|step|click|navigate|reproduce/i.test(text))) return "present"; return "partial"; }
function diagnostic(issue: IssueForQuality, attachments: Attachment[] | null | undefined): boolean {
  const text = [issue.description, issue.steps_to_reproduce, issue.expected_behavior, issue.actual_behavior, issue.environment].filter(Boolean).join("\n");
  if (/stack\s*trace|traceback|\b(exception|panic|fatal|failure|error):|at\s+[\w$.]+\s*\([^)]*:\d+/.test(text)) return true;
  if (/```[\s\S]*?```|`[^`]{20,}`/.test(text)) return true;
  return (attachments ?? []).some((a) => /text|log|json|har/i.test(a.mime_type ?? "") || /\.(log|txt|json|har)$/i.test(a.filename ?? ""));
}
function regression(issue: IssueForQuality): boolean { return /regression|worked in|last known good|previously worked|used to work|broke in v\d|since v\d/i.test([issue.title, issue.description, issue.steps_to_reproduce, issue.expected_behavior, issue.actual_behavior].filter(Boolean).join(" ")); }
export function calculateReportQuality(issue: IssueForQuality, attachments?: Attachment[] | null): ReportQuality {
  const restricted = issue.visibility === "RESTRICTED";
  const eligible = allowedTypes.has((issue.type ?? "BUG").toUpperCase());
  const details: ReportQualityDetail[] = [];
  const present: string[] = []; const missing: string[] = [];
  const add = (key: string, label: string, points: number, status: ReportQualityDetail["status"]) => { const earned = status === "present" ? points : status === "partial" ? Math.floor(points / 2) : 0; details.push({ key, label, points, earned, status }); if (status === "missing") missing.push(label); else present.push(status === "partial" ? `${label} (partial)` : label); };
  add("description", "Meaningful description", 10, meaningful(issue.description, 30) ? "present" : "missing");
  add("steps", "Steps to reproduce", 20, steps(issue.steps_to_reproduce));
  add("expected", "Expected behavior", 10, meaningful(issue.expected_behavior, 15) ? "present" : "missing");
  add("actual", "Actual behavior", 10, meaningful(issue.actual_behavior, 15) ? "present" : "missing");
  add("environment", "Environment", 15, meaningful(issue.environment, 10) ? "present" : "missing");
  add("version", "Affected version", 10, issue.affected_version_id ? "present" : "missing");
  add("diagnostic", "Diagnostic evidence / logs / stack", 15, diagnostic(issue, attachments) ? "present" : "missing");
  add("regression", "Regression / last-known-good evidence", 10, regression(issue) ? "present" : "missing");
  return { score: eligible ? details.reduce((sum, d) => sum + d.earned, 0) : 0, present: eligible ? present : [], missing: eligible ? missing : ["Issue type is not eligible"], details, eligible, isRestricted: restricted };
}

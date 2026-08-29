export type ReportQualityDetail = {
  key: string;
  label: string;
  points: number;
  earned: number;
  status: "present" | "partial" | "missing";
};

export type ReportQuality = {
  score: number;
  present: string[];
  missing: string[];
  details: ReportQualityDetail[];
  isRestricted?: boolean;
};

type IssueForQuality = {
  description?: string | null;
  steps_to_reproduce?: string | null;
  expected_behavior?: string | null;
  actual_behavior?: string | null;
  environment?: string | null;
  affected_version_id?: string | null;
  title?: string | null;
};

type AttachmentForQuality = {
  filename?: string | null;
  mime_type?: string | null;
  name?: string | null;
};

const DESCRIPTION_MIN = 30;

function hasMeaningfulText(value: string | null | undefined, min = DESCRIPTION_MIN): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < min) return false;
  const withoutWhitespace = trimmed.replace(/\s/g, "");
  return withoutWhitespace.length >= min;
}

function hasSteps(value: string | null | undefined): boolean {
  if (!value) return false;
  const raw = value.trim();
  if (raw.length < 20) return false;
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const numbered = raw.match(/(^\s*(\d+[\).]|[-*])\s+)/m);
  const keywords = /step|reproduce|open|click|go to|navigate/i.test(raw);
  return lines.length >= 2 || Boolean(numbered) || keywords;
}

function detectDiagnosticEvidence(issue: IssueForQuality, attachments?: AttachmentForQuality[] | null): boolean {
  const combined = [issue.description, issue.steps_to_reproduce, issue.expected_behavior, issue.actual_behavior, issue.environment].filter(Boolean).join("\n");
  if (!combined) {
    // check attachments anyway
  } else {
    const hasStackTrace = /(stack\s*trace|Traceback|at\s+[\w$.]+\s*\(.*:\d+:\d+\)|Exception|Error:\s+\w+|Caused by:)/i.test(combined);
    if (hasStackTrace) return true;
    const hasException = /\b(Exception|Error|Failed|Failure|panic|fatal)\b/i.test(combined) && combined.length > 50;
    const hasFencedBlock = /```[\s\S]*?```/.test(combined) || /`[^`]{20,}`/.test(combined);
    if (hasException && hasFencedBlock) return true;
    if (hasFencedBlock && combined.length > 200) {
      const logLike = /(error|warn|info|debug|exception)\s*[:\-]/i.test(combined);
      if (logLike) return true;
    }
    if (/```/.test(combined)) return true;
  }
  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      const name = (attachment.filename ?? attachment.name ?? "").toLowerCase();
      const mime = (attachment.mime_type ?? "").toLowerCase();
      if (mime.includes("text") || mime.includes("log") || mime.includes("json") || name.endsWith(".log") || name.endsWith(".txt") || name.endsWith(".json") || name.endsWith(".har")) {
        return true;
      }
    }
  }
  return false;
}

function detectRegressionEvidence(issue: IssueForQuality): boolean {
  const combined = [issue.title, issue.description, issue.steps_to_reproduce, issue.expected_behavior, issue.actual_behavior].filter(Boolean).join(" ").toLowerCase();
  if (!combined) return false;
  const patterns = [
    /regression/,
    /worked in/i,
    /last known good/i,
    /previously worked/i,
    /started after v\d/i,
    /since v\d/i,
    /broke in v\d/i,
    /used to work/i,
  ];
  return patterns.some((re) => re.test(combined));
}

export function calculateReportQuality(issue: IssueForQuality, attachments?: AttachmentForQuality[] | null): ReportQuality {
  const details: ReportQualityDetail[] = [];
  const present: string[] = [];
  const missing: string[] = [];

  function push(key: string, label: string, points: number, status: "present" | "partial" | "missing", earnedOverride?: number) {
    const earned = earnedOverride !== undefined ? earnedOverride : status === "present" ? points : status === "partial" ? Math.floor(points / 2) : 0;
    details.push({ key, label, points, earned, status });
    if (status === "present") present.push(label);
    else if (status === "missing") missing.push(label);
    else {
      present.push(`${label} (partial)`);
    }
  }

  const descOk = hasMeaningfulText(issue.description ?? null, 30);
  push("description", "Meaningful description", 10, descOk ? "present" : "missing");

  const stepsOk = hasSteps(issue.steps_to_reproduce ?? null);
  const stepsPartial = !stepsOk && Boolean(issue.steps_to_reproduce && issue.steps_to_reproduce.trim().length >= 10);
  push("steps", "Steps to reproduce", 20, stepsOk ? "present" : stepsPartial ? "partial" : "missing");

  const expectedOk = hasMeaningfulText(issue.expected_behavior ?? null, 15);
  push("expected", "Expected behavior", 10, expectedOk ? "present" : "missing");

  const actualOk = hasMeaningfulText(issue.actual_behavior ?? null, 15);
  push("actual", "Actual behavior", 10, actualOk ? "present" : "missing");

  const envOk = hasMeaningfulText(issue.environment ?? null, 10);
  push("environment", "Environment", 15, envOk ? "present" : "missing");

  const versionOk = Boolean(issue.affected_version_id);
  push("version", "Affected version", 10, versionOk ? "present" : "missing");

  const diagOk = detectDiagnosticEvidence(issue, attachments);
  const diagPartial = !diagOk && Boolean(issue.description && /```/.test(issue.description));
  push("diagnostic", "Diagnostic evidence / logs / stack", 15, diagOk ? "present" : diagPartial ? "partial" : "missing");

  const regOk = detectRegressionEvidence(issue);
  push("regression", "Regression / last-known-good evidence", 10, regOk ? "present" : "missing");

  const score = details.reduce((sum, detail) => sum + detail.earned, 0);
  const clamped = Math.max(0, Math.min(100, score));

  const validated = details.reduce((sum, detail) => sum + detail.points, 0);
  if (validated !== 100) {
    throw new Error(`Report quality total must be 100, got ${validated}`);
  }

  return { score: clamped, present, missing, details };
}

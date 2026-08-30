import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const aiPanel = read("src/components/intelligence/trace-ai-panel.tsx");
const triage = read("src/components/intelligence/triage-suggestion.tsx");
const duplicate = read("src/components/intelligence/duplicate-analysis.tsx");
const natural = read("src/components/intelligence/issues-with-natural-search.tsx");
const issueTable = read("src/components/issues/issue-table.tsx");
const release = read("src/components/intelligence/release-brief.tsx");
const blast = read("src/components/intelligence/blast-radius-graph.tsx");

describe("Trace Intelligence UI contracts", () => {
  it("keeps AI advisory actions explicit and failure-aware", () => {
    expect(aiPanel).toContain("Analyze issue");
    expect(aiPanel).toContain("AI_DISABLED_FOR_RESTRICTED_ISSUE");
    expect(aiPanel).toContain("AI_PROVIDER_ERROR");
    expect(aiPanel).toContain("Nothing is sent until you choose Analyze");
    expect(aiPanel).not.toContain("useEffect");
  });

  it("applies selected triage fields through one optimistic request", () => {
    expect(triage).toContain("/api/intelligence/triage/apply");
    expect(triage).toContain("expectedUpdatedAt");
    expect(triage).toContain("response.status === 409");
    expect(triage).not.toContain("assign_issue");
    expect(triage).not.toContain("update_issue_fields");
  });

  it("offers a real comparison dialog and preserves trusted duplicate callback", () => {
    expect(duplicate).toContain("DialogContent");
    expect(duplicate).toContain("Current issue");
    expect(duplicate).toContain("Candidate issue");
    expect(duplicate).toContain("onMarkDuplicate");
  });

  it("keeps natural search chips editable and issue-table backed", () => {
    expect(natural).toContain("NaturalSearch");
    expect(natural).toContain("IssueTable");
    expect(natural).toContain("params.set(key, value)");
    expect(natural).toContain("params.delete(key)");
    expect(issueTable).toContain("setFilters(initialFilters)");
    expect(issueTable).toContain("setSearchQuery(initialSearchQuery)");
  });

  it("does not auto-generate release or graph analysis", () => {
    expect(release).toContain("Generate brief");
    expect(release).toContain("Nothing is sent until you choose Generate");
    expect(release).not.toContain("useEffect");
    expect(blast).toContain("Analyze impact");
    expect(blast).toContain("Retry");
    expect(blast).toContain("/dashboard/issues/${node.keyLabel}");
  });
});

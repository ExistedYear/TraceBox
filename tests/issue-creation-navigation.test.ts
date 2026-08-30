import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const form = readFileSync(new URL("../src/components/issues/new-issue-form.tsx", import.meta.url), "utf8");

describe("issue creation navigation contract", () => {
  it("clears the draft guard and navigates to the created issue", () => {
    expect(form).toContain("form.reset();");
    expect(form).toContain("setIsNavigating(true);");
    expect(form).toContain("router.replace(issueHref);");
    expect(form).not.toContain("router.push(`/dashboard/issues/${formatIssueKey(projectKey, Number(issueNumber.data))}`);");
    expect(form).not.toContain("router.refresh();");
  });

  it("keeps the created issue recoverable from the success toast", () => {
    expect(form).toContain('action: { label: "Open issue", onClick: () => router.replace(issueHref) }');
    expect(form).toContain("Opening issue…");
  });
});

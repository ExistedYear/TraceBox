import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("query-backed route failure contracts", () => {
  it("renders safe retry states instead of treating query failures as empty data", () => {
    for (const path of [
      "src/app/(dashboard)/dashboard/page.tsx",
      "src/app/(dashboard)/dashboard/reports/page.tsx",
      "src/app/(dashboard)/dashboard/readiness/page.tsx",
      "src/app/(dashboard)/dashboard/triage/page.tsx",
      "src/app/(dashboard)/dashboard/milestones/[milestoneId]/page.tsx",
      "src/app/(dashboard)/dashboard/settings/integrations/page.tsx",
      "src/app/(dashboard)/dashboard/settings/members/page.tsx",
      "src/app/(dashboard)/dashboard/settings/contributors/page.tsx",
    ]) {
      const source = read(path);
      expect(source).toMatch(/console\.error\("[^"]+", \{ code: .*message:/);
      expect(source).toMatch(/retryHref|Retry/);
    }
  });

  it("renders a safe retry shell when shared workspace context fails", () => {
    const source = read("src/app/(dashboard)/layout.tsx");
    expect(source).toContain("WorkspaceContextLoadError");
    expect(source).toContain("Workspace unavailable");
    expect(source).toContain("Retry");
  });

  it("does not report an empty release queue as ready", () => {
    const source = read("src/components/readiness/readiness-dashboard.tsx");
    expect(source).toContain('"NO_DATA"');
    expect(source).toContain("No Release Data");
    expect(source).toContain("No release data");
  });
});

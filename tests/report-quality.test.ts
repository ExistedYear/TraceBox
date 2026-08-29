import { describe, expect, it } from "vitest";

import { calculateReportQuality } from "@/features/intelligence/report-quality";

describe("calculateReportQuality", () => {
  it("scores empty report very low and totals 100", () => {
    const quality = calculateReportQuality({ description: "", steps_to_reproduce: null, expected_behavior: null, actual_behavior: null, environment: null, affected_version_id: null, title: "" });
    expect(quality.score).toBeGreaterThanOrEqual(0);
    expect(quality.score).toBeLessThan(20);
    expect(quality.details.reduce((sum, detail) => sum + detail.points, 0)).toBe(100);
    expect(quality.details.reduce((sum, detail) => sum + detail.earned, 0)).toBe(quality.score);
  });

  it("scores perfect report at 100", () => {
    const quality = calculateReportQuality(
      {
        title: "Regression: session refresh loop after v2.8 — worked in v2.7",
        description: "After upgrading to v2.8, every session refresh triggers an infinite login loop. Regression: worked in v2.7. Stack trace:\n```\nException: AuthLoop at session.refresh\n```",
        steps_to_reproduce: "1. Login on Chrome 124\n2. Leave tab open for 10 minutes\n3. Refresh page\n4. Observe login loop",
        expected_behavior: "User should remain authenticated after session refresh and be redirected to dashboard.",
        actual_behavior: "User is redirected indefinitely between login and dashboard, never completing authentication.",
        environment: "Chrome 124, macOS 14, v2.8",
        affected_version_id: "00000000-0000-4000-a000-000000000001",
      },
      [{ filename: "error.log", mime_type: "text/plain" }],
    );
    expect(quality.score).toBe(100);
    expect(quality.missing.length).toBe(0);
    expect(quality.present.length).toBeGreaterThan(0);
  });

  it("scores only description partially", () => {
    const quality = calculateReportQuality({ description: "This is a meaningful description that is definitely longer than thirty characters and explains the issue." });
    expect(quality.score).toBe(10);
    expect(quality.details.find((detail) => detail.key === "description")?.earned).toBe(10);
    expect(quality.details.find((detail) => detail.key === "steps")?.earned).toBe(0);
  });

  it("penalizes missing environment", () => {
    const quality = calculateReportQuality({
      description: "A".repeat(40),
      steps_to_reproduce: "1. Do step one\n2. Do step two\n3. Observe failure",
      expected_behavior: "Should load correctly",
      actual_behavior: "Crashes with error",
      environment: null,
      affected_version_id: "00000000-0000-4000-a000-000000000001",
    });
    const env = quality.details.find((detail) => detail.key === "environment");
    expect(env?.status).toBe("missing");
    expect(env?.earned).toBe(0);
  });

  it("penalizes missing affected version", () => {
    const quality = calculateReportQuality({
      description: "A".repeat(40),
      steps_to_reproduce: "1. Open app\n2. Click save\n3. See error",
      expected_behavior: "Save should succeed",
      actual_behavior: "Save fails with exception",
      environment: "Chrome 124",
      affected_version_id: null,
    });
    const version = quality.details.find((detail) => detail.key === "version");
    expect(version?.status).toBe("missing");
  });

  it("awards partial for minimal reproduction data", () => {
    const quality = calculateReportQuality({ steps_to_reproduce: "click save" });
    const steps = quality.details.find((detail) => detail.key === "steps");
    expect(steps?.status).toBe("partial");
    expect(steps?.earned).toBe(10);
  });

  it("detects stack-trace-like diagnostic evidence", () => {
    const quality = calculateReportQuality({
      description: "Crashes with:\n```\nException: NullPointer at com.example.App:42\nStack trace:\n at com.example.Module.run(Module.java:123)\n```\n",
    });
    const diag = quality.details.find((detail) => detail.key === "diagnostic");
    expect(diag?.status).toBe("present");
    expect(diag?.earned).toBe(15);
  });

  it("detects log attachment evidence", () => {
    const quality = calculateReportQuality({ description: "A".repeat(40) }, [{ filename: "app.log", mime_type: "text/plain" }]);
    const diag = quality.details.find((detail) => detail.key === "diagnostic");
    expect(diag?.status).toBe("present");
  });

  it("detects regression evidence", () => {
    const withRegression = calculateReportQuality({ title: "Regression: login worked in v2.7 but broke in v2.8", description: "This worked in v2.7 but now fails" });
    const reg = withRegression.details.find((detail) => detail.key === "regression");
    expect(reg?.status).toBe("present");
    expect(reg?.earned).toBe(10);

    const withoutRegression = calculateReportQuality({ title: "New bug in checkout", description: "Checkout fails" });
    const reg2 = withoutRegression.details.find((detail) => detail.key === "regression");
    expect(reg2?.status).toBe("missing");
  });

  it("never scores below 0 or above 100", () => {
    const cases = [
      { description: null },
      { description: "A".repeat(10000), steps_to_reproduce: "1. a\n2. b\n3. c\n4. d", expected_behavior: "x".repeat(20), actual_behavior: "y".repeat(20), environment: "env", affected_version_id: "00000000-0000-4000-a000-000000000001" },
      { description: "short" },
    ];
    for (const issue of cases) {
      const quality = calculateReportQuality(issue as never);
      expect(quality.score).toBeGreaterThanOrEqual(0);
      expect(quality.score).toBeLessThanOrEqual(100);
    }
  });

  it("total is exactly 100 regardless of input", () => {
    const quality = calculateReportQuality({ description: "A".repeat(50) });
    const total = quality.details.reduce((sum, detail) => sum + detail.points, 0);
    expect(total).toBe(100);
  });
});

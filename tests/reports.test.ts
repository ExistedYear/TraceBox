import { describe, expect, it } from "vitest";

import { normalizeReportMetrics, reportMetricsCsv } from "@/lib/reports";

describe("report metric helpers", () => {
  it("normalizes an empty backend result without inventing metrics", () => {
    const metrics = normalizeReportMetrics({ no_data: true, visible_count: 0, historical_trend: [] });
    expect(metrics.no_data).toBe(true);
    expect(metrics.created).toBe(0);
    expect(metrics.drilldown).toEqual([]);
  });

  it("exports escaped drilldown rows as CSV", () => {
    const metrics = normalizeReportMetrics({
      window_days: 7,
      drilldowns: { created: [{ id: "1", issue_number: 4, title: 'A "quoted", issue', created_at: "2026-08-29T00:00:00Z" }] },
    });
    expect(reportMetricsCsv("TB", metrics)).toContain('TB-4,4,"A ""quoted"", issue"');
  });
});

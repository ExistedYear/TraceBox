import { describe, expect, it } from "vitest";

import { formatCompactDateTime, formatDate, formatDateTime, formatShortDate, formatTime } from "@/lib/date-format";

describe("deterministic date formatting", () => {
  const value = "2026-08-30T23:15:00.000Z";

  it("uses an explicit locale and UTC time zone", () => {
    expect(formatDateTime(value)).toBe("Aug 30, 2026, 11:15 PM");
    expect(formatDate(value)).toBe("Aug 30, 2026");
    expect(formatShortDate(value)).toBe("Aug 30");
    expect(formatTime(value)).toBe("11:15 PM");
    expect(formatCompactDateTime(value)).toBe("8/30/26, 11:15 PM");
  });

  it("returns a safe placeholder for malformed values", () => {
    expect(formatDateTime("not-a-date")).toBe("—");
  });
});

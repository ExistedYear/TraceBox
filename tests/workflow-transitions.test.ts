import { describe, expect, it } from "vitest";

import { eventSummary, RESOLUTIONS } from "../src/lib/issues";

describe("Phase 6: Resolutions and Transitions", () => {
  it("contains all standard Bugzilla resolutions", () => {
    expect(RESOLUTIONS).toContain("FIXED");
    expect(RESOLUTIONS).toContain("DUPLICATE");
    expect(RESOLUTIONS).toContain("WONT_FIX");
    expect(RESOLUTIONS).toContain("INVALID");
    expect(RESOLUTIONS).toContain("CANNOT_REPRODUCE");
    expect(RESOLUTIONS).toContain("WORKS_AS_EXPECTED");
    expect(RESOLUTIONS.length).toBe(6);
  });

  it("formats resolution audit events accurately", () => {
    const event = {
      event_type: "RESOLUTION_CHANGED",
      field_name: "resolution",
      old_value: null,
      new_value: "FIXED",
    };
    const summary = eventSummary(event);
    expect(summary.heading).toBe("set resolution");
    expect(summary.detail).toBe("FIXED");
  });

  it("formats status change audit events with category and resolution metadata", () => {
    const event = {
      event_type: "STATUS_CHANGED",
      field_name: "status_id",
      old_value: "s-in-progress",
      new_value: "s-resolved",
      metadata: {
        new_category: "RESOLVED",
        resolution: "FIXED",
      },
    };
    const summary = eventSummary(event);
    expect(summary.heading).toBe("changed status");
    expect(summary.detail).toBe("s-in-progress → s-resolved");
  });

  it("formats assignee changed audit events", () => {
    const event = {
      event_type: "ASSIGNEE_CHANGED",
      field_name: "assignee_id",
      old_value: null,
      new_value: "user-123",
    };
    const summary = eventSummary(event);
    expect(summary.heading).toBe("changed assignee");
    expect(summary.detail).toBe("— → user-123");
  });

  it("validates role hierarchy permissions for transitions", () => {
    function isTransitionAllowed(userRole: string, requiredRole: string | null): boolean {
      if (userRole === "MAINTAINER") return true;
      if (!requiredRole) return true;
      if (requiredRole === "VIEWER") return true;
      if (requiredRole === userRole) return true;
      if (requiredRole === "REPORTER" && (userRole === "DEVELOPER" || userRole === "MAINTAINER")) return true;
      if (requiredRole === "DEVELOPER" && userRole === "MAINTAINER") return true;
      return false;
    }

    // VIEWER transition allowed for all active roles
    expect(isTransitionAllowed("REPORTER", "VIEWER")).toBe(true);
    expect(isTransitionAllowed("DEVELOPER", "VIEWER")).toBe(true);
    expect(isTransitionAllowed("MAINTAINER", "VIEWER")).toBe(true);

    // REPORTER transition allowed for Reporter, Developer, Maintainer
    expect(isTransitionAllowed("REPORTER", "REPORTER")).toBe(true);
    expect(isTransitionAllowed("DEVELOPER", "REPORTER")).toBe(true);

    // DEVELOPER transition rejected for Reporter, allowed for Developer & Maintainer
    expect(isTransitionAllowed("REPORTER", "DEVELOPER")).toBe(false);
    expect(isTransitionAllowed("DEVELOPER", "DEVELOPER")).toBe(true);
    expect(isTransitionAllowed("MAINTAINER", "DEVELOPER")).toBe(true);
  });
});

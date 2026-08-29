import { describe, expect, it } from "vitest";

import { getBlastRadius } from "@/features/intelligence/blast-radius";

describe("getBlastRadius", () => {
  it("single blocking edge", () => {
    const links = [{ id: "l1", source_issue_id: "A", target_issue_id: "B", relationship: "BLOCKS" }];
    const meta = new Map([
      ["A", { componentName: "Auth", milestoneId: "M1" }],
      ["B", { componentName: "Checkout", milestoneId: "M1" }],
    ]);
    const result = getBlastRadius("A", links, meta, new Set(["A", "B"]));
    expect(result.directBlocked).toBe(1);
    expect(result.transitiveBlocked).toBe(1);
    expect(result.affectedComponents).toBe(2);
  });

  it("multi-level chain", () => {
    const links = [
      { id: "l1", source_issue_id: "A", target_issue_id: "B", relationship: "BLOCKS" },
      { id: "l2", source_issue_id: "B", target_issue_id: "C", relationship: "BLOCKS" },
    ];
    const meta = new Map([
      ["A", {}],
      ["B", {}],
      ["C", {}],
    ]);
    const result = getBlastRadius("A", links, meta, new Set(["A", "B", "C"]));
    expect(result.transitiveBlocked).toBe(2);
    expect(result.directBlocked).toBe(1);
    expect(result.nodes.length).toBe(3);
  });

  it("diamond dependency graph", () => {
    const links = [
      { id: "l1", source_issue_id: "A", target_issue_id: "B", relationship: "BLOCKS" },
      { id: "l2", source_issue_id: "A", target_issue_id: "C", relationship: "BLOCKS" },
      { id: "l3", source_issue_id: "B", target_issue_id: "D", relationship: "BLOCKS" },
      { id: "l4", source_issue_id: "C", target_issue_id: "D", relationship: "BLOCKS" },
    ];
    const meta = new Map([["A", {}], ["B", {}], ["C", {}], ["D", {}]]);
    const result = getBlastRadius("A", links, meta, new Set(["A", "B", "C", "D"]));
    expect(result.transitiveBlocked).toBe(3);
    expect(result.nodes.find((node) => node.id === "D")?.depth).toBe(2);
  });

  it("cycle is safe", () => {
    const links = [
      { id: "l1", source_issue_id: "A", target_issue_id: "B", relationship: "BLOCKS" },
      { id: "l2", source_issue_id: "B", target_issue_id: "A", relationship: "BLOCKS" },
    ];
    const meta = new Map([["A", {}], ["B", {}]]);
    const result = getBlastRadius("A", links, meta, new Set(["A", "B"]));
    expect(result.transitiveBlocked).toBe(1);
    expect(result.nodes.length).toBe(2);
  });

  it("duplicate relationship ignored for impact count", () => {
    const links = [{ id: "l1", source_issue_id: "A", target_issue_id: "B", relationship: "DUPLICATE_OF" }];
    const result = getBlastRadius("A", links, new Map([["A", {}], ["B", {}]]), new Set(["A", "B"]));
    expect(result.transitiveBlocked).toBe(0);
    expect(result.directBlocked).toBe(0);
  });

  it("related relationship ignored", () => {
    const links = [{ id: "l1", source_issue_id: "A", target_issue_id: "B", relationship: "RELATES_TO" }];
    const result = getBlastRadius("A", links, new Map([["A", {}], ["B", {}]]), new Set(["A", "B"]));
    expect(result.transitiveBlocked).toBe(0);
  });

  it("permission-filtered node omitted", () => {
    const links = [
      { id: "l1", source_issue_id: "A", target_issue_id: "B", relationship: "BLOCKS" },
      { id: "l2", source_issue_id: "B", target_issue_id: "C", relationship: "BLOCKS" },
    ];
    const meta = new Map([["A", {}], ["B", {}], ["C", {}]]);
    const result = getBlastRadius("A", links, meta, new Set(["A", "B"]));
    expect(result.transitiveBlocked).toBe(1);
    expect(result.nodes.some((node) => node.id === "C")).toBe(false);
  });

  it("DEPENDS_ON is treated as reverse BLOCKS", () => {
    const links = [{ id: "l1", source_issue_id: "B", target_issue_id: "A", relationship: "DEPENDS_ON" }];
    const result = getBlastRadius("A", links, new Map([["A", {}], ["B", {}]]), new Set(["A", "B"]));
    expect(result.transitiveBlocked).toBe(1);
    expect(result.directBlocked).toBe(1);
  });
});

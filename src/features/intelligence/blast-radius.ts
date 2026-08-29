export type IssueLinkEdge = {
  id: string;
  source_issue_id: string;
  target_issue_id: string;
  relationship: string;
};

export type BlastRadiusNode = {
  id: string;
  issueNumber?: number;
  keyLabel?: string;
  title?: string;
  componentName?: string | null;
  milestoneId?: string | null;
  severity?: string | null;
  priority?: string | null;
  depth: number;
};

export type BlastRadiusResult = {
  nodes: BlastRadiusNode[];
  edges: Array<{ from: string; to: string; relationship: string }>;
  directBlocked: number;
  transitiveBlocked: number;
  affectedComponents: number;
  affectedMilestones: number;
  criticalIssues: number;
};

const BLOCKING_RELATIONSHIPS = new Set(["BLOCKS", "DEPENDS_ON"]);

function impactEdge(link: IssueLinkEdge): { from: string; to: string } | null {
  if (link.relationship === "BLOCKS") return { from: link.source_issue_id, to: link.target_issue_id };
  if (link.relationship === "DEPENDS_ON") return { from: link.target_issue_id, to: link.source_issue_id };
  return null;
}

export function getBlastRadius(
  rootId: string,
  allLinks: IssueLinkEdge[],
  issueMeta: Map<string, { componentName?: string | null; milestoneId?: string | null; severity?: string | null; priority?: string | null; keyLabel?: string; title?: string; issueNumber?: number }>,
  visibleIds: Set<string>,
  maxDepth = 5,
): BlastRadiusResult {
  const allowedLinks = allLinks.filter((link) => visibleIds.has(link.source_issue_id) && visibleIds.has(link.target_issue_id));
  const adjacency = new Map<string, Array<{ to: string; relationship: string }>>();
  for (const link of allowedLinks) {
    const edge = impactEdge(link);
    if (!edge) continue;
    const list = adjacency.get(edge.from) ?? [];
    list.push({ to: edge.to, relationship: link.relationship });
    adjacency.set(edge.from, list);
  }

  const visited = new Set<string>([rootId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  const nodes: BlastRadiusNode[] = [];
  const edges: Array<{ from: string; to: string; relationship: string }> = [];
  const foundComponents = new Set<string>();
  const foundMilestones = new Set<string>();

  const rootMeta = issueMeta.get(rootId);
  nodes.push({ id: rootId, depth: 0, ...rootMeta });
  if (rootMeta?.componentName) foundComponents.add(rootMeta.componentName);
  if (rootMeta?.milestoneId) foundMilestones.add(rootMeta.milestoneId);

  let directBlocked = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current.depth >= maxDepth) continue;
    const neighbors = adjacency.get(current.id) ?? [];
    for (const neighbor of neighbors) {
      edges.push({ from: current.id, to: neighbor.to, relationship: neighbor.relationship });
      if (current.id === rootId) directBlocked += 1;
      if (visited.has(neighbor.to)) continue;
      visited.add(neighbor.to);
      const meta = issueMeta.get(neighbor.to);
      nodes.push({ id: neighbor.to, depth: current.depth + 1, ...meta });
      if (meta?.componentName) foundComponents.add(meta.componentName);
      if (meta?.milestoneId) foundMilestones.add(meta.milestoneId);
      queue.push({ id: neighbor.to, depth: current.depth + 1 });
    }
  }

  const transitiveBlocked = Math.max(0, visited.size - 1);
  let criticalIssues = 0;
  for (const nodeId of visited) {
    if (nodeId === rootId) continue;
    const meta = issueMeta.get(nodeId);
    if (meta && (meta.severity === "BLOCKER" || meta.severity === "CRITICAL" || meta.priority === "P0")) criticalIssues += 1;
  }

  return {
    nodes,
    edges,
    directBlocked,
    transitiveBlocked,
    affectedComponents: foundComponents.size,
    affectedMilestones: foundMilestones.size,
    criticalIssues,
  };
}

import type { Priority, Status } from "@/components/tracebox/primitives";

export type Issue = {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  assignee: string;
  team: string;
  labels: string[];
  updated: string;
  project: string;
};

// Presentation-only fixtures keep the review UI visible without replacing Supabase data.
export const issues: Issue[] = [
  { id: "TRC-142", title: "Keep filters when opening issue detail", status: "in-progress", priority: "high", assignee: "Maya Chen", team: "Platform", labels: ["workflow", "frontend"], updated: "12m ago", project: "TraceBox web" },
  { id: "TRC-141", title: "Expose release health in the workspace overview", status: "open", priority: "medium", assignee: "Noah Williams", team: "Platform", labels: ["release", "dashboard"], updated: "38m ago", project: "TraceBox web" },
  { id: "TRC-139", title: "Add keyboard shortcut hint to command palette", status: "planned", priority: "medium", assignee: "Priya Shah", team: "Systems", labels: ["accessibility", "interaction"], updated: "1h ago", project: "TraceBox web" },
  { id: "TRC-136", title: "Mobile navigation overlaps activity timeline", status: "blocked", priority: "urgent", assignee: "Sam Rivera", team: "Web", labels: ["mobile", "bug"], updated: "2h ago", project: "TraceBox web" },
  { id: "TRC-133", title: "Add empty state for collaborators without access", status: "resolved", priority: "low", assignee: "Maya Chen", team: "Platform", labels: ["collaborators"], updated: "3h ago", project: "TraceBox web" },
  { id: "TRC-128", title: "Show branch metadata on issue activity", status: "open", priority: "high", assignee: "Alex Kim", team: "Systems", labels: ["git", "activity"], updated: "Yesterday", project: "TraceBox web" },
];

export const teamMembers = [
  { name: "Maya Chen", role: "Maintainer", team: "Platform", activity: "Updated TRC-142", tone: "blue" as const },
  { name: "Noah Williams", role: "Member", team: "Platform", activity: "Opened a release", tone: "green" as const },
  { name: "Priya Shah", role: "Member", team: "Systems", activity: "Reviewed 3 issues", tone: "violet" as const },
  { name: "Sam Rivera", role: "Member", team: "Web", activity: "Blocked on TRC-136", tone: "amber" as const },
];

export const collaborators = [
  { name: "Maya Chen", email: "maya@tracebox.dev", role: "Admin", access: "All projects", lastSeen: "Now", tone: "blue" as const },
  { name: "Noah Williams", email: "noah@tracebox.dev", role: "Member", access: "Platform", lastSeen: "12m ago", tone: "green" as const },
  { name: "Priya Shah", email: "priya@tracebox.dev", role: "Member", access: "Systems", lastSeen: "1h ago", tone: "violet" as const },
  { name: "Sam Rivera", email: "sam@tracebox.dev", role: "Viewer", access: "Web", lastSeen: "Yesterday", tone: "amber" as const },
];

export const projects = [
  { name: "TraceBox web", key: "TBX", issues: 38, resolved: "72%", branch: "main", health: "on track" },
  { name: "Ingestion service", key: "ING", issues: 14, resolved: "86%", branch: "main", health: "on track" },
  { name: "CLI tooling", key: "CLI", issues: 9, resolved: "54%", branch: "next", health: "needs review" },
];

export const releases = [
  { name: "v0.4.0 · Command center", status: "In progress", progress: 78, due: "Sep 04", risk: "Low" },
  { name: "v0.3.2 · Auth hardening", status: "Released", progress: 100, due: "Aug 22", risk: "None" },
  { name: "v0.5.0 · Issue workflow", status: "Planning", progress: 24, due: "Sep 25", risk: "Medium" },
];

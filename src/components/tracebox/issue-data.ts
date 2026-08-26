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

export const releases = [
  { name: "v0.4.0 · Command center", status: "In progress", progress: 78, due: "Sep 04", risk: "Low" },
  { name: "v0.3.2 · Auth hardening", status: "Released", progress: 100, due: "Aug 22", risk: "None" },
  { name: "v0.5.0 · Issue workflow", status: "Planning", progress: 24, due: "Sep 25", risk: "Medium" },
];

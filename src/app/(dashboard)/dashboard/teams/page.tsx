import type { Metadata } from "next";

import { WorkspaceSectionPage } from "@/components/tracebox/workspace-section";

export const metadata: Metadata = { title: "Teams" };

export default function TeamsPage() {
  return <WorkspaceSectionPage section="teams" />;
}

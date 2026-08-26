import type { Metadata } from "next";

import { WorkspaceSectionPage } from "@/components/tracebox/workspace-section";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return <WorkspaceSectionPage section="projects" />;
}

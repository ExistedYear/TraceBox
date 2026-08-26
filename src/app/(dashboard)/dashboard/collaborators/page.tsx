import type { Metadata } from "next";

import { WorkspaceSectionPage } from "@/components/tracebox/workspace-section";

export const metadata: Metadata = { title: "Collaborators" };

export default function CollaboratorsPage() {
  return <WorkspaceSectionPage section="collaborators" />;
}

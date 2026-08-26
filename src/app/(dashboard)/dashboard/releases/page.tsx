import type { Metadata } from "next";

import { WorkspaceSectionPage } from "@/components/tracebox/workspace-section";

export const metadata: Metadata = { title: "Releases" };

export default function ReleasesPage() {
  return <WorkspaceSectionPage section="releases" />;
}

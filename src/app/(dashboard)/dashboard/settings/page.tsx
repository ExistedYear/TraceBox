import type { Metadata } from "next";

import { WorkspaceSectionPage } from "@/components/tracebox/workspace-section";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <WorkspaceSectionPage section="settings" />;
}

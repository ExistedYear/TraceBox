import { DashboardOverview } from "@/components/tracebox/dashboard-overview";
import { getWorkspaceContext } from "@/lib/workspace-context";

export default async function DashboardPage() {
  const context = await getWorkspaceContext();
  const displayName = context.profile?.display_name || context.email.split("@")[0] || "there";

  return <DashboardOverview displayName={displayName} email={context.email} />;
}

import type { Metadata } from "next";

import { AccountManagement } from "@/components/account/account-management";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Account settings" };

export default async function AccountPage() {
  const context = await getWorkspaceContext();
  return <AccountManagement userId={context.userId} email={context.email} displayName={context.profile?.display_name} avatarUrl={context.profile?.avatar_url} />;
}

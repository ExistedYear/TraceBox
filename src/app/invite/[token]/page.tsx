import type { Metadata } from "next";

import { InvitationAcceptance } from "@/components/settings/invitation-acceptance";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Workspace invitation" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: { user } } = await (await createClient()).auth.getUser();
  return <main className="flex min-h-screen items-center justify-center bg-background p-4"><InvitationAcceptance token={token} authenticated={Boolean(user)} /></main>;
}

import type { Metadata } from "next";

import { InvitationAcceptance } from "@/components/settings/invitation-acceptance";
import { LoadErrorPage } from "@/components/tracebox/load-error";
import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Workspace invitation" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: { user }, error } = await (await createClient()).auth.getUser();
  if (error && !isMissingAuthSession(error)) {
    console.error("Invitation authentication lookup failed", { code: error.code, message: error.message });
    return <LoadErrorPage title="Invitation unavailable" description="We could not verify your session. The invitation was not accepted or changed." retryHref={`/invite/${encodeURIComponent(token)}`} />;
  }
  return <main className="flex min-h-screen items-center justify-center bg-background p-4"><InvitationAcceptance token={token} authenticated={Boolean(user)} /></main>;
}

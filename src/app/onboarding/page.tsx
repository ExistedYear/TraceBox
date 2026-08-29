import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { LoadErrorPage } from "@/components/tracebox/load-error";
import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ create?: string }> }) {
  const { create } = await searchParams;
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError && !isMissingAuthSession(userError)) {
    console.error("Onboarding authentication lookup failed", { code: userError.code, message: userError.message });
    return <LoadErrorPage title="Onboarding unavailable" description="We could not verify your session. No workspace was created." retryHref="/onboarding" />;
  }
  if (!user) redirect("/login?next=/onboarding");

  const { data: memberships, error: membershipsError } = await supabase.from("organization_members").select("organization_id").eq("user_id", user.id);
  if (membershipsError) {
    console.error("Onboarding membership lookup failed", { code: membershipsError.code, message: membershipsError.message });
    return <LoadErrorPage title="Onboarding unavailable" description="We could not verify your existing workspaces. No duplicate workspace was created." retryHref="/onboarding" />;
  }
  if ((memberships?.length ?? 0) > 0 && !create) redirect("/dashboard");

  return <OnboardingFlow />;
}

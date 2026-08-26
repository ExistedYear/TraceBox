import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ create?: string }> }) {
  const { create } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");

  const { data: memberships } = await supabase.from("organization_members").select("organization_id");
  if ((memberships?.length ?? 0) > 0 && !create) redirect("/dashboard");

  return <OnboardingFlow />;
}

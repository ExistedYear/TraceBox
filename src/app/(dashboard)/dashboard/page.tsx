import { redirect } from "next/navigation";
import { DashboardOverview } from "@/components/tracebox/dashboard-overview";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle();
  if (profileError) console.error("Failed to load the current user's profile", { code: profileError.code, message: profileError.message });

  const displayName = profile?.display_name || user.user_metadata?.display_name || user.email?.split("@")[0] || "there";

  return <DashboardOverview displayName={displayName} />;
}

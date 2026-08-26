import { redirect } from "next/navigation";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle();

  return <div className="flex min-h-screen bg-background"><AppSidebar /><div className="flex min-w-0 flex-1 flex-col"><AppHeader email={user.email ?? ""} displayName={profile?.display_name} avatarUrl={profile?.avatar_url} /><div className="flex-1">{children}</div></div></div>;
}

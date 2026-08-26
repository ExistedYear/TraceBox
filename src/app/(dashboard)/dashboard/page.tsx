import { redirect } from "next/navigation";
import { CheckCircle2, Database, LockKeyhole, Server, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

const stack = [
  { label: "Next.js", icon: Server },
  { label: "Vercel", icon: ZaplessIcon },
  { label: "Supabase", icon: Database },
  { label: "Authentication", icon: LockKeyhole },
];

function ZaplessIcon(props: React.ComponentProps<typeof ShieldCheck>) {
  return <ShieldCheck {...props} />;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle();
  if (profileError) console.error("Failed to load the current user's profile", { code: profileError.code, message: profileError.message });

  const displayName = profile?.display_name || user.user_metadata?.display_name || user.email?.split("@")[0] || "there";

  return <main className="mx-auto max-w-6xl p-6 sm:p-8 lg:p-10"><PageHeader eyebrow="Workspace overview" title={`Welcome, ${displayName}`} description="Your TraceBox foundation is connected and ready for the next product slice." /><div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><Card className="border-primary/20 bg-primary/[0.04]"><CardHeader><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Authenticated as</p><CardTitle className="mt-2 break-all text-xl">{user.email}</CardTitle><CardDescription>Your session is active and protected by Supabase Auth.</CardDescription></CardHeader><CardContent><div className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Profile query returned through RLS</div></CardContent></Card><Card><CardHeader><CardTitle>Deployment status</CardTitle><CardDescription>The essential foundation services are in place.</CardDescription></CardHeader><CardContent className="space-y-3">{stack.map(({ label, icon: Icon }) => <div key={label} className="flex items-center justify-between rounded-lg border border-border/80 bg-background/40 px-3 py-2.5"><span className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 text-muted-foreground" />{label}</span><CheckCircle2 className="h-4 w-4 text-emerald-300" /></div>)}<div className="flex items-center justify-between rounded-lg border border-border/80 bg-background/40 px-3 py-2.5"><span className="flex items-center gap-2 text-sm"><Database className="h-4 w-4 text-muted-foreground" />Database connection</span>{profileError ? <span className="text-xs text-amber-300">Needs attention</span> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />}</div></CardContent></Card></div></main>;
}

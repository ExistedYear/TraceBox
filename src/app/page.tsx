import Link from "next/link";
import { ArrowRight, CheckCircle2, Github, Layers3, ShieldCheck, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";

const highlights = [
  { icon: ShieldCheck, label: "Secure by default", detail: "Supabase Auth and RLS from the first migration." },
  { icon: Zap, label: "Ready to ship", detail: "A small, typed foundation that deploys cleanly to Vercel." },
  { icon: Layers3, label: "Built to extend", detail: "A focused shell that leaves room for future product slices." },
];

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 lg:px-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><span className="h-3 w-3 rounded-sm bg-current" /></span>
            TraceBox
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild><Link href="/login">Log in</Link></Button>
            <Button asChild><Link href="/signup">Get started <ArrowRight className="h-4 w-4" /></Link></Button>
          </div>
        </header>

        <section className="flex flex-1 items-center py-20 lg:py-28">
          <div className="grid w-full gap-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"><CheckCircle2 className="h-3.5 w-3.5" /> Deployment foundation ready</div>
              <h1 className="max-w-3xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">A dependable home for your engineering work.</h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">TraceBox is a focused project foundation with secure authentication, a typed Supabase database, and a clean workspace shell ready for the next vertical slice.</p>
              <div className="mt-9 flex flex-wrap items-center gap-3"><Button size="lg" asChild><Link href="/signup">Create your account <ArrowRight className="h-4 w-4" /></Link></Button><Button size="lg" variant="outline" asChild><Link href="/login">Log in</Link></Button></div>
              <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><Github className="h-4 w-4" /> Email/password is ready. GitHub OAuth can be enabled in Supabase.</p>
            </div>

            <div className="relative">
              <div className="absolute -inset-10 rounded-full bg-primary/10 blur-3xl" />
              <div className="relative rounded-2xl border border-border/80 bg-card/80 p-4 shadow-2xl shadow-black/20 backdrop-blur">
                <div className="rounded-xl border border-border bg-background/70 p-5">
                  <div className="mb-7 flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Workspace</p><p className="mt-1 text-lg font-semibold">Deployment status</p></div><span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300">All systems go</span></div>
                  <div className="space-y-3">{["Next.js application", "Supabase authentication", "PostgreSQL + RLS", "Vercel runtime"].map((item) => <div key={item} className="flex items-center justify-between rounded-lg border border-border/70 bg-card px-3.5 py-3"><span className="text-sm text-muted-foreground">{item}</span><CheckCircle2 className="h-4 w-4 text-emerald-300" /></div>)}</div>
                  <div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-300" /> Authenticated database query verified</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 border-t border-border py-8 sm:grid-cols-3">{highlights.map(({ icon: Icon, label, detail }) => <div key={label} className="flex gap-3"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><p className="text-sm font-medium">{label}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p></div></div>)}</section>
      </div>
    </main>
  );
}

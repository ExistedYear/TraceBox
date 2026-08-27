import Link from "next/link";

import { TraceLogo, TraceMark } from "@/components/tracebox/trace-mark";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[0.85fr_1.15fr]">
      <section className="relative hidden overflow-hidden border-r border-border/80 bg-card/40 p-10 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" aria-label="TraceBox home"><TraceLogo /></Link>
        <div className="relative max-w-md"><p className="mb-5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-primary"><TraceMark className="h-4 w-4" /> A calmer way to ship</p><h1 className="text-4xl font-semibold tracking-[-0.04em]">Start with a foundation you can trust.</h1><p className="mt-5 max-w-sm leading-7 text-muted-foreground">Trace issues from the first report to the final release with a workspace designed for signal, not noise.</p><div className="mt-8 space-y-3 border-l border-primary/40 pl-4 text-sm text-muted-foreground"><p>Typed data boundaries</p><p>Secure Supabase sessions</p><p>Workflow ready for your team</p></div></div>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">TraceBox foundation · 2026</p>
      </section>
      <section className="flex min-h-screen flex-col px-5 py-6 sm:px-10"><Link href="/" className="lg:hidden" aria-label="TraceBox home"><TraceLogo /></Link><div className="flex flex-1 items-center justify-center py-12">{children}</div><p className="text-center text-xs text-muted-foreground">By continuing, you agree to keep your workspace secure.</p></section>
    </main>
  );
}

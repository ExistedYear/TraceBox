import Link from "next/link";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="min-h-screen lg:grid lg:grid-cols-[0.9fr_1.1fr]">
      <section className="hidden border-r border-border bg-card/30 p-10 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><span className="h-3 w-3 rounded-sm bg-current" /></span>TraceBox</Link>
        <div className="max-w-md"><p className="text-sm font-medium text-primary">A calmer way to ship</p><h1 className="mt-4 text-4xl font-semibold tracking-tight">Start with a foundation you can trust.</h1><p className="mt-5 leading-7 text-muted-foreground">Your workspace is backed by Supabase Auth, PostgreSQL row-level security, and a deployment path designed for incremental product work.</p></div>
        <p className="text-xs text-muted-foreground">TraceBox foundation · 2026</p>
      </section>
      <section className="flex min-h-screen flex-col px-6 py-8 sm:px-10"><Link href="/" className="flex items-center gap-2 font-semibold tracking-tight lg:hidden"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><span className="h-3 w-3 rounded-sm bg-current" /></span>TraceBox</Link><div className="flex flex-1 items-center justify-center py-12">{children}</div></section>
    </main>
  );
}

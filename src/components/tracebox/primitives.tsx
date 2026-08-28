import type { ReactNode } from "react";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function Surface({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={cn("rounded-[10px] border border-border/80 bg-card", className)}>{children}</section>;
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center"><span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border bg-muted text-muted-foreground"><Icon className="h-5 w-5" /></span><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>{action && <div className="mt-4">{action}</div>}</div>;
}

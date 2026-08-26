import type { ReactNode } from "react";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type Status = "open" | "in-progress" | "blocked" | "resolved" | "closed" | "planned";
export type Priority = "urgent" | "high" | "medium" | "low";

const statusStyles: Record<Status, string> = {
  open: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "in-progress": "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  blocked: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  resolved: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  closed: "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
  planned: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

const statusLabels: Record<Status, string> = {
  open: "Open",
  "in-progress": "In progress",
  blocked: "Blocked",
  resolved: "Resolved",
  closed: "Closed",
  planned: "Planned",
};

const priorityStyles: Record<Priority, string> = {
  urgent: "text-red-600 dark:text-red-300",
  high: "text-orange-600 dark:text-orange-300",
  medium: "text-amber-600 dark:text-amber-300",
  low: "text-slate-500 dark:text-slate-400",
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", statusStyles[status], className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}

export function PriorityMark({ priority, showLabel = false }: { priority: Priority; showLabel?: boolean }) {
  const bars = priority === "urgent" ? 4 : priority === "high" ? 3 : priority === "medium" ? 2 : 1;
  return (
    <span className={cn("inline-flex items-center gap-1.5", priorityStyles[priority])} title={`${priority} priority`}>
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => <span key={bar} className={cn("w-1 rounded-sm bg-current", bar <= bars ? "opacity-100" : "opacity-20", bar === 1 ? "h-1.5" : bar === 2 ? "h-2" : bar === 3 ? "h-2.5" : "h-3")} />)}
      </span>
      {showLabel && <span className="capitalize">{priority}</span>}
      <span className="sr-only">{priority} priority</span>
    </span>
  );
}

export function MetricCard({ icon: Icon, label, value, detail, trend, className }: { icon: LucideIcon; label: string; value: string; detail: string; trend?: string; className?: string }) {
  return (
    <div className={cn("rounded-[10px] border bg-card p-4", className)}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="mt-3 flex items-baseline gap-2"><span className="font-mono text-2xl font-semibold tracking-tight">{value}</span>{trend && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-300">{trend}</span>}</div>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-border/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-primary">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Surface({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={cn("rounded-[10px] border bg-card", className)}>{children}</section>;
}

export function TraceLine({ className }: { className?: string }) {
  return <span className={cn("relative block w-px bg-primary/35", className)} aria-hidden="true"><span className="absolute -left-1 top-0 h-2 w-2 rounded-full border-2 border-primary bg-background" /></span>;
}

export function Avatar({ name, tone = "blue", size = "md" }: { name: string; tone?: "blue" | "violet" | "amber" | "green" | "slate"; size?: "sm" | "md" }) {
  const tones = { blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300", violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300", amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300", green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", slate: "bg-muted text-muted-foreground" };
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-mono font-semibold", size === "sm" ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-[10px]", tones[tone])} aria-label={name}>{initials}</span>;
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center"><span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border bg-muted text-muted-foreground"><Icon className="h-5 w-5" /></span><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>{action && <div className="mt-4">{action}</div>}</div>;
}

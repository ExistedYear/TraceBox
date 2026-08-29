"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Braces, FileText, Github, SlidersHorizontal, Users } from "lucide-react";

import { cn } from "@/lib/utils";

const settingsLinks = [
  { href: "/dashboard/settings", label: "Project configuration", description: "Components, planning, and workflow", icon: SlidersHorizontal, exact: true },
  { href: "/dashboard/settings/templates", label: "Issue templates", description: "Reusable report structures", icon: FileText },
  { href: "/dashboard/settings/custom-fields", label: "Custom fields & API", description: "Metadata and access tokens", icon: Braces },
  { href: "/dashboard/settings/members", label: "Workspace members", description: "Workspace roles and invitations", icon: Users },
  { href: "/dashboard/settings/contributors", label: "Contributors", description: "Project access and roles", icon: Users },
  { href: "/dashboard/settings/notifications", label: "Notifications", description: "Personal in-app delivery", icon: Bell },
  { href: "/dashboard/settings/integrations", label: "Integrations", description: "GitHub repositories and automation", icon: Github, developerOnly: true },
];

export function SettingsNavigation({ canAccessDeveloperSettings }: { canAccessDeveloperSettings: boolean }) {
  const pathname = usePathname();
  return (
    <aside aria-label="Project settings navigation" className="min-w-0 lg:sticky lg:top-20 lg:self-start">
      <p className="mb-2 hidden px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60 lg:block">Settings</p>
      <nav className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
        {settingsLinks.filter((item) => !item.developerOnly || canAccessDeveloperSettings).map((item) => {
          const Icon = item.icon;
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("group flex min-w-[210px] items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors lg:min-w-0 lg:border-transparent", active ? "border-primary/25 bg-primary/10 text-foreground lg:border-primary/20" : "border-border/80 bg-card text-muted-foreground hover:border-border hover:bg-accent/60 hover:text-foreground lg:bg-transparent")}>
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{item.label}</span>
                <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{item.description}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

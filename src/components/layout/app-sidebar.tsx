"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ChevronsLeft, ChevronsRight, CircleDot, Inbox, LayoutDashboard, Menu, Plus, ScrollText, Settings2, ShieldAlert, ShieldCheck, Users } from "lucide-react";

import { TraceLogo } from "@/components/tracebox/trace-mark";
import { WorkspaceSwitcher, type ProjectSummary, type WorkspaceSummary } from "@/components/layout/workspace-switcher";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const primaryLinks = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/issues", label: "Issues", icon: CircleDot },
  { href: "/dashboard/triage", label: "Triage", icon: Inbox },
  { href: "/dashboard/readiness", label: "Readiness", icon: ShieldCheck },
  { href: "/dashboard/reports", label: "Reports", icon: BarChart3 },
  { href: "/dashboard/security", label: "Security", icon: ShieldAlert },
  { href: "/dashboard/audit", label: "Audit", icon: ScrollText },
];

export type ShellNavProps = { organizations: WorkspaceSummary[]; projects: ProjectSummary[]; activeOrganizationId: string; activeProjectId: string | null };

function SidebarLink({ href, label, icon: Icon, collapsed, onNavigate }: { href: string; label: string; icon: typeof LayoutDashboard; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  return <Link href={href} prefetch={href === "/dashboard/issues" ? false : undefined} onClick={onNavigate} aria-current={current ? "page" : undefined} title={collapsed ? label : undefined} className={cn("group flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors", current ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground", collapsed && "justify-center px-2")}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}</Link>;
}

function SidebarContent({ mobile = false, collapsed = false, onCollapse, onNavigate, switcher }: { mobile?: boolean; collapsed?: boolean; onCollapse?: () => void; onNavigate?: () => void; switcher?: React.ReactNode }) {
  return <div className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto", mobile ? "p-4" : collapsed ? "p-2" : "p-3")}>
    <div className={cn("flex items-center", collapsed ? "justify-between" : "justify-between px-1")}>
      <Link href="/dashboard" onClick={onNavigate} aria-label="TraceBox dashboard"><TraceLogo compact={collapsed} /></Link>
      {!mobile && onCollapse && <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" onClick={onCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}</Button>}
    </div>
    {!collapsed && switcher && <div className="mt-4">{switcher}</div>}
    <div className={cn("mt-5", collapsed && "mt-8")}>
      <Link href="/dashboard/issues/new" onClick={onNavigate} title={collapsed ? "Create issue" : undefined} className={cn("flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90", collapsed && "px-0")}>
        <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {!collapsed && <span>Create issue</span>}
      </Link>
    </div>
    <nav aria-label="Project navigation" className="mt-5 space-y-1">
      {!collapsed && <p className="mb-2 px-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">Project</p>}
      {primaryLinks.map((item) => <SidebarLink key={item.href} {...item} collapsed={collapsed} onNavigate={onNavigate} />)}
    </nav>
    <div className="mt-auto shrink-0 space-y-1"><SidebarLink href="/dashboard/settings/contributors" label="Contributors" icon={Users} collapsed={collapsed} onNavigate={onNavigate} /><SidebarLink href="/dashboard/settings" label="Settings" icon={Settings2} collapsed={collapsed} onNavigate={onNavigate} />{!collapsed && <div className="mt-4 border-t border-border/70 px-2.5 pt-4"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">TraceBox</p><p className="mt-1 text-xs text-muted-foreground">v0.1</p></div>}</div>
  </div>;
}

export function AppSidebar({ organizations, projects, activeOrganizationId, activeProjectId }: ShellNavProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const switcher = <WorkspaceSwitcher organizations={organizations} projects={projects} activeOrganizationId={activeOrganizationId} activeProjectId={activeProjectId} />;
  return <aside className={cn("sticky top-0 hidden h-screen shrink-0 border-r border-border/80 bg-card/35 transition-[width] duration-200 md:block", collapsed ? "w-[72px]" : "w-64")}><SidebarContent collapsed={collapsed} onCollapse={() => setCollapsed((value) => !value)} switcher={switcher} /></aside>;
}

export function MobileSidebar({ organizations, projects, activeOrganizationId, activeProjectId }: ShellNavProps) {
  const [open, setOpen] = React.useState(false);
  const close = () => setOpen(false);
  const switcher = <WorkspaceSwitcher organizations={organizations} projects={projects} activeOrganizationId={activeOrganizationId} activeProjectId={activeProjectId} onContextChange={close} />;
  return <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button variant="ghost" size="icon" className="h-9 w-9 md:hidden" aria-label="Open navigation"><Menu className="h-4 w-4" /></Button></SheetTrigger><SheetContent side="left" className="w-72 p-0"><SheetTitle className="sr-only">Workspace navigation</SheetTitle><SidebarContent mobile switcher={switcher} onNavigate={close} /></SheetContent></Sheet>;
}

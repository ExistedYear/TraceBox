"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, CircleDot, FolderKanban, Gauge, LayoutDashboard, Menu, Settings2, Users, UsersRound } from "lucide-react";

import { TraceLogo } from "@/components/tracebox/trace-mark";
import { WorkspaceSwitcher, type ProjectSummary, type WorkspaceSummary } from "@/components/layout/workspace-switcher";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const primaryLinks = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/issues", label: "Issues", icon: CircleDot },
  { href: "/dashboard/teams", label: "Teams", icon: UsersRound },
  { href: "/dashboard/collaborators", label: "Collaborators", icon: Users },
];

const deliveryLinks = [
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { href: "/dashboard/releases", label: "Releases", icon: Gauge },
];

function isCurrent(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

function SidebarLink({ href, label, icon: Icon, collapsed, onNavigate }: { href: string; label: string; icon: typeof LayoutDashboard; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = isCurrent(pathname, href);
  return <Link href={href} onClick={onNavigate} aria-current={current ? "page" : undefined} title={collapsed ? label : undefined} className={cn("group flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors", current ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground", collapsed && "justify-center px-2")}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}</Link>;
}

type ShellNavProps = { organizations: WorkspaceSummary[]; projects: ProjectSummary[]; activeOrganizationId: string; activeProjectId: string | null };

function SidebarContent({ mobile = false, collapsed = false, onCollapse, onNavigate, switcher }: { mobile?: boolean; collapsed?: boolean; onCollapse?: () => void; onNavigate?: () => void; switcher?: React.ReactNode }) {
  return <div className={cn("flex h-full flex-col", mobile ? "p-4" : "p-3")}>
    <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between px-1")}>
      <Link href="/dashboard" onClick={onNavigate} aria-label="TraceBox overview"><TraceLogo compact={collapsed} /></Link>
      {!mobile && onCollapse && <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={onCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}</Button>}
    </div>
    {!collapsed && switcher && <div className="mt-4">{switcher}</div>}
    <nav aria-label="Workspace navigation" className={cn("mt-6 space-y-6", collapsed && "mt-8")}>
      <div className="space-y-1">{!collapsed && <p className="mb-2 px-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/65">Workspace</p>}{primaryLinks.map((item) => <SidebarLink key={item.href} {...item} collapsed={collapsed} onNavigate={onNavigate} />)}</div>
      <div className="space-y-1">{!collapsed && <p className="mb-2 px-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/65">Delivery</p>}{deliveryLinks.map((item) => <SidebarLink key={item.href} {...item} collapsed={collapsed} onNavigate={onNavigate} />)}</div>
    </nav>
    <div className="mt-auto space-y-1"><SidebarLink href="/dashboard/settings" label="Settings" icon={Settings2} collapsed={collapsed} onNavigate={onNavigate} />{!collapsed && <div className="mt-4 border-t border-border/70 px-2.5 pt-4"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">TraceBox</p><p className="mt-1 text-xs text-muted-foreground">v0.1</p></div>}</div>;
  </div>;
}

export function AppSidebar({ organizations, projects, activeOrganizationId, activeProjectId }: ShellNavProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  return <aside className={cn("hidden shrink-0 border-r border-border/80 bg-card/35 transition-[width] duration-200 md:block", collapsed ? "w-[72px]" : "w-64")}><SidebarContent collapsed={collapsed} onCollapse={() => setCollapsed((value) => !value)} switcher={<WorkspaceSwitcher organizations={organizations} projects={projects} activeOrganizationId={activeOrganizationId} activeProjectId={activeProjectId} />} /></aside>;
}

export function MobileSidebar({ organizations, projects, activeOrganizationId, activeProjectId }: ShellNavProps) {
  const switcher = <WorkspaceSwitcher organizations={organizations} projects={projects} activeOrganizationId={activeOrganizationId} activeProjectId={activeProjectId} />;
  return <Sheet><SheetTrigger asChild><Button variant="ghost" size="icon" className="h-9 w-9 md:hidden" aria-label="Open navigation"><Menu className="h-4 w-4" /></Button></SheetTrigger><SheetContent side="left" className="w-72 p-0"><SheetTitle className="sr-only">Workspace navigation</SheetTitle><SidebarContent mobile switcher={switcher} onNavigate={() => undefined} /></SheetContent></Sheet>;
 }

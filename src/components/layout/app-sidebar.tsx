"use client";

import Link from "next/link";
import { LayoutDashboard, Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

function SidebarContent({ mobile = false }: { mobile?: boolean }) {
  return <div className={cn("flex h-full flex-col", mobile ? "p-5" : "p-4")}><Link href="/dashboard" className="flex items-center gap-2 px-2 font-semibold tracking-tight"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><span className="h-3 w-3 rounded-sm bg-current" /></span>TraceBox</Link><div className="my-6 h-px bg-border" /><nav aria-label="Primary navigation" className="space-y-1"><Link href="/dashboard" className="flex items-center gap-3 rounded-md bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary"><LayoutDashboard className="h-4 w-4" />Dashboard</Link></nav><div className="mt-auto px-2 text-xs leading-5 text-muted-foreground">Foundation workspace<br />Ready for the next slice.</div></div>;
}

export function AppSidebar() {
  return <aside className="hidden w-64 shrink-0 border-r border-border bg-card/20 md:block"><SidebarContent /></aside>;
}

export function MobileSidebar() {
  return <Sheet><SheetTrigger asChild><Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></Button></SheetTrigger><SheetContent side="left" className="p-0"><SheetTitle className="sr-only">Navigation</SheetTitle><SidebarContent mobile /></SheetContent></Sheet>;
}

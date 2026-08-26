"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Command, HelpCircle, Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { MobileSidebar } from "@/components/layout/app-sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AppHeaderProps = { email: string; displayName?: string | null; avatarUrl?: string | null };

const pageNames: Record<string, string> = { "/dashboard": "Overview", "/dashboard/issues": "Issues", "/dashboard/teams": "Teams", "/dashboard/collaborators": "Collaborators", "/dashboard/projects": "Projects", "/dashboard/releases": "Releases", "/dashboard/settings": "Settings" };

function getPageName(pathname: string) {
  if (pathname.startsWith("/dashboard/issues/")) return "Issue detail";
  return pageNames[pathname] ?? "Workspace";
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const commands = useMemo(() => [
    { label: "Open overview", hint: "Workspace dashboard", href: "/dashboard" },
    { label: "Search issues", hint: "Browse and filter issues", href: "/dashboard/issues" },
    { label: "View teams", hint: "Manage team membership", href: "/dashboard/teams" },
    { label: "View releases", hint: "Track release health", href: "/dashboard/releases" },
    { label: "Open settings", hint: "Workspace preferences", href: "/dashboard/settings" },
  ].filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(query.toLowerCase())), [query]);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 px-4 pt-[14vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={onClose}><div className="w-full max-w-xl overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/25" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center gap-3 border-b px-4"><Search className="h-4 w-4 text-muted-foreground" /><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspace..." className="h-12 border-0 px-0 shadow-none focus-visible:ring-0" /><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close command palette"><X className="h-4 w-4" /></Button></div><div className="max-h-80 overflow-y-auto p-2">{commands.length ? commands.map((item) => <button key={item.href} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent" onClick={() => go(item.href)}><Command className="h-4 w-4 text-primary" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.label}</span><span className="block truncate text-xs text-muted-foreground">{item.hint}</span></span><span className="font-mono text-[10px] text-muted-foreground">↵</span></button>) : <p className="px-3 py-8 text-center text-sm text-muted-foreground">No commands found.</p>}</div><div className="flex items-center gap-3 border-t px-4 py-2 text-[10px] text-muted-foreground"><span><kbd className="rounded border px-1.5 py-0.5 font-mono">↑↓</kbd> navigate</span><span><kbd className="rounded border px-1.5 py-0.5 font-mono">↵</kbd> open</span><span><kbd className="rounded border px-1.5 py-0.5 font-mono">esc</kbd> close</span></div></div></div>;
}

export function AppHeader({ email, displayName, avatarUrl }: AppHeaderProps) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return <><header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-border/80 bg-background/90 px-3 backdrop-blur sm:px-5"><div className="flex min-w-0 items-center gap-2 sm:gap-3"><MobileSidebar /><div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="font-mono text-[11px] text-primary">TB</span><span>/</span><span>{getPageName(pathname)}</span></div><button className="hidden h-8 min-w-48 items-center gap-2 rounded-md border border-border/80 bg-card/60 px-2.5 text-left text-xs text-muted-foreground hover:bg-accent md:flex" onClick={() => setPaletteOpen(true)}><Search className="h-3.5 w-3.5" /><span className="flex-1">Search workspace</span><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘ K</kbd></button><button className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent md:hidden" onClick={() => setPaletteOpen(true)} aria-label="Open search"><Search className="h-4 w-4" /></button></div><div className="flex items-center gap-0.5"><Button variant="ghost" size="icon" className="hidden h-8 w-8 text-muted-foreground sm:inline-flex" aria-label="Help"><HelpCircle className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="relative h-8 w-8 text-muted-foreground" aria-label="Notifications"><Bell className="h-4 w-4" /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" /></Button><ThemeToggle /><UserMenu email={email} displayName={displayName} avatarUrl={avatarUrl} /></div></header>{paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}</>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { MobileSidebar } from "@/components/layout/app-sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import type { ProjectSummary, WorkspaceSummary } from "@/components/layout/workspace-switcher";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type AppHeaderProps = {
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  workspaceName?: string | null;
  projectName?: string | null;
  organizations: WorkspaceSummary[];
  projects: ProjectSummary[];
  activeOrganizationId: string;
  activeProjectId: string | null;
};

const pageNames: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/issues": "Issues",
  "/dashboard/projects": "Projects",
  "/dashboard/settings": "Settings",
};

function getPageName(pathname: string) {
  if (pathname.startsWith("/dashboard/issues/new")) return "New issue";
  if (pathname.startsWith("/dashboard/issues/")) return "Issue detail";
  return pageNames[pathname] ?? "Workspace";
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);

  const commands = useMemo(
    () => [
      { label: "Open overview", hint: "Workspace dashboard", href: "/dashboard" },
      { label: "Browse issues", hint: "Filter the issue queue", href: "/dashboard/issues" },
      { label: "File new issue", hint: "Report a bug or task", href: "/dashboard/issues/new" },
      { label: "View projects", hint: "All projects in this workspace", href: "/dashboard/projects" },
      { label: "Open settings", hint: "Components and workflow", href: "/dashboard/settings" },
    ].filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  function go(href: string) {
    onClose();
    router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => (commands.length ? (index + 1) % commands.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => (commands.length ? (index - 1 + commands.length) % commands.length : 0));
    } else if (event.key === "Enter" && commands[highlighted]) {
      event.preventDefault();
      go(commands[highlighted].href);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden rounded-xl p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Type to search workspace commands. Use arrow keys to navigate.</DialogDescription>
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search workspace commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={commands[highlighted] ? `command-${highlighted}` : undefined}
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search workspace..."
            className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div id="command-palette-results" role="listbox" className="max-h-80 overflow-y-auto p-2">
          {commands.length ? (
            commands.map((item, index) => (
              <button
                id={`command-${index}`}
                key={item.href}
                role="option"
                aria-selected={index === highlighted}
                className={cnFlex(index === highlighted)}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => go(item.href)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">↵</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No commands found.</p>
          )}
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-2 text-[10px] text-muted-foreground">
          <span><kbd className="rounded border px-1.5 py-0.5 font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="rounded border px-1.5 py-0.5 font-mono">↵</kbd> open</span>
          <span><kbd className="rounded border px-1.5 py-0.5 font-mono">esc</kbd> close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function cnFlex(active: boolean) {
  return [
    "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left",
    active ? "bg-accent" : "hover:bg-accent",
  ].join(" ");
}

export function AppHeader({ email, displayName, avatarUrl, workspaceName, projectName, organizations, projects, activeOrganizationId, activeProjectId }: AppHeaderProps) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-border/80 bg-background/90 px-3 backdrop-blur sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <MobileSidebar organizations={organizations} projects={projects} activeOrganizationId={activeOrganizationId} activeProjectId={activeProjectId} />
          <div className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
            <span className="font-mono text-[11px] text-primary">TB</span>
            {workspaceName && <><span>/</span><span className="max-w-44 truncate">{workspaceName}</span></>}
            {projectName && <><span>/</span><span className="max-w-44 truncate">{projectName}</span></>}
            <span>/</span>
            <span className="shrink-0">{getPageName(pathname)}</span>
          </div>
          <button className="hidden h-8 min-w-48 items-center gap-2 rounded-md border border-border/80 bg-card/60 px-2.5 text-left text-xs text-muted-foreground hover:bg-accent md:flex" onClick={() => setPaletteOpen(true)}>
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1">Search workspace</span>
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘ K</kbd>
          </button>
          <button className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent md:hidden" onClick={() => setPaletteOpen(true)} aria-label="Open search">
            <Search className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          <ThemeToggle />
          <UserMenu email={email} displayName={displayName} avatarUrl={avatarUrl} />
        </div>
      </header>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </>
  );
}


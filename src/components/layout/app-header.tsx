"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  CircleDot,
  Command,
  FolderKanban,
  HelpCircle,
  Inbox,
  Keyboard,
  LayoutDashboard,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { MobileSidebar } from "@/components/layout/app-sidebar";
import { NotificationCenter } from "@/components/layout/notification-center";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import type { ProjectSummary, WorkspaceSummary } from "@/components/layout/workspace-switcher";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { formatIssueKey } from "@/lib/issues";
import { cn } from "@/lib/utils";

type AppHeaderProps = {
  userId: string;
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
  "/dashboard/triage": "Triage Inbox",
  "/dashboard/readiness": "Release Readiness",
  "/dashboard/reports": "Reports & Analytics",
  "/dashboard/projects": "Projects",
  "/dashboard/settings": "Settings",
  "/dashboard/account": "Account",
};

function getPageName(pathname: string) {
  if (pathname.startsWith("/dashboard/issues/new")) return "New issue";
  if (pathname.startsWith("/dashboard/issues/")) return "Issue detail";
  if (pathname.startsWith("/dashboard/milestones/")) return "Milestone detail";
  return pageNames[pathname] ?? "Workspace";
}

type CommandItem = {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon?: any;
  category: "Navigation" | "Action" | "Issue" | "Project";
  run?: () => Promise<void> | void;
};

function CommandPalette({
  projects,
  activeProjectId,
  userId,
  onClose,
}: {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  userId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [matchingIssues, setMatchingIssues] = useState<
    Array<{ id: string; issueNumber: number; title: string; key: string }>
  >([]);
  const [searchingIssues, setSearchingIssues] = useState(false);
  const [matchingQuery, setMatchingQuery] = useState("");
  const [quickStates, setQuickStates] = useState<Array<{ id: string; name: string; category: string }>>([]);
  const searchSequence = useRef(0);

  // Default system commands
  const baseCommands: CommandItem[] = useMemo(
    () => [
      { id: "nav-overview", label: "Open overview", hint: "Workspace dashboard", href: "/dashboard", icon: LayoutDashboard, category: "Navigation" },
      { id: "nav-issues", label: "Browse issues", hint: "Filter the issue queue", href: "/dashboard/issues", icon: CircleDot, category: "Navigation" },
      { id: "nav-my-issues", label: "My issues", hint: "Issues assigned to me", href: `/dashboard/issues?assignee=${encodeURIComponent(userId)}`, icon: CircleDot, category: "Navigation" },
      { id: "nav-notifications", label: "Open notifications", hint: "Unread activity and mentions", href: "/dashboard/notifications", icon: Inbox, category: "Navigation" },
      { id: "nav-triage", label: "Open triage inbox", hint: "Classify incoming bugs", href: "/dashboard/triage", icon: Inbox, category: "Navigation" },
      { id: "nav-readiness", label: "View release readiness", hint: "Blockers and release score", href: "/dashboard/readiness", icon: ShieldCheck, category: "Navigation" },
      { id: "nav-reports", label: "View reports & velocity", hint: "Metrics, MTTR, age", href: "/dashboard/reports", icon: BarChart3, category: "Navigation" },
      { id: "act-new", label: "File new issue", hint: "Report a bug or task", href: "/dashboard/issues/new", icon: Plus, category: "Action" },
      { id: "nav-projects", label: "View projects", hint: "All projects in this workspace", href: "/dashboard/projects", icon: FolderKanban, category: "Navigation" },
      { id: "nav-settings", label: "Open project settings", hint: "Components, workflow, labels, versions", href: "/dashboard/settings", icon: Settings2, category: "Navigation" },
    ],
    [userId],
  );

  // Debounced issue search when typing in palette
  useEffect(() => {
    const trimmed = query.trim();
    const sequence = ++searchSequence.current;
    if (!trimmed || !activeProjectId) return;

    const timer = setTimeout(async () => {
      setSearchingIssues(true);
      try {
        const supabase = createClient();
        const activeProj = projects.find((p) => p.id === activeProjectId);
        const projectKey = activeProj?.key || "ISSUE";
        const { data: stateRows } = await supabase.from("workflow_states").select("id, name, category").eq("project_id", activeProjectId).order("position");
        if (sequence === searchSequence.current) setQuickStates(stateRows ?? []);
        const numMatch = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(trimmed);
        const escaped = trimmed.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
        let q = supabase.from("issues").select("id, issue_number, title").eq("project_id", activeProjectId).limit(5);
        if (numMatch && numMatch[1].toUpperCase() === projectKey.toUpperCase()) q = q.or(`issue_number.eq.${numMatch[2]},title.ilike.%${escaped}%`);
        else q = q.ilike("title", `%${escaped}%`);
        const { data } = await q;
        if (sequence !== searchSequence.current) return;
        setMatchingQuery(trimmed);
        setMatchingIssues((data ?? []).map((i) => ({ id: i.id, issueNumber: i.issue_number, title: i.title, key: formatIssueKey(projectKey, i.issue_number) })));
      } catch {
        if (sequence === searchSequence.current) {
          setMatchingQuery("");
          setMatchingIssues([]);
        }
      } finally {
        if (sequence === searchSequence.current) setSearchingIssues(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, activeProjectId, projects]);

  const allItems = useMemo(() => {
    const items: CommandItem[] = [];

    // Filter base commands
    const filteredBase = baseCommands.filter((item) =>
      `${item.label} ${item.hint}`.toLowerCase().includes(query.toLowerCase()),
    );
    items.push(...filteredBase);

    for (const project of projects) {
      const projectItem = { id: `project-${project.id}`, label: `Open ${project.name}`, hint: `${project.key} project issues`, href: `/dashboard/issues?project=${encodeURIComponent(project.id)}`, icon: FolderKanban, category: "Project" as const };
      if (`${projectItem.label} ${projectItem.hint}`.toLowerCase().includes(query.toLowerCase())) items.push(projectItem);
    }

    // Matching issues
    if (matchingQuery === query.trim()) {
      for (const issue of matchingIssues) {
        items.push({
          id: `issue-${issue.id}`,
          label: `${issue.key} · ${issue.title}`,
          hint: "Jump to issue detail",
          href: `/dashboard/issues/${issue.key}`,
          icon: CircleDot,
          category: "Issue",
        });
        for (const state of quickStates.filter((candidate) => candidate.category !== "TRIAGE")) {
          items.push({
            id: `status-${state.id}-${issue.id}`,
            label: `${state.name}: ${issue.key}`,
            hint: `Quick status action · ${issue.title}`,
            href: `/dashboard/issues/${issue.key}`,
            icon: CircleDot,
            category: "Action",
            run: async () => {
              const { error } = await createClient().rpc("transition_issue", { p_issue_id: issue.id, p_to_state_id: state.id });
              if (error) { toast.error("Could not update issue status."); return; }
              toast.success(`${issue.key} moved to ${state.name}.`);
              router.push(`/dashboard/issues/${issue.key}`);
            },
          });
        }
      }
    }

    return items;
  }, [baseCommands, projects, query, matchingQuery, matchingIssues, quickStates, router]);

  function go(item: CommandItem) {
    onClose();
    if (item.id.startsWith("project-")) {
      document.cookie = `tb_project=${item.id.slice("project-".length)}; path=/; max-age=31536000; samesite=lax`;
    }
    if (item.run) { void item.run(); return; }
    router.push(item.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => (allItems.length ? (index + 1) % allItems.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => (allItems.length ? (index - 1 + allItems.length) % allItems.length : 0));
    } else if (event.key === "Enter" && allItems[highlighted]) {
      event.preventDefault();
      go(allItems[highlighted]);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden rounded-xl p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Type to search workspace commands and issues.</DialogDescription>
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search workspace commands and issues"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={allItems[highlighted] ? `command-${highlighted}` : undefined}
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="type a command, page name, or KEY-N..."
            className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div id="command-palette-results" role="listbox" className="max-h-80 overflow-y-auto p-2">
          {allItems.length ? (
            allItems.map((item, index) => {
              const Icon = item.icon || Command;
              return (
                <button
                  id={`command-${index}`}
                  key={item.id}
                  role="option"
                  aria-selected={index === highlighted}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-xs transition-colors",
                    index === highlighted ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-muted-foreground",
                  )}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => go(item)}
                >
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-foreground">{item.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{item.hint}</span>
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">↵</span>
                </button>
              );
            })
          ) : (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              {searchingIssues ? "Searching..." : "No commands or issues found."}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span><kbd className="rounded border px-1.5 py-0.5 font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="rounded border px-1.5 py-0.5 font-mono">↵</kbd> open</span>
            <span><kbd className="rounded border px-1.5 py-0.5 font-mono">esc</kbd> close</span>
          </div>
          <span className="font-mono text-muted-foreground/70">TraceBox Cmd+K</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AppHeader({
  email,
  displayName,
  avatarUrl,
  workspaceName,
  projectName,
  organizations,
  projects,
  activeOrganizationId,
  activeProjectId,
  userId,
}: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Global keyboard shortcuts (Cmd+K, g+i, g+t, g+r, g+a, g+s, c, ?)
  useEffect(() => {
    let pendingG = false;
    let gTimer: NodeJS.Timeout | undefined;

    function onKeyDown(event: KeyboardEvent) {
      // Ignore if typing inside input/textarea/select
      const tag = (event.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      if (isInput || pathname.startsWith("/dashboard/triage")) return;

      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }

      if (event.key === "c" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        router.push("/dashboard/issues/new");
        return;
      }

      if (event.key === "g" && !event.metaKey && !event.ctrlKey) {
        pendingG = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => {
          pendingG = false;
        }, 1000);
        return;
      }

      if (pendingG) {
        pendingG = false;
        if (event.key === "i") {
          event.preventDefault();
          router.push("/dashboard/issues");
        } else if (event.key === "t") {
          event.preventDefault();
          router.push("/dashboard/triage");
        } else if (event.key === "r") {
          event.preventDefault();
          router.push("/dashboard/readiness");
        } else if (event.key === "a") {
          event.preventDefault();
          router.push("/dashboard/reports");
        } else if (event.key === "s") {
          event.preventDefault();
          router.push("/dashboard/settings");
        } else if (event.key === "p") {
          event.preventDefault();
          router.push("/dashboard/projects");
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(gTimer);
    };
  }, [pathname, router]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/80 bg-background/95 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <MobileSidebar
            organizations={organizations}
            projects={projects}
            activeOrganizationId={activeOrganizationId}
            activeProjectId={activeProjectId}
          />
          <div className="flex items-center gap-2 font-medium">
            <span className="hidden text-muted-foreground md:inline">{workspaceName ?? "Workspace"}</span>
            {workspaceName && <span className="hidden text-muted-foreground/60 md:inline">/</span>}
            <span className="font-semibold text-foreground">{getPageName(pathname)}</span>
            {projectName && (
              <span className="hidden rounded-full border bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground lg:inline">
                {projectName}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            className="flex h-8 w-44 items-center justify-between rounded-md border border-input bg-card/60 px-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:w-60"
          >
            <span className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              <span className="truncate">Search or jump to...</span>
            </span>
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
          </button>

          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            title="Keyboard shortcuts (?)"
            className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
          >
            <HelpCircle className="h-4 w-4" />
          </button>

          <NotificationCenter />
          <ThemeToggle />
          <UserMenu email={email} displayName={displayName} avatarUrl={avatarUrl} />
        </div>
      </header>

      {paletteOpen && (
        <CommandPalette
          projects={projects}
          activeProjectId={activeProjectId}
          userId={userId}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {/* Keyboard Shortcuts Cheat-sheet Dialog */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Keyboard className="h-4 w-4 text-primary" /> Keyboard Shortcuts
            </DialogTitle>
            <DialogDescription className="text-xs">
              Quick keyboard navigation across TraceBox
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-xs">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Global</p>
              <div className="mt-1 space-y-1.5">
                <div className="flex justify-between">
                  <span>Open command palette & search</span>
                  <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10px]">⌘K / Ctrl+K</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Create new issue</span>
                  <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10px]">C</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Show keyboard shortcuts</span>
                  <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10px]">?</kbd>
                </div>
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Navigation (Press G then key)</p>
              <div className="mt-1 space-y-1.5">
                <div className="flex justify-between"><span>Go to Issues</span><span className="font-mono text-muted-foreground">G I</span></div>
                <div className="flex justify-between"><span>Go to Triage Inbox</span><span className="font-mono text-muted-foreground">G T</span></div>
                <div className="flex justify-between"><span>Go to Release Readiness</span><span className="font-mono text-muted-foreground">G R</span></div>
                <div className="flex justify-between"><span>Go to Reports & Velocity</span><span className="font-mono text-muted-foreground">G A</span></div>
                <div className="flex justify-between"><span>Go to Settings</span><span className="font-mono text-muted-foreground">G S</span></div>
                <div className="flex justify-between"><span>Go to Projects</span><span className="font-mono text-muted-foreground">G P</span></div>
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Triage Inbox</p>
              <div className="mt-1 space-y-1.5">
                <div className="flex justify-between"><span>Next / Previous issue</span><span className="font-mono text-muted-foreground">J / K</span></div>
                <div className="flex justify-between"><span>Accept into Open queue</span><span className="font-mono text-muted-foreground">A</span></div>
                <div className="flex justify-between"><span>Reject / Won&apos;t Fix</span><span className="font-mono text-muted-foreground">R</span></div>
                <div className="flex justify-between"><span>Mark as Duplicate</span><span className="font-mono text-muted-foreground">D</span></div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

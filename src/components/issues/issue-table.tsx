"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SavedViewsBar } from "@/components/issues/saved-views-bar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import {
  categoryClasses,
  encodeIssueFilters,
  formatIssueKey,
  ISSUE_TYPES,
  personLabel,
  PRIORITIES,
  SEVERITIES,
  type IssueFilters,
} from "@/lib/issues";
import { cn } from "@/lib/utils";

export type TableRow = {
  id: string;
  issue_number: number;
  title: string;
  type: string;
  priority: string;
  severity: string;
  statusName: string;
  statusCategory: string;
  componentId: string | null;
  componentName: string | null;
  assigneeId: string | null;
  assigneeLabel: string;
  updated_at: string;
};

export type FilterOption = { value: string; label: string };

const selectClass = "h-7 rounded-md border border-input bg-background px-2 text-xs";
const PAGE_SIZE = 25;

type Props = {
  projectKey: string;
  projectId: string;
  canEdit: boolean;
  currentUserId: string;
  states: FilterOption[];
  components: FilterOption[];
  members: FilterOption[];
  initialFilters: IssueFilters;
};

function relativeTime(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const columnHelper = createColumnHelper<TableRow>();

export function IssueTable({ projectKey, projectId, canEdit, currentUserId, states, components, members, initialFilters }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<IssueFilters>(initialFilters);
  const [sorting, setSorting] = useState<SortingState>([{ id: "updated_at", desc: true }]);
  const [page, setPage] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [savedViews, setSavedViews] = useState<Array<{ id: string; project_id: string; name: string; filters: Record<string, string>; is_shared: boolean; created_by: string }>>([]);

  // Monotonic request id: stale responses never overwrite newer results.
  const requestSeq = useRef(0);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("saved_views").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      if (data) setSavedViews(data as any);
    })();
  }, [projectId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    setPage(0);
  }, [filters, sorting, searchQuery]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams(encodeIssueFilters(filters)).toString();
    if (searchQuery.trim()) url.searchParams.set("q", searchQuery.trim());
    window.history.replaceState(null, "", url);
  }, [filters, searchQuery]);



  const fetchData = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("issues")
      .select("id, issue_number, title, type, priority, severity, updated_at, assignee_id, component_id, status:workflow_states (name, category), component:components (name)", { count: "exact" })
      .eq("project_id", projectId)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (searchQuery.trim()) {
      const raw = searchQuery.trim();
      const escaped = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/,/g, "\\,").replace(/"/g, '\\"');
      query = query.or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`);
    }
    if (filters.statusId) query = query.eq("status_id", filters.statusId);
    if (filters.priority) query = query.eq("priority", filters.priority);
    if (filters.severity) query = query.eq("severity", filters.severity);
    if (filters.type) query = query.eq("type", filters.type);
    if (filters.componentId) query = query.eq("component_id", filters.componentId);
    // Only real root columns may be ordered; display columns are unsortable.
    const sortableIds = new Set(["updated_at", "issue_number", "title", "priority", "severity"]);
    const sort = sorting[0];
    if (sort && sortableIds.has(sort.id)) {
      query = query.order(sort.id, { ascending: !sort.desc });
      if (sort.id !== "id") query = query.order("id", { ascending: true });
    } else {
      query = query.order("updated_at", { ascending: false }).order("id", { ascending: true });
    }

    const { data, count, error } = await query;
    if (seq !== requestSeq.current) return; // a newer request superseded this one
    if (error) {
      toast.error("Could not load issues.");
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    const assigneeIds = [...new Set((data ?? []).map((row) => row.assignee_id).filter((id): id is string => Boolean(id)))];
    const { data: profileRows } = assigneeIds.length
      ? await supabase.from("profiles").select("id, display_name").in("id", assigneeIds)
      : { data: [] as { id: string; display_name: string | null }[] };

    if (seq !== requestSeq.current) return;

    const nameMap = new Map((profileRows ?? []).map((row) => [row.id, row.display_name]));
    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        issue_number: row.issue_number,
        title: row.title,
        type: row.type,
        priority: row.priority,
        severity: row.severity,
        statusName: row.status?.name ?? "—",
        statusCategory: row.status?.category ?? "",
        componentId: row.component_id,
        componentName: row.component?.name ?? null,
        assigneeId: row.assignee_id,
        assigneeLabel: personLabel(nameMap.get(row.assignee_id ?? "") ?? undefined, row.assignee_id),
        updated_at: row.updated_at,
      })),
    );
    setTotal(count ?? 0);
    setLoading(false);
  }, [projectId, filters, sorting, page, searchQuery]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, refreshNonce]);

  const updateField = useCallback(
    async (issue: TableRow, field: string, value: string) => {
      setEditingId(issue.id);
      try {
        const { error } = await createClient().rpc("update_issue_fields", {
          p_issue_id: issue.id,
          p_updates: { [field]: value },
        });
        if (error) {
          console.error("Issue update failed:", error);
          const msg = String(error.message);
          toast.error(
            msg.includes("NOT_ALLOWED")
              ? "Developers and maintainers only."
              : msg.includes("PROJECT_ARCHIVED")
                ? "This project is archived."
                : msg.includes("INVALID_ASSIGNEE")
                  ? "That assignee is not eligible for this project."
                  : msg.includes("INVALID_COMPONENT")
                    ? "That component is not available."
                    : "Update rejected.",
          );
          return;
        }
        toast.success(`${formatIssueKey(projectKey, issue.issue_number)} updated.`);
        router.refresh();
        setRefreshNonce((value) => value + 1);
      } catch (err) {
        console.error("Unexpected issue update error:", err);
        toast.error("Could not reach the server. Please try again.");
      } finally {
        setEditingId(null);
      }
    },
    [projectKey, router],
  );

  const columns = useMemo(() => {
    return [
      columnHelper.accessor("issue_number", {
        id: "issue_number",
        header: "ID",
        enableHiding: false,
        cell: (info) => (
          <Link href={`/dashboard/issues/${formatIssueKey(projectKey, info.getValue())}`} className="font-mono text-xs text-muted-foreground hover:text-primary">
            {formatIssueKey(projectKey, info.getValue())}
          </Link>
        ),
      }),
      columnHelper.accessor("title", {
        id: "title",
        header: "Title",
        enableHiding: false,
        cell: (info) => (
          <Link href={`/dashboard/issues/${formatIssueKey(projectKey, info.row.original.issue_number)}`} className="block max-w-md truncate font-medium hover:text-primary">
            {info.getValue()}
          </Link>
        ),
      }),
      columnHelper.display({
        id: "status",
        header: "Status",
        cell: (info) => (
          <span className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", categoryClasses(info.row.original.statusCategory))}>
            {info.row.original.statusName}
          </span>
        ),
      }),
      columnHelper.accessor("priority", {
        id: "priority",
        header: "Priority",
        cell: (info) =>
          canEdit ? (
            <select aria-label="Priority" className={cn(selectClass, "w-16 font-mono")} value={info.getValue()} onChange={(event) => void updateField(info.row.original, "priority", event.target.value)} disabled={editingId === info.row.original.id}>
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          ) : (
            <span className="font-mono text-xs">{info.getValue()}</span>
          ),
      }),
      columnHelper.accessor("severity", {
        id: "severity",
        header: "Severity",
        cell: (info) =>
          canEdit ? (
            <select aria-label="Severity" className={selectClass} value={info.getValue()} onChange={(event) => void updateField(info.row.original, "severity", event.target.value)} disabled={editingId === info.row.original.id}>
              {SEVERITIES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs">{info.getValue()}</span>
          ),
      }),
      columnHelper.accessor("type", {
        id: "type",
        header: "Type",
        enableSorting: false,
        cell: (info) =>
          canEdit ? (
            <select aria-label="Type" className={selectClass} value={info.getValue()} onChange={(event) => void updateField(info.row.original, "type", event.target.value)} disabled={editingId === info.row.original.id}>
              {ISSUE_TYPES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs">{info.getValue()}</span>
          ),
      }),
      columnHelper.accessor("componentName", {
        id: "component",
        header: "Component",
        enableSorting: false,
        cell: (info) =>
          canEdit ? (
            <select aria-label="Component" className={cn(selectClass, "max-w-32")} value={info.row.original.componentId ?? ""} onChange={(event) => void updateField(info.row.original, "component_id", event.target.value)} disabled={editingId === info.row.original.id}>
              <option value="">None</option>
              {info.row.original.componentId && !components.some((component) => component.value === info.row.original.componentId) && <option value={info.row.original.componentId} disabled>{info.row.original.componentName ?? "Archived component"} (archived)</option>}
              {components.map((component) => (
                <option key={component.value} value={component.value}>{component.label}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-muted-foreground">{info.getValue() ?? "—"}</span>
          ),
      }),
      columnHelper.display({
        id: "assignee",
        header: "Assignee",
        cell: (info) =>
          canEdit ? (
            <select aria-label="Assignee" className={cn(selectClass, "max-w-36")} value={info.row.original.assigneeId ?? ""} onChange={(event) => void updateField(info.row.original, "assignee_id", event.target.value)} disabled={editingId === info.row.original.id}>
              <option value="">Unassigned</option>
              {info.row.original.assigneeId && !members.some((member) => member.value === info.row.original.assigneeId) && <option value={info.row.original.assigneeId}>{info.row.original.assigneeLabel}</option>}
              <option value={currentUserId}>Me</option>
              {members.filter((member) => member.value !== currentUserId && member.value !== info.row.original.assigneeId).map((member) => (
                <option key={member.value} value={member.value}>{member.label}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs">{info.row.original.assigneeLabel}</span>
          ),
      }),
      columnHelper.accessor("updated_at", {
        id: "updated_at",
        header: "Updated",
        cell: (info) => <span className="whitespace-nowrap text-xs text-muted-foreground">{relativeTime(info.getValue())}</span>,
      }),
    ];
    // updateField/fetchData are stabilized with useCallback; including them
    // keeps cell handlers in sync with the latest filters/sort/page.
  }, [projectKey, canEdit, editingId, components, members, currentUserId, updateField]);

  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    manualSorting: true,
  });

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function setFilter(key: keyof IssueFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  }

  return (
    <div className="space-y-3">
      <SavedViewsBar
        projectId={projectId}
        currentFilters={encodeIssueFilters(filters)}
        savedViews={savedViews}
        onApply={(filters) => {
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(filters)) next[k] = v as string;
          setFilters(next as any);
        }}
        onViewsChange={setSavedViews}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search by title, description, or KEY-123..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-7 w-48 text-xs sm:w-64"
          aria-label="Search issues"
        />
        <select aria-label="Status filter" className={selectClass} value={filters.statusId ?? ""} onChange={(event) => setFilter("statusId", event.target.value)}>
          {states.map((state) => (
            <option key={state.value} value={state.value}>{state.label}</option>
          ))}
        </select>
        <select aria-label="Priority filter" className={selectClass} value={filters.priority ?? ""} onChange={(event) => setFilter("priority", event.target.value)}>
          <option value="">Any priority</option>
          {PRIORITIES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select aria-label="Severity filter" className={selectClass} value={filters.severity ?? ""} onChange={(event) => setFilter("severity", event.target.value)}>
          <option value="">Any severity</option>
          {SEVERITIES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select aria-label="Type filter" className={selectClass} value={filters.type ?? ""} onChange={(event) => setFilter("type", event.target.value)}>
          <option value="">Any type</option>
          {ISSUE_TYPES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select aria-label="Component filter" className={selectClass} value={filters.componentId ?? ""} onChange={(event) => setFilter("componentId", event.target.value)}>
          <option value="">All components</option>
          {components.map((component) => (
            <option key={component.value} value={component.value}>{component.label}</option>
          ))}
        </select>
        {Object.values(filters).some(Boolean) && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setFilters({})}>Clear</Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto h-7 gap-1.5 px-2 text-xs"><SlidersHorizontal className="h-3 w-3" /> Columns</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Visible columns</DropdownMenuLabel>
            {table.getAllLeafColumns().map((column) => (
              <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} onCheckedChange={(value) => column.toggleVisibility(Boolean(value))}>
                {typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="font-mono text-[10px] text-muted-foreground">{total} issues</span>
      </div>

      <Surface>
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border/80">
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-2.5 text-left">
                    {header.column.getCanSort() ? (
                      <button className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground" onClick={header.column.getToggleSortingHandler()}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span className="font-mono text-[9px]">{{ asc: "↑", desc: "↓" }[header.column.getIsSorted() as string] ?? ""}</span>
                      </button>
                    ) : (
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border/70">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-accent/40">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, table.getVisibleLeafColumns().length)} className="px-4 py-10 text-center text-sm text-muted-foreground">No issues match these filters.</td>
              </tr>
            )}
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, table.getVisibleLeafColumns().length)} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></td>
              </tr>
            )}
          </tbody>
        </table>
      </Surface>

      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>
          <ChevronLeft className="h-3 w-3" /> Prev
        </Button>
        <span className="font-mono">Page {page + 1} / {pageCount}</span>
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>
          Next <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

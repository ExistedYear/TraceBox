"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Surface } from "@/components/tracebox/primitives";
import { createClient } from "@/lib/supabase/client";
import {
  categoryClasses,
  personLabel,
  encodeIssueFilters,
  formatIssueKey,
  ISSUE_TYPES,
  PRIORITIES,
  SEVERITIES,
  type IssueFilters,
} from "@/lib/issues";
import { cn } from "@/lib/utils";

export type TableRow = {
  id: string;
  issue_number: number;
  title: string;
  priority: string;
  severity: string;
  type: string;
  statusName: string;
  statusCategory: string;
  componentName: string | null;
  assigneeId: string | null;
  assigneeLabel: string;
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

export function IssueTable({ projectKey, projectId, canEdit, currentUserId, states, components, members, initialFilters }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<IssueFilters>(initialFilters);
  const [sorting, setSorting] = useState<SortingState>([{ id: "updated_at", desc: true }]);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    setPage(0);
  }, [filters, sorting]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const encoded = encodeIssueFilters(filters);
    url.search = new URLSearchParams(encoded).toString();
    window.history.replaceState(null, "", url);
  }, [filters]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("issues")
      .select("id, issue_number, title, priority, severity, type, assignee_id, component_id, status:workflow_states (name, category), component:components (name)", { count: "exact" })
      .eq("project_id", projectId)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (filters.statusId) query = query.eq("status_id", filters.statusId);
    if (filters.priority) query = query.eq("priority", filters.priority);
    if (filters.severity) query = query.eq("severity", filters.severity);
    if (filters.type) query = query.eq("type", filters.type);
    if (filters.componentId) query = query.eq("component_id", filters.componentId);

    const sort = sorting[0];
    if (sort) query = query.order(sort.id, { ascending: !sort.desc });
    else query = query.order("updated_at", { ascending: false });

    const { data, count, error } = await query;
    if (error) {
      toast.error("Could not load issues.");
      setLoading(false);
      return;
    }

    const userIds = (data ?? []).map((row) => row.assignee_id);
    const profileRows = userIds.length
      ? (await supabase.from("profiles").select("id, display_name").in("id", [...new Set(userIds.filter((id): id is string => Boolean(id)))])).data ?? []
      : [];
    const nameMap = new Map(profileRows.map((row) => [row.id, row.display_name]));

    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        issue_number: row.issue_number,
        title: row.title,
        priority: row.priority,
        severity: row.severity,
        type: row.type,
        statusName: row.status?.name ?? "—",
        statusCategory: row.status?.category ?? "",
        componentName: row.component?.name ?? null,
        assigneeId: row.assignee_id,
        assigneeLabel: personLabel(nameMap.get(row.assignee_id ?? "") ?? undefined, row.assignee_id),
      })),
    );
    setTotal(count ?? 0);
    setLoading(false);
  }, [projectId, filters, sorting, page]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function updateField(issue: TableRow, field: string, value: string) {
    setEditingId(issue.id);
    const { error } = await createClient().rpc("update_issue_fields", {
      p_issue_id: issue.id,
      p_updates: { [field]: value },
    });
    setEditingId(null);
    if (error) {
      toast.error(error.message.includes("NOT_ALLOWED") ? "Developers and maintainers only." : "Update rejected.");
      return;
    }
    toast.success(`${formatIssueKey(projectKey, issue.issue_number)} updated.`);
    router.refresh();
    void fetchData();
  }

  const columns = useMemo(() => {
    const helper = createColumnHelper<TableRow>();
    return [
      helper.accessor("issue_number", {
        id: "issue_number",
        header: "ID",
        cell: (info) => (
          <Link href={`/dashboard/issues/${formatIssueKey(projectKey, info.getValue())}`} className="font-mono text-xs text-muted-foreground hover:text-primary">
            {formatIssueKey(projectKey, info.getValue())}
          </Link>
        ),
      }),
      helper.accessor("title", {
        id: "title",
        header: "Title",
        cell: (info) => (
          <Link href={`/dashboard/issues/${formatIssueKey(projectKey, info.row.original.issue_number)}`} className="block max-w-md truncate font-medium hover:text-primary">
            {info.getValue()}
          </Link>
        ),
      }),
      helper.display({
        id: "status",
        header: "Status",
        cell: (info) => (
          <span className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", categoryClasses(info.row.original.statusCategory))}>
            {info.row.original.statusName}
          </span>
        ),
      }),
      helper.accessor("priority", {
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
      helper.accessor("severity", {
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
      helper.accessor("componentName", {
        id: "component",
        header: "Component",
        cell: (info) => <span className="text-xs text-muted-foreground">{info.getValue() ?? "—"}</span>,
      }),
      helper.display({
        id: "assignee",
        header: "Assignee",
        cell: (info) =>
          canEdit ? (
            <select aria-label="Assignee" className={cn(selectClass, "max-w-36")} value={info.row.original.assigneeId ?? ""} onChange={(event) => void updateField(info.row.original, "assignee_id", event.target.value)} disabled={editingId === info.row.original.id}>
              <option value="">Unassigned</option>
              <option value={currentUserId}>Me</option>
              {members.filter((member) => member.value !== currentUserId).map((member) => (
                <option key={member.value} value={member.value}>{member.label}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs">{info.row.original.assigneeLabel}</span>
          ),
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, canEdit, editingId, currentUserId, members]);

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), state: { sorting }, onSortingChange: setSorting, manualSorting: true });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function setFilter(key: keyof IssueFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Status filter" className={selectClass} value={filters.statusId ?? ""} onChange={(event) => setFilter("statusId", event.target.value)}>
          <option value="">All statuses</option>
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
        {(Object.values(filters).some(Boolean)) && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setFilters({})}>Clear</Button>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{total} issues</span>
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
                <td colSpan={table.getAllLeafColumns().length} className="px-4 py-10 text-center text-sm text-muted-foreground">No issues match these filters.</td>
              </tr>
            )}
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={table.getAllLeafColumns().length} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></td>
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

"use client";

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
import { CheckSquare, ChevronLeft, ChevronRight, Filter, Loader2, Search, ShieldAlert, SlidersHorizontal, X } from "lucide-react";
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
  decodeIssueSearchParams,
  encodeIssueFilters,
  formatIssueKey,
  issueTypeLabel,
  ISSUE_TYPES,
  personLabel,
  CUSTOM_FIELD_FILTER_MAX,
  priorityLabel,
  PRIORITIES,
  SEVERITIES,
  severityLabel,
  RESOLUTIONS,
  humanizeEnum,
  type WorkflowCategory,
  type IssueFilters,
} from "@/lib/issues";
import { cn } from "@/lib/utils";
import type { IssueUpdateField } from "@/lib/validation/issue-update";
import type { SavedViewRow } from "@/lib/validation/saved-views";
import { useRealtimeIssueUpdates } from "@/hooks/use-realtime";

export type TableRow = {
  id: string;
  issue_number: number;
  title: string;
  type: string;
  priority: string;
  severity: string;
  visibility: "PROJECT" | "RESTRICTED";
  statusName: string;
  statusCategory: string;
  componentId: string | null;
  componentName: string | null;
  milestoneName: string | null;
  assigneeId: string | null;
  assigneeLabel: string;
  updated_at: string;
  customValues: Record<string, unknown>;
};

export type FilterOption = { value: string; label: string };

const selectClass = "h-7 rounded-md border border-input bg-background px-2 text-xs";
const PAGE_SIZE = 25;

function FilterSelect({ id, label, value, placeholder, options, onChange }: { id: string; label: string; value: string; placeholder: string; options: FilterOption[]; onChange: (value: string) => void }) {
  return (
    <div className="min-w-[126px] flex-1 sm:flex-none">
      <label htmlFor={id} className="block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">{label}</label>
      <select id={id} aria-label={label} className={cn(selectClass, "mt-1 w-full sm:w-auto")} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

type Props = {
  projectKey: string;
  projectId: string;
  canEdit: boolean;
  canManageProject: boolean;
  currentUserId: string;
  states: FilterOption[];
  components: FilterOption[];
  members: FilterOption[];
  versions: FilterOption[];
  milestones: FilterOption[];
  labels: FilterOption[];
  customFields: Array<{ id: string; name: string; field_type: string; config: Record<string, unknown> }>;
  unresolvedStateIds: string[];
  overdueMilestoneIds: string[];
  stateCategoryIds: Partial<Record<WorkflowCategory, string[]>>;
  initialFilters: IssueFilters;
  initialSearchQuery?: string;
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

export function IssueTable({ projectKey, projectId, canEdit, canManageProject, currentUserId, states, components, members, versions, milestones, labels, customFields, unresolvedStateIds, overdueMilestoneIds, stateCategoryIds, initialFilters, initialSearchQuery = "" }: Props) {
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
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [savedViews, setSavedViews] = useState<SavedViewRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [savedViewsError, setSavedViewsError] = useState(false);
  const [savedViewsNonce, setSavedViewsNonce] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<"priority" | "severity" | "assignee_id" | "component_id" | "affected_version_id" | "target_milestone_id" | "custom_field">("priority");
  const [bulkCustomFieldId, setBulkCustomFieldId] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  // Monotonic request id: stale responses never overwrite newer results.
  const requestSeq = useRef(0);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("saved_views").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      if (error) {
        console.error("Saved views load failed", { code: error.code, message: error.message });
        setSavedViewsError(true);
        return;
      }
      setSavedViewsError(false);
      setSavedViews((data ?? []) as unknown as SavedViewRow[]);
    })();
  }, [projectId, savedViewsNonce]);

  useEffect(() => {
    setPage(0);
  }, [filters, sorting, debouncedQuery]);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams(encodeIssueFilters(filters)).toString();
    if (searchQuery.trim()) url.searchParams.set("q", searchQuery.trim());
    window.history.replaceState(null, "", url);
  }, [filters, searchQuery]);



  const fetchData = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(false);
    const supabase = createClient();
    let labelIssueIds: string[] | null = null;
    let customIssueIds: string[] | null = null;
    if (filters.labelId) {
      const { data: labelRows, error: labelError } = await supabase.from("issue_labels").select("issue_id").eq("label_id", filters.labelId);
      if (seq !== requestSeq.current) return;
      if (labelError) {
        console.error("Issue label filter load failed", { code: labelError.code, message: labelError.message });
        setLoadError(true);
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }
      labelIssueIds = (labelRows ?? []).map((row) => row.issue_id);
      if (labelIssueIds.length === 0) {
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }
    }
    if (filters.unresolved && unresolvedStateIds.length === 0) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    if (filters.overdue && overdueMilestoneIds.length === 0) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    if (filters.customFieldId && filters.customFieldValue) {
      if (filters.customFieldValue.length > CUSTOM_FIELD_FILTER_MAX) { setRows([]); setTotal(0); setLoading(false); return; }
      const customField = customFields.find((field) => field.id === filters.customFieldId);
      const rawValue = filters.customFieldValue;
      const typedValue: string | number | boolean | string[] | undefined = customField?.field_type === "NUMBER" ? Number(rawValue) : customField?.field_type === "BOOLEAN" ? rawValue === "true" ? true : rawValue === "false" ? false : undefined : customField?.field_type === "MULTI_SELECT" ? rawValue.split(",").map((item) => item.trim()).filter(Boolean) : rawValue;
      if (typedValue === undefined || (customField?.field_type === "NUMBER" && (typeof typedValue !== "number" || !Number.isFinite(typedValue)))) { setRows([]); setTotal(0); setLoading(false); return; }
      const { data: customRows, error: customError } = await supabase.from("issue_custom_values").select("issue_id").eq("custom_field_id", filters.customFieldId).eq("value", JSON.stringify(typedValue));
      if (seq !== requestSeq.current) return;
      if (customError) { console.error("Custom field filter load failed", { code: customError.code, message: customError.message }); setLoadError(true); setRows([]); setTotal(0); setLoading(false); return; }
      customIssueIds = (customRows ?? []).map((row) => row.issue_id);
      if (customIssueIds.length === 0) { setRows([]); setTotal(0); setLoading(false); return; }
    }
    let query = supabase
      .from("issues")
      .select("id, issue_number, title, type, priority, severity, resolution, visibility, reporter_id, affected_version_id, target_milestone_id, created_at, updated_at, assignee_id, component_id, status:workflow_states (name, category), component:components (name), milestone:milestones (name), custom_values:issue_custom_values(custom_field_id, value)", { count: "exact" })
      .eq("project_id", projectId)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (debouncedQuery.trim()) {
      const raw = debouncedQuery.trim();
      const numMatch = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(raw);
      const escaped = raw
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_")
        .replace(/,/g, "\\,")
        .replace(/"/g, '\\"')
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)");
      const keyPrefix = numMatch?.[1].toUpperCase();
      if (numMatch && (!keyPrefix || keyPrefix === projectKey.toUpperCase())) {
        query = query.or(`issue_number.eq.${numMatch[2]},title.ilike.%${escaped}%,description.ilike.%${escaped}%`);
      } else {
        query = query.or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`);
      }
    }
    if (filters.statusId) query = query.eq("status_id", filters.statusId);
    if (filters.priority) query = query.eq("priority", filters.priority);
    if (filters.severity) query = query.eq("severity", filters.severity);
    if (filters.critical) query = query.in("severity", ["BLOCKER", "CRITICAL"]);
    if (filters.type) query = query.eq("type", filters.type);
    if (filters.visibility) query = query.eq("visibility", filters.visibility);
    if (filters.componentId) query = query.eq("component_id", filters.componentId);
    if (filters.assigneeId) query = query.eq("assignee_id", filters.assigneeId);
    if (filters.reporterId) query = query.eq("reporter_id", filters.reporterId);
    if (filters.resolution) query = query.eq("resolution", filters.resolution);
    if (filters.versionId) query = query.eq("affected_version_id", filters.versionId);
    if (filters.milestoneId) query = query.eq("target_milestone_id", filters.milestoneId);
    if (filters.statusCategories?.length) {
      const categoryStateIds = filters.statusCategories.flatMap((category) => stateCategoryIds[category] ?? []);
      if (categoryStateIds.length === 0) {
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }
      query = query.in("status_id", categoryStateIds);
    }
    if (filters.unresolved) query = query.in("status_id", unresolvedStateIds);
    if (filters.overdue) query = query.in("target_milestone_id", overdueMilestoneIds);
    if (filters.createdFrom) query = query.gte("created_at", `${filters.createdFrom}T00:00:00.000Z`);
    if (filters.createdTo) query = query.lt("created_at", `${filters.createdTo}T23:59:59.999Z`);
    if (filters.updatedFrom) query = query.gte("updated_at", `${filters.updatedFrom}T00:00:00.000Z`);
    if (filters.updatedTo) query = query.lt("updated_at", `${filters.updatedTo}T23:59:59.999Z`);
    if (labelIssueIds) query = query.in("id", labelIssueIds);
    if (customIssueIds) query = query.in("id", customIssueIds);
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
      setLoadError(true);
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    const assigneeIds = [...new Set((data ?? []).map((row) => row.assignee_id).filter((id): id is string => Boolean(id)))];
    const { data: profileRows, error: profilesError } = assigneeIds.length
      ? await supabase.from("profiles").select("id, display_name").in("id", assigneeIds)
      : { data: [] as { id: string; display_name: string | null }[], error: null };

    if (seq !== requestSeq.current) return;
    if (profilesError) {
      console.error("Issue assignee profile load failed", { code: profilesError.code, message: profilesError.message });
      setLoadError(true);
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    const nameMap = new Map((profileRows ?? []).map((row) => [row.id, row.display_name]));
    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        issue_number: row.issue_number,
        title: row.title,
        type: row.type,
        priority: row.priority,
        severity: row.severity,
        visibility: row.visibility === "RESTRICTED" ? "RESTRICTED" : "PROJECT",
        statusName: row.status?.name ?? "—",
        statusCategory: row.status?.category ?? "",
        componentId: row.component_id,
        componentName: row.component?.name ?? null,
        milestoneName: row.milestone?.name ?? null,
        assigneeId: row.assignee_id,
        assigneeLabel: personLabel(nameMap.get(row.assignee_id ?? "") ?? undefined, row.assignee_id),
        updated_at: row.updated_at,
        customValues: Object.fromEntries(((row.custom_values ?? []) as Array<{ custom_field_id: string; value: unknown }>).map((item) => [item.custom_field_id, item.value])),
      })),
    );
    setTotal(count ?? 0);
    setLoading(false);
  }, [projectKey, projectId, filters, sorting, page, debouncedQuery, customFields, unresolvedStateIds, overdueMilestoneIds, stateCategoryIds]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, refreshNonce]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, filters, projectId]);

  useRealtimeIssueUpdates(
    projectId,
    (payload) => {
      if (!payload || typeof payload !== "object") return;
      const incoming = payload as Partial<TableRow> & { id?: unknown; status_id?: unknown; component_id?: unknown; assignee_id?: unknown; updated_at?: unknown };
      if (typeof incoming.id !== "string") return;
      // Visibility changes are security-sensitive. Remove a newly restricted
      // row before the RLS-backed refetch decides whether this user may retain
      // it; authorized users get it back from the server immediately.
      if (incoming.visibility === "RESTRICTED") {
        setRows((current) => current.filter((row) => row.id !== incoming.id));
        setRefreshNonce((value) => value + 1);
        return;
      }
      setRows((current) => current.map((row) => row.id !== incoming.id ? row : {
        ...row,
        title: typeof incoming.title === "string" ? incoming.title : row.title,
        type: typeof incoming.type === "string" ? incoming.type : row.type,
        priority: typeof incoming.priority === "string" ? incoming.priority : row.priority,
        severity: typeof incoming.severity === "string" ? incoming.severity : row.severity,
        visibility: incoming.visibility === "RESTRICTED" || incoming.visibility === "PROJECT" ? incoming.visibility : row.visibility,
        assigneeId: typeof incoming.assignee_id === "string" ? incoming.assignee_id : incoming.assignee_id === null ? null : row.assigneeId,
        componentId: typeof incoming.component_id === "string" ? incoming.component_id : incoming.component_id === null ? null : row.componentId,
        updated_at: typeof incoming.updated_at === "string" ? incoming.updated_at : row.updated_at,
      }));
      // Re-fetch for status/relationship changes and for INSERTs. The client
      // cannot safely evaluate restricted visibility or every active filter.
      setRefreshNonce((value) => value + 1);
    },
    (payload) => {
      if (!payload || typeof payload !== "object") return;
      const id = (payload as { id?: unknown }).id;
      if (typeof id === "string") setRows((current) => current.filter((row) => row.id !== id));
      setRefreshNonce((value) => value + 1);
    },
    () => setLoadError(true),
    () => setRefreshNonce((value) => value + 1),
  );

  const updateField = useCallback(
    async (issue: TableRow, field: IssueUpdateField, value: string) => {
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

  const bulkUpdate = useCallback(async () => {
    if (!canEdit || selectedIds.size === 0 || (bulkField === "custom_field" ? !bulkCustomFieldId : !bulkValue)) return;
    setBulkLoading(true);
    if (bulkField === "custom_field") {
      if (!bulkCustomFieldId) { toast.error("Choose a custom field."); setBulkLoading(false); return; }
      const customField = customFields.find((field) => field.id === bulkCustomFieldId);
      const customValue = bulkValue === "__NULL__" || bulkValue === "" ? null : customField?.field_type === "NUMBER" ? Number(bulkValue) : customField?.field_type === "BOOLEAN" ? bulkValue === "true" : customField?.field_type === "MULTI_SELECT" ? JSON.parse(bulkValue) : bulkValue;
      const { error } = await (createClient() as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message?: string } | null }> }).rpc("bulk_set_issue_custom_value", { p_issue_ids: [...selectedIds], p_custom_field_id: bulkCustomFieldId, p_value: customValue });
      setBulkLoading(false);
      if (error) { toast.error("Bulk custom-field update rejected. No partial changes were applied."); return; }
      toast.success(`${selectedIds.size} issues updated.`); setSelectedIds(new Set()); setBulkValue(""); setRefreshNonce((value) => value + 1); return;
    }
    const { error } = await (createClient() as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message?: string } | null }> }).rpc("bulk_update_issue_fields", {
      p_project_id: projectId,
      p_issue_ids: [...selectedIds],
      p_updates: { [bulkField]: bulkValue === "__NULL__" ? null : bulkValue },
    });
    setBulkLoading(false);
    if (error) {
      console.error("Bulk issue update failed", { message: error.message });
      toast.error("Bulk update rejected. No partial changes were applied.");
      return;
    }
    toast.success(`${selectedIds.size} issues updated.`);
    setSelectedIds(new Set());
    setBulkValue("");
    setRefreshNonce((value) => value + 1);
  }, [bulkCustomFieldId, bulkField, bulkValue, canEdit, customFields, projectId, selectedIds]);

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
        id: "visibility",
        header: "Access",
        cell: (info) => info.row.original.visibility === "RESTRICTED" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"><ShieldAlert className="h-3 w-3" aria-hidden="true" /> Restricted</span>
        ) : <span className="text-xs text-muted-foreground">Project</span>,
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
            <select aria-label="Priority" className={cn(selectClass, "w-28")} value={info.getValue()} onChange={(event) => void updateField(info.row.original, "priority", event.target.value)} disabled={editingId === info.row.original.id}>
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>{priorityLabel(value)}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs">{priorityLabel(info.getValue())}</span>
          ),
      }),
      columnHelper.accessor("severity", {
        id: "severity",
        header: "Severity",
        cell: (info) =>
          canEdit ? (
            <select aria-label="Severity" className={selectClass} value={info.getValue()} onChange={(event) => void updateField(info.row.original, "severity", event.target.value)} disabled={editingId === info.row.original.id}>
              {SEVERITIES.map((value) => (
                <option key={value} value={value}>{severityLabel(value)}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs">{severityLabel(info.getValue())}</span>
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
                <option key={value} value={value}>{issueTypeLabel(value)}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs">{issueTypeLabel(info.getValue())}</span>
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
      columnHelper.accessor("milestoneName", {
        id: "milestone",
        header: "Milestone",
        enableSorting: false,
        cell: (info) => <span className="text-xs text-muted-foreground">{info.getValue() ?? "—"}</span>,
      }),
      columnHelper.accessor("updated_at", {
        id: "updated_at",
        header: "Updated",
        cell: (info) => <span className="whitespace-nowrap text-xs text-muted-foreground">{relativeTime(info.getValue())}</span>,
      }),
      ...customFields.map((field) => columnHelper.display({
        id: `custom-${field.id}`,
        header: field.name,
        cell: (info) => <span className="max-w-32 truncate text-xs text-muted-foreground">{Array.isArray(info.row.original.customValues[field.id]) ? (info.row.original.customValues[field.id] as unknown[]).join(", ") : String(info.row.original.customValues[field.id] ?? "—")}</span>,
      })),
    ];
    // updateField/fetchData are stabilized with useCallback; including them
    // keeps cell handlers in sync with the latest filters/sort/page.
  }, [projectKey, canEdit, editingId, components, members, currentUserId, updateField, customFields]);

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

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const firstRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastRow = Math.min(total, (page + 1) * PAGE_SIZE);
  const selectedCustomField = customFields.find((field) => field.id === bulkCustomFieldId);
  const customOptions = selectedCustomField && Array.isArray(selectedCustomField.config.options) ? selectedCustomField.config.options.filter((option): option is string => typeof option === "string") : [];
  const filterCustomField = customFields.find((field) => field.id === filters.customFieldId);
  const filterCustomOptions = filterCustomField && Array.isArray(filterCustomField.config.options) ? filterCustomField.config.options.filter((option): option is string => typeof option === "string") : [];
  const customFilterControl = filterCustomField?.field_type === "SINGLE_SELECT" ? <select id="issue-custom-value-filter" className={selectClass} value={filters.customFieldValue ?? ""} onChange={(event) => setFilter("customFieldValue", event.target.value)}><option value="">Any value</option>{filterCustomOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select> : filterCustomField?.field_type === "BOOLEAN" ? <select id="issue-custom-value-filter" className={selectClass} value={filters.customFieldValue ?? ""} onChange={(event) => setFilter("customFieldValue", event.target.value)}><option value="">Any value</option><option value="true">Yes</option><option value="false">No</option></select> : filterCustomField?.field_type === "USER" ? <select id="issue-custom-value-filter" className={selectClass} value={filters.customFieldValue ?? ""} onChange={(event) => setFilter("customFieldValue", event.target.value)}><option value="">Any user</option>{members.map((member) => <option key={member.value} value={member.value}>{member.label}</option>)}</select> : <Input id="issue-custom-value-filter" type={filterCustomField?.field_type === "NUMBER" ? "number" : filterCustomField?.field_type === "DATE" ? "date" : "text"} value={filters.customFieldValue ?? ""} onChange={(event) => setFilter("customFieldValue", event.target.value)} className="h-7 text-xs" placeholder={filterCustomField?.field_type === "MULTI_SELECT" ? "Values, comma-separated" : "Value"} />;
  const bulkCustomControl = selectedCustomField?.field_type === "SINGLE_SELECT" ? <select aria-label="Bulk custom value" className={selectClass} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Choose value</option>{customOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select> : selectedCustomField?.field_type === "MULTI_SELECT" ? <select aria-label="Bulk custom value" multiple className="min-h-8 rounded-md border border-input bg-background px-2 text-xs" value={bulkValue ? JSON.parse(bulkValue) as string[] : []} onChange={(event) => setBulkValue(JSON.stringify(Array.from(event.target.selectedOptions, (option) => option.value)))}>{customOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select> : selectedCustomField?.field_type === "BOOLEAN" ? <select aria-label="Bulk custom value" className={selectClass} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Choose value</option><option value="true">Yes</option><option value="false">No</option></select> : <Input aria-label="Bulk custom value" type={selectedCustomField?.field_type === "NUMBER" ? "number" : selectedCustomField?.field_type === "DATE" ? "date" : "text"} className={selectClass} value={bulkValue === "__NULL__" ? "" : bulkValue} onChange={(event) => setBulkValue(event.target.value)} placeholder="Value (blank clears)" />;

  return (
    <div className="space-y-3">
      {loadError && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><span>Issues could not be loaded. Your filters are preserved.</span><Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRefreshNonce((value) => value + 1)}>Retry</Button></div>}
      {savedViewsError && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"><span>Saved views could not be loaded. The issue queue remains available.</span><Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSavedViewsNonce((value) => value + 1)}>Retry views</Button></div>}
      <SavedViewsBar
        projectId={projectId}
        currentFilters={{ ...encodeIssueFilters(filters), ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}) }}
        savedViews={savedViews}
        currentUserId={currentUserId}
        canManageProject={canManageProject}
        onApply={(filters) => {
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(filters)) next[k] = v as string;
          setFilters(decodeIssueSearchParams(next, {
            stateIds: new Set(states.map((state) => state.value)),
            componentIds: new Set(components.map((component) => component.value)),
            memberIds: new Set(members.map((member) => member.value)),
            versionIds: new Set(versions.map((version) => version.value)),
            milestoneIds: new Set(milestones.map((milestone) => milestone.value)),
            labelIds: new Set(labels.map((label) => label.value)),
            customFieldIds: new Set(customFields.map((field) => field.id)),
          }));
          setSearchQuery(typeof filters.q === "string" ? filters.q : "");
        }}
        onViewsChange={setSavedViews}
      />
      <div className="rounded-[10px] border border-border/80 bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary"><Filter className="h-3.5 w-3.5" /></span>
            <div>
              <p className="text-xs font-semibold">Issue view</p>
              <p className="text-[11px] text-muted-foreground">Narrow the queue by ownership, state, or impact.</p>
            </div>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground" aria-live="polite">{total} {total === 1 ? "issue" : "issues"}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1 sm:max-w-xs">
            <label htmlFor="issue-search" className="block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Search</label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="issue-search" placeholder="Title, description, or KEY-123..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-7 pl-7 text-xs" aria-label="Search issues" />
            </div>
          </div>
          <FilterSelect id="issue-status-filter" label="Status" value={filters.statusId ?? ""} placeholder="All statuses" options={states} onChange={(value) => setFilter("statusId", value)} />
          <FilterSelect id="issue-priority-filter" label="Priority" value={filters.priority ?? ""} placeholder="Any priority" options={PRIORITIES.map((value) => ({ value, label: priorityLabel(value) }))} onChange={(value) => setFilter("priority", value)} />
          <FilterSelect id="issue-severity-filter" label="Severity" value={filters.severity ?? ""} placeholder="Any severity" options={SEVERITIES.map((value) => ({ value, label: severityLabel(value) }))} onChange={(value) => setFilter("severity", value)} />
          <FilterSelect id="issue-type-filter" label="Type" value={filters.type ?? ""} placeholder="Any type" options={ISSUE_TYPES.map((value) => ({ value, label: issueTypeLabel(value) }))} onChange={(value) => setFilter("type", value)} />
          <FilterSelect id="issue-visibility-filter" label="Access" value={filters.visibility ?? ""} placeholder="All visibility" options={[{ value: "PROJECT", label: "Project" }, { value: "RESTRICTED", label: "Restricted" }]} onChange={(value) => setFilter("visibility", value)} />
          <FilterSelect id="issue-component-filter" label="Component" value={filters.componentId ?? ""} placeholder="All components" options={components} onChange={(value) => setFilter("componentId", value)} />
          <FilterSelect id="issue-assignee-filter" label="Assignee" value={filters.assigneeId ?? ""} placeholder="All assignees" options={members} onChange={(value) => setFilter("assigneeId", value)} />
          <FilterSelect id="issue-reporter-filter" label="Reporter" value={filters.reporterId ?? ""} placeholder="All reporters" options={members} onChange={(value) => setFilter("reporterId", value)} />
          <FilterSelect id="issue-resolution-filter" label="Resolution" value={filters.resolution ?? ""} placeholder="Any resolution" options={RESOLUTIONS.map((value) => ({ value, label: humanizeEnum(value) }))} onChange={(value) => setFilter("resolution", value)} />
          <FilterSelect id="issue-version-filter" label="Version" value={filters.versionId ?? ""} placeholder="All versions" options={versions} onChange={(value) => setFilter("versionId", value)} />
          <FilterSelect id="issue-milestone-filter" label="Milestone" value={filters.milestoneId ?? ""} placeholder="All milestones" options={milestones} onChange={(value) => setFilter("milestoneId", value)} />
          <FilterSelect id="issue-label-filter" label="Label" value={filters.labelId ?? ""} placeholder="All labels" options={labels} onChange={(value) => setFilter("labelId", value)} />
          <FilterSelect id="issue-custom-field-filter" label="Custom field" value={filters.customFieldId ?? ""} placeholder="Any custom field" options={customFields.map((field) => ({ value: field.id, label: field.name }))} onChange={(value) => setFilter("customFieldId", value)} />
          {filters.customFieldId && <div className="min-w-[130px]"><label htmlFor="issue-custom-value-filter" className="block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Custom value</label><div className="mt-1">{customFilterControl}</div></div>}
          <div className="min-w-[130px]"><label htmlFor="created-from" className="block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Created from</label><Input id="created-from" type="date" className="mt-1 h-7 text-xs" value={filters.createdFrom ?? ""} onChange={(event) => setFilter("createdFrom", event.target.value)} /></div>
          <div className="min-w-[130px]"><label htmlFor="created-to" className="block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Created to</label><Input id="created-to" type="date" className="mt-1 h-7 text-xs" value={filters.createdTo ?? ""} onChange={(event) => setFilter("createdTo", event.target.value)} /></div>
          <div className="min-w-[130px]"><label htmlFor="updated-from" className="block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Updated from</label><Input id="updated-from" type="date" className="mt-1 h-7 text-xs" value={filters.updatedFrom ?? ""} onChange={(event) => setFilter("updatedFrom", event.target.value)} /></div>
          <div className="min-w-[130px]"><label htmlFor="updated-to" className="block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Updated to</label><Input id="updated-to" type="date" className="mt-1 h-7 text-xs" value={filters.updatedTo ?? ""} onChange={(event) => setFilter("updatedTo", event.target.value)} /></div>
          {activeFilterCount > 0 && <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setFilters({})}><X className="h-3 w-3" /> Clear {activeFilterCount}</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs"><SlidersHorizontal className="h-3 w-3" /> Columns</Button>
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
        </div>
      </div>

      {canEdit && selectedIds.size > 0 && <div className="flex flex-wrap items-end gap-2 rounded-[10px] border border-primary/30 bg-primary/5 p-3" role="region" aria-label="Bulk issue actions">
        <div className="flex items-center gap-2 text-xs font-medium"><CheckSquare className="h-3.5 w-3.5 text-primary" /> {selectedIds.size} selected on this page</div>
        <label className="text-[10px] text-muted-foreground">Field<select className={cn(selectClass, "ml-1")} value={bulkField} onChange={(event) => { setBulkField(event.target.value as typeof bulkField); setBulkValue(""); }}><option value="priority">Priority</option><option value="severity">Severity</option><option value="assignee_id">Assignee</option><option value="component_id">Component</option><option value="affected_version_id">Version</option><option value="target_milestone_id">Milestone</option>{customFields.length > 0 && <option value="custom_field">Custom field</option>}</select></label>
        {bulkField === "custom_field" && <select aria-label="Bulk custom field" className={selectClass} value={bulkCustomFieldId} onChange={(event) => { setBulkCustomFieldId(event.target.value); setBulkValue(""); }}><option value="">Choose field</option>{customFields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>}
        {bulkField === "custom_field" ? bulkCustomControl : <select aria-label="Bulk value" className={selectClass} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Choose value</option>{(bulkField === "priority" ? PRIORITIES.map((value) => ({ value, label: priorityLabel(value) })) : bulkField === "severity" ? SEVERITIES.map((value) => ({ value, label: severityLabel(value) })) : bulkField === "assignee_id" ? [{ value: "__NULL__", label: "Unassigned" }, ...members] : bulkField === "component_id" ? [{ value: "__NULL__", label: "None" }, ...components] : bulkField === "affected_version_id" ? [{ value: "__NULL__", label: "None" }, ...versions] : [{ value: "__NULL__", label: "None" }, ...milestones]).map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}</select>}
        <Button type="button" size="sm" className="h-7 text-xs" disabled={bulkLoading || (bulkField === "custom_field" ? !bulkCustomFieldId : !bulkValue)} onClick={() => void bulkUpdate()}>{bulkLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Apply atomically</Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>Clear</Button>
      </div>}

      <Surface>
        <div className="divide-y divide-border/70 sm:hidden">
          {rows.map((issue) => <Link key={issue.id} href={`/dashboard/issues/${formatIssueKey(projectKey, issue.issue_number)}`} className="block space-y-2 p-3 hover:bg-accent/40"><div className="flex items-start justify-between gap-2"><span className="font-mono text-xs font-semibold text-primary">{formatIssueKey(projectKey, issue.issue_number)}</span><span className={cn("rounded-full border px-2 py-0.5 text-[9px] uppercase", categoryClasses(issue.statusCategory))}>{issue.statusName}</span></div><p className="line-clamp-2 text-sm font-medium">{issue.title}</p><div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{issue.visibility === "RESTRICTED" && <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><ShieldAlert className="h-3 w-3" /> Restricted</span>}<span>{issueTypeLabel(issue.type)}</span><span>{priorityLabel(issue.priority)}</span><span>{severityLabel(issue.severity)}</span><span>{issue.assigneeLabel}</span></div></Link>)}
          {!loading && rows.length === 0 && <p className="p-8 text-center text-xs text-muted-foreground">No issues match these filters.</p>}
          {loading && rows.length === 0 && <Loader2 className="mx-auto my-8 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-border/80">
                  <th scope="col" className="px-4 py-2.5"><input type="checkbox" aria-label="Select all issues on this page" checked={rows.length > 0 && rows.every((row) => selectedIds.has(row.id))} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); rows.forEach((row) => event.target.checked ? next.add(row.id) : next.delete(row.id)); return next; })} /></th>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} scope="col" aria-sort={header.column.getIsSorted() ? (header.column.getIsSorted() === "asc" ? "ascending" : "descending") : "none"} className="px-4 py-2.5 text-left">
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
                  <td className="px-4 py-2"><input type="checkbox" aria-label={`Select ${formatIssueKey(projectKey, row.original.issue_number)}`} checked={selectedIds.has(row.original.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(row.original.id); else next.delete(row.original.id); return next; })} /></td>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2 align-middle">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={Math.max(1, table.getVisibleLeafColumns().length)} className="px-4 py-10 text-center text-sm text-muted-foreground">No issues match these filters.</td></tr>}
              {loading && rows.length === 0 && <tr><td colSpan={Math.max(1, table.getVisibleLeafColumns().length)} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Surface>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Showing <span className="font-mono text-foreground">{firstRow}–{lastRow}</span> of <span className="font-mono text-foreground">{total}</span></span>
        <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>
          <ChevronLeft className="h-3 w-3" /> Prev
        </Button>
        <span className="font-mono">Page {page + 1} / {pageCount}</span>
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>
          Next <ChevronRight className="h-3 w-3" />
        </Button>
        </div>
      </div>
    </div>
  );
}

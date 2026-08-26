"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Milestone, Plus, Tag } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";

function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}
function safeColor(value: string): string {
  return isHexColor(value) ? value : "#6366f1";
}
type LabelOption = {
  id: string;
  name: string;
  color: string;
};

type VersionOption = {
  id: string;
  name: string;
  is_released: boolean;
};

type MilestoneOption = {
  id: string;
  name: string;
  status: string;
};

type Props = {
  issueId: string;
  canEdit: boolean;
  assignedLabelIds: string[];
  allLabels: LabelOption[];
  affectedVersionId: string | null;
  allVersions: VersionOption[];
  targetMilestoneId: string | null;
  allMilestones: MilestoneOption[];
};

export function IssuePlanningSection({
  issueId,
  canEdit,
  assignedLabelIds: initialLabelIds,
  allLabels,
  affectedVersionId: initialVersionId,
  allVersions,
  targetMilestoneId: initialMilestoneId,
  allMilestones,
}: Props) {
  const router = useRouter();
  const [labelIds, setLabelIds] = useState<string[]>(initialLabelIds);
  const [versionId, setVersionId] = useState<string | null>(initialVersionId);
  const [milestoneId, setMilestoneId] = useState<string | null>(initialMilestoneId);
  const [updating, setUpdating] = useState(false);

  const activeMilestone = allMilestones.find((m) => m.id === milestoneId);
  const activeVersion = allVersions.find((v) => v.id === versionId);
  const activeLabels = allLabels.filter((l) => labelIds.includes(l.id));

  async function handleToggleLabel(labelId: string) {
    if (!canEdit) return;
    const nextIds = labelIds.includes(labelId)
      ? labelIds.filter((id) => id !== labelId)
      : [...labelIds, labelId];

    setLabelIds(nextIds);
    try {
      const { error } = await createClient().rpc("set_issue_labels", {
        p_issue_id: issueId,
        p_label_ids: nextIds,
      });
      if (error) {
        toast.error("Could not update issue labels.");
        setLabelIds(labelIds);
        return;
      }
      toast.success("Labels updated.");
      router.refresh();
    } catch {
      toast.error("Could not reach the server.");
      setLabelIds(labelIds);
    }
  }

  async function handleUpdatePlanning(newVersionId?: string | null, newMilestoneId?: string | null) {
    if (!canEdit) return;
    const vId = newVersionId !== undefined ? newVersionId : versionId;
    const mId = newMilestoneId !== undefined ? newMilestoneId : milestoneId;

    setVersionId(vId);
    setMilestoneId(mId);
    setUpdating(true);

    try {
      const { error } = await createClient().rpc("update_issue_planning", {
        p_issue_id: issueId,
        p_affected_version_id: vId,
        p_target_milestone_id: mId,
      });

      if (error) {
        toast.error("Could not update planning metadata.");
        return;
      }
      toast.success("Planning updated.");
      router.refresh();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Labels */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Tag className="h-3 w-3" /> Labels
          </span>
          {canEdit && allLabels.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <Plus className="h-3 w-3" /> Add label
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Select labels
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {allLabels.map((label) => (
                  <DropdownMenuCheckboxItem
                    key={label.id}
                    checked={labelIds.includes(label.id)}
                    onCheckedChange={() => void handleToggleLabel(label.id)}
                    className="text-xs"
                  >
                    <span
                      className="mr-2 h-2.5 w-2.5 rounded-full border"
                      style={{ backgroundColor: safeColor(label.color) }}
                    />
                    <span>{label.name}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {activeLabels.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {activeLabels.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium"
                style={{
                  borderColor: `${safeColor(label.color)}40`,
                  backgroundColor: `${safeColor(label.color)}15`,
                  color: safeColor(label.color),
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: safeColor(label.color) }}
                />
                {label.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Target Milestone */}
      <div className="border-t border-border/70 pt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Milestone className="h-3 w-3" /> Target Milestone
          </span>
          {activeMilestone && (
            <Link
              href={`/dashboard/milestones/${activeMilestone.id}`}
              className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
            >
              View <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          )}
        </div>

        {canEdit ? (
          <select
            aria-label="Target Milestone"
            value={milestoneId ?? ""}
            onChange={(e) => void handleUpdatePlanning(undefined, e.target.value || null)}
            disabled={updating}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">None</option>
            {allMilestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.status})
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs font-medium">
            {activeMilestone ? activeMilestone.name : "None"}
          </p>
        )}
      </div>

      {/* Affected Version */}
      <div className="border-t border-border/70 pt-3">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Affected Version
        </span>

        {canEdit ? (
          <select
            aria-label="Affected Version"
            value={versionId ?? ""}
            onChange={(e) => void handleUpdatePlanning(e.target.value || null, undefined)}
            disabled={updating}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">None</option>
            {allVersions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} {v.is_released ? "(Released)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs font-medium">
            {activeVersion ? activeVersion.name : "None"}
          </p>
        )}
      </div>
    </div>
  );
}

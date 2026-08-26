"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { categoryClasses, RESOLUTIONS, type Resolution } from "@/lib/issues";
import { cn } from "@/lib/utils";

type StateOption = {
  id: string;
  name: string;
  category: string;
};

type TransitionOption = {
  toStateId: string;
};

type Props = {
  issueId: string;
  projectKey: string;
  issueNumber: number;
  currentStatusId: string;
  currentStatusName: string;
  currentStatusCategory: string;
  currentResolution: string | null;
  states: StateOption[];
  allowedTransitions: TransitionOption[];
  canTransition: boolean;
  isMaintainer: boolean;
  onTransitioned?: (newStatusId: string, resolution: string | null) => void;
};

export function IssueStatusTransition({
  issueId,
  currentStatusId,
  currentStatusName,
  currentStatusCategory,
  currentResolution,
  states,
  allowedTransitions,
  canTransition,
  isMaintainer,
  onTransitioned,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [resolutionModalOpen, setResolutionModalOpen] = useState(false);
  const [pendingState, setPendingState] = useState<StateOption | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<Resolution>("FIXED");

  const allowedToStateIds = new Set(allowedTransitions.map((t) => t.toStateId));
  const isResolvedOrClosed = currentStatusCategory === "RESOLVED" || currentStatusCategory === "CLOSED";

  // Filter next candidate states: for maintainers, any state in project; for others, only allowed transitions
  const candidateStates = states.filter((state) => {
    if (state.id === currentStatusId) return false;
    return isMaintainer || allowedToStateIds.has(state.id);
  });

  async function executeTransition(targetState: StateOption, resolution?: string) {
    setLoading(true);
    try {
      const { error } = await createClient().rpc("transition_issue", {
        p_issue_id: issueId,
        p_to_state_id: targetState.id,
        p_resolution: resolution ?? undefined,
      });

      if (error) {
        console.error("Transition failed:", error);
        toast.error(
          error.message.includes("NOT_ALLOWED")
            ? "You do not have permission to transition this issue."
            : error.message.includes("PROJECT_ARCHIVED")
              ? "This project is archived."
              : error.message.includes("INVALID_TRANSITION")
                ? "This workflow transition is not permitted."
                : "Could not change issue status.",
        );
        return;
      }

      toast.success(`Status changed to ${targetState.name}${resolution ? ` (${resolution})` : ""}.`);
      onTransitioned?.(targetState.id, resolution ?? null);
      router.refresh();
    } catch (err) {
      console.error("Unexpected transition error:", err);
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleStateSelect(targetState: StateOption) {
    if (targetState.category === "RESOLVED" || targetState.category === "CLOSED") {
      setPendingState(targetState);
      setSelectedResolution(
        (currentResolution as Resolution) || "FIXED",
      );
      setResolutionModalOpen(true);
    } else {
      void executeTransition(targetState);
    }
  }

  async function handleReopen() {
    setLoading(true);
    try {
      const { error } = await createClient().rpc("reopen_issue", {
        p_issue_id: issueId,
      });

      if (error) {
        console.error("Reopen failed:", error);
        toast.error(
          error.message.includes("NOT_ALLOWED")
            ? "You do not have permission to reopen this issue."
            : "Could not reopen issue.",
        );
        return;
      }

      toast.success("Issue reopened.");
      router.refresh();
    } catch (err) {
      console.error("Unexpected reopen error:", err);
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canTransition ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              className={cn(
                "h-8 gap-1.5 border text-xs font-medium",
                categoryClasses(currentStatusCategory),
              )}
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{currentStatusName}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Transition status
            </DropdownMenuLabel>
            {candidateStates.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No transitions available.</p>
            ) : (
              candidateStates.map((state) => (
                <DropdownMenuItem
                  key={state.id}
                  onSelect={() => handleStateSelect(state)}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        state.category === "TRIAGE"
                          ? "bg-amber-500"
                          : state.category === "OPEN"
                            ? "bg-blue-500"
                            : state.category === "IN_PROGRESS"
                              ? "bg-violet-500"
                              : state.category === "REVIEW"
                                ? "bg-purple-500"
                                : state.category === "RESOLVED"
                                  ? "bg-emerald-500"
                                  : "bg-zinc-500",
                      )}
                    />
                    <span>{state.name}</span>
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                    {state.category.toLowerCase().replace("_", " ")}
                  </span>
                </DropdownMenuItem>
              ))
            )}
            {isResolvedOrClosed && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void handleReopen()} className="gap-2 text-xs text-primary">
                  <RotateCcw className="h-3 w-3" /> Reopen issue
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
            categoryClasses(currentStatusCategory),
          )}
        >
          {currentStatusName}
        </span>
      )}

      {isResolvedOrClosed && canTransition && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => void handleReopen()}
          disabled={loading}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reopen
        </Button>
      )}

      {/* Resolution Dialog */}
      <Dialog open={resolutionModalOpen} onOpenChange={setResolutionModalOpen}>
        <DialogContent className="max-w-md rounded-[10px]">
          <DialogHeader>
            <DialogTitle className="text-base">
              Resolve issue · {pendingState?.name}
            </DialogTitle>
            <DialogDescription>
              Select a resolution describing how this issue was completed or dismissed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="resolution-select">Resolution</Label>
              <select
                id="resolution-select"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedResolution}
                onChange={(e) => setSelectedResolution(e.target.value as Resolution)}
              >
                {RESOLUTIONS.map((res) => (
                  <option key={res} value={res}>
                    {res.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setResolutionModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={loading}
              onClick={() => {
                if (pendingState) {
                  setResolutionModalOpen(false);
                  void executeTransition(pendingState, selectedResolution);
                }
              }}
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirm resolution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

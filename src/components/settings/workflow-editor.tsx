"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import {
  WORKFLOW_CATEGORIES,
  WORKFLOW_ROLES,
  workflowDefinitionSchema,
  type WorkflowStateValues,
  type WorkflowTransitionValues,
} from "@/lib/validation/project-settings";

type StateInput = Omit<WorkflowStateValues, "clientId"> & { clientId?: string };
type TransitionInput = { fromStateId: string; toStateId: string; requiredRole: string | null; requiresResolution: boolean };

const categoryTone: Record<string, string> = {
  TRIAGE: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  OPEN: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  IN_PROGRESS: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  REVIEW: "border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  RESOLVED: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  CLOSED: "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
};

function normalizeStates(states: StateInput[]): WorkflowStateValues[] {
  return states.map((state, index) => ({ ...state, clientId: state.clientId ?? state.id ?? `state-${index}`, position: index * 10 }));
}

function workflowError(message: string) {
  if (message.includes("STATE_IN_USE")) return "A deleted state is still used by an issue. Move those issues before deleting it.";
  if (message.includes("PROJECT_ARCHIVED")) return "Restore the project before publishing its workflow.";
  if (message.includes("NOT_ALLOWED")) return "Only project maintainers can publish workflows.";
  if (message.includes("VALIDATION")) return message.replace(/^.*VALIDATION:\s*/, "").split("\n")[0];
  return "The workflow could not be published.";
}

export function WorkflowEditor({ projectId, canManage, initialStates, initialTransitions }: { projectId: string; canManage: boolean; initialStates: StateInput[]; initialTransitions: TransitionInput[] }) {
  const seededStates = useMemo(() => normalizeStates(initialStates), [initialStates]);
  const [states, setStates] = useState(seededStates);
  const [transitions, setTransitions] = useState<WorkflowTransitionValues[]>(() => initialTransitions.map((transition) => ({
    fromClientId: transition.fromStateId,
    toClientId: transition.toStateId,
    requiredRole: (transition.requiredRole ?? "") as WorkflowTransitionValues["requiredRole"],
    requiresResolution: transition.requiresResolution,
  })));
  const [fromClientId, setFromClientId] = useState(seededStates[0]?.clientId ?? "");
  const [toClientId, setToClientId] = useState(seededStates[1]?.clientId ?? "");
  const [requiredRole, setRequiredRole] = useState<WorkflowTransitionValues["requiredRole"]>("");
  const [requiresResolution, setRequiresResolution] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useUnsavedChanges(dirty && !saving, "Discard this unpublished workflow draft?");

  function updateState(clientId: string, patch: Partial<WorkflowStateValues>) {
    setStates((current) => normalizeStates(current.map((state) => state.clientId === clientId ? { ...state, ...patch } : state)));
    setDirty(true);
  }

  function addState() {
    const clientId = `new:${crypto.randomUUID()}`;
    setStates((current) => normalizeStates([...current, { clientId, name: "New state", category: "OPEN", position: current.length * 10, color: "", isInitial: false, isTerminal: false }]));
    setToClientId(clientId);
    setDirty(true);
  }

  function removeState(clientId: string) {
    if (states.length <= 2) return toast.error("A workflow needs at least two states.");
    setStates((current) => normalizeStates(current.filter((state) => state.clientId !== clientId)));
    setTransitions((current) => current.filter((transition) => transition.fromClientId !== clientId && transition.toClientId !== clientId));
    setDirty(true);
  }

  function moveState(clientId: string, offset: number) {
    setStates((current) => {
      const index = current.findIndex((state) => state.clientId === clientId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return normalizeStates(next);
    });
    setDirty(true);
  }

  function setInitial(clientId: string) {
    setStates((current) => current.map((state) => ({ ...state, isInitial: state.clientId === clientId })));
    setDirty(true);
  }

  function addTransition() {
    if (!fromClientId || !toClientId || fromClientId === toClientId) return toast.error("Choose two different states.");
    if (transitions.some((transition) => transition.fromClientId === fromClientId && transition.toClientId === toClientId)) return toast.error("That transition already exists.");
    setTransitions((current) => [...current, { fromClientId, toClientId, requiredRole, requiresResolution }]);
    setDirty(true);
  }

  async function publish() {
    const result = workflowDefinitionSchema.safeParse({ states, transitions });
    if (!result.success) {
      toast.error(result.error.issues[0]?.message ?? "Check the workflow graph.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await createClient().rpc("replace_project_workflow", {
        p_project_id: projectId,
        p_states: result.data.states.map((state) => ({ ...state, color: state.color || null })),
        p_transitions: result.data.transitions,
      });
      if (error) {
        console.error("Workflow publication failed", { code: error.code, message: error.message });
        toast.error(workflowError(error.message));
        return;
      }
      setDirty(false);
      toast.success("Workflow published atomically.");
      window.location.reload();
    } catch (error) {
      console.error("Unexpected workflow publication failure", { error });
      toast.error("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const stateName = (clientId: string) => states.find((state) => state.clientId === clientId)?.name ?? "Deleted state";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Workflow draft</h3><p className="mt-0.5 text-xs text-muted-foreground">Changes remain local until the complete graph passes validation and is published.</p></div>{canManage && <div className="flex items-center gap-2"><Button size="sm" variant="outline" className="h-8" onClick={addState}><Plus className="h-3.5 w-3.5" />State</Button><Button size="sm" className="h-8" onClick={() => void publish()} disabled={!dirty || saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Publish workflow</Button></div>}</div>
      <Surface className="overflow-x-auto">
        <div className="grid grid-cols-[44px_minmax(120px,1fr)_150px_72px_72px_86px] gap-2 border-b border-border/70 bg-muted/30 px-3 py-2 font-mono text-[9px] uppercase tracking-wide text-muted-foreground"><span>Order</span><span>Name</span><span>Category</span><span>Initial</span><span>Terminal</span><span className="text-right">Actions</span></div>
        <div className="divide-y divide-border/70">{states.map((state, index) => <div key={state.clientId} className="grid grid-cols-[44px_minmax(120px,1fr)_150px_72px_72px_86px] items-center gap-2 px-3 py-2"><div className="flex"><button type="button" aria-label={`Move ${state.name} up`} disabled={!canManage || index === 0} onClick={() => moveState(state.clientId, -1)} className="p-1 text-muted-foreground disabled:opacity-25"><ArrowUp className="h-3 w-3" /></button><button type="button" aria-label={`Move ${state.name} down`} disabled={!canManage || index === states.length - 1} onClick={() => moveState(state.clientId, 1)} className="p-1 text-muted-foreground disabled:opacity-25"><ArrowDown className="h-3 w-3" /></button></div><Input aria-label="State name" className="h-8 text-xs" value={state.name} disabled={!canManage} onChange={(event) => updateState(state.clientId, { name: event.target.value })} /><select aria-label="State category" className={cn("h-8 rounded-md border px-2 text-[10px]", categoryTone[state.category])} value={state.category} disabled={!canManage} onChange={(event) => updateState(state.clientId, { category: event.target.value as WorkflowStateValues["category"] })}>{WORKFLOW_CATEGORIES.map((category) => <option key={category} value={category}>{category.replace("_", " ")}</option>)}</select><input type="radio" name="initial-state" aria-label={`${state.name} is initial`} checked={state.isInitial} disabled={!canManage} onChange={() => setInitial(state.clientId)} /><input type="checkbox" aria-label={`${state.name} is terminal`} checked={state.isTerminal} disabled={!canManage} onChange={(event) => updateState(state.clientId, { isTerminal: event.target.checked })} /><div className="text-right"><Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-destructive" disabled={!canManage || states.length <= 2} onClick={() => removeState(state.clientId)}><Trash2 className="h-3 w-3" /><span className="sr-only">Delete {state.name}</span></Button></div></div>)}</div>
      </Surface>
      <Surface>
        <div className="border-b border-border/70 px-4 py-3"><h3 className="text-sm font-semibold">Transitions</h3><p className="mt-0.5 text-xs text-muted-foreground">Roles are minimum project roles. Resolution can be required independently for each edge.</p></div>
        {canManage && <div className="grid gap-2 border-b border-border/70 bg-muted/20 p-3 sm:grid-cols-[1fr_auto_1fr_150px_auto_auto] sm:items-center"><select aria-label="From state" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={fromClientId} onChange={(event) => setFromClientId(event.target.value)}>{states.map((state) => <option key={state.clientId} value={state.clientId}>{state.name}</option>)}</select><ArrowRight className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" /><select aria-label="To state" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={toClientId} onChange={(event) => setToClientId(event.target.value)}>{states.map((state) => <option key={state.clientId} value={state.clientId}>{state.name}</option>)}</select><select aria-label="Required role" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={requiredRole} onChange={(event) => setRequiredRole(event.target.value as WorkflowTransitionValues["requiredRole"])}>{WORKFLOW_ROLES.map((role) => <option key={role || "any"} value={role}>{role || "Any contributor"}</option>)}</select><label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground"><input type="checkbox" checked={requiresResolution} onChange={(event) => setRequiresResolution(event.target.checked)} />Resolution</label><Button type="button" size="sm" variant="outline" className="h-8" onClick={addTransition}><Plus className="h-3.5 w-3.5" />Add</Button></div>}
        {transitions.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No transitions. Add paths before publishing.</p> : <ul className="divide-y divide-border/70">{transitions.map((transition, index) => <li key={`${transition.fromClientId}-${transition.toClientId}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs"><span>{stateName(transition.fromClientId)}</span><ArrowRight className="h-3 w-3 text-muted-foreground" /><span>{stateName(transition.toClientId)}</span><span className="ml-auto rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{transition.requiredRole || "Any role"}</span>{transition.requiresResolution && <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] uppercase text-amber-600">Resolution required</span>}{canManage && <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-destructive" onClick={() => { setTransitions((current) => current.filter((_, currentIndex) => currentIndex !== index)); setDirty(true); }}><Trash2 className="h-3 w-3" /><span className="sr-only">Delete transition</span></Button>}</li>)}</ul>}
      </Surface>
    </div>
  );
}

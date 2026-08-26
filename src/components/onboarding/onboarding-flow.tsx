"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { TraceMark } from "@/components/tracebox/trace-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getSafeWorkspaceErrorMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { slugify } from "@/lib/utils";
import { projectSchema, workspaceSchema, type ProjectValues, type WorkspaceValues } from "@/lib/validation/workspace";

type Step = "workspace" | "project";

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("workspace");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    document.cookie = `tb_org=${organizationId}; path=/; max-age=31536000; samesite=lax`;
    document.cookie = "tb_project=; path=/; max-age=0; samesite=lax";
  }, [organizationId]);
  const workspaceForm = useForm<WorkspaceValues>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: { name: "", slug: "" },
  });
  const projectForm = useForm<ProjectValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: { name: "", key: "", description: "" },
  });
  const workspaceNameField = workspaceForm.register("name");

  const [workspaceName, setWorkspaceName] = useState("");
  const suggestedSlug = slugify(workspaceName);

  async function submitWorkspace(values: WorkspaceValues) {
    if (organizationId) {
      setStep("project");
      return;
    }
    workspaceForm.clearErrors();
    try {
      const { data, error } = await createClient().rpc("create_organization", { p_name: values.name.trim(), p_slug: values.slug });
      if (error) {
        toast.error(getSafeWorkspaceErrorMessage(error));
        return;
      }
      setOrganizationId(data);
      setStep("project");
    } catch {
      toast.error("Could not reach the server. Please try again.");
    }

  }
  async function submitProject(values: ProjectValues) {
    if (!organizationId) return;
    projectForm.clearErrors();
    try {
      const { error } = await createClient().rpc("create_project", {
        p_organization_id: organizationId,
        p_name: values.name,
        p_key: values.key,
        p_description: values.description ? values.description : undefined,
      });
      if (error) {
        toast.error(getSafeWorkspaceErrorMessage(error));
        return;
      }
      toast.success("Workspace ready.");
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Could not reach the server. Please try again.");
    }

  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2">
          <TraceMark className="h-4 w-4 text-primary" />
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Workspace setup · Step {step === "workspace" ? "1" : "2"} of 2</p>
        </div>
        {step === "workspace" ? (
          <Card className="rounded-[10px] border-border/80 bg-card shadow-xl shadow-black/10">
            <CardHeader className="space-y-2">
              <CardTitle className="text-xl tracking-tight">Create your workspace</CardTitle>
              <CardDescription>A workspace groups your team, projects, and settings.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={workspaceForm.handleSubmit(submitWorkspace)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="workspace-name">Workspace name</Label>
                  <Input id="workspace-name" autoComplete="organization" placeholder="Acme Engineering" {...workspaceNameField} onChange={(event) => { workspaceNameField.onChange(event); setWorkspaceName(event.target.value); }} />
                  {workspaceForm.formState.errors.name && <p className="text-xs text-destructive">{workspaceForm.formState.errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-slug">Workspace URL</Label>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">/</span>
                    <Input id="workspace-slug" className="font-mono" placeholder="acme-engineering" {...workspaceForm.register("slug")} onChange={(event) => { workspaceForm.setValue("slug", event.target.value.toLowerCase(), { shouldValidate: true, shouldDirty: true }); }} onBlur={() => { if (!workspaceForm.getValues("slug") && suggestedSlug) workspaceForm.setValue("slug", suggestedSlug, { shouldValidate: true, shouldDirty: true }); }} />
                  </div>
                  {!workspaceForm.formState.errors.slug && suggestedSlug && <p className="text-xs text-muted-foreground">Suggested: <span className="font-mono">{suggestedSlug}</span></p>}
                  {workspaceForm.formState.errors.slug && <p className="text-xs text-destructive">{workspaceForm.formState.errors.slug.message}</p>}
                </div>
                <Button type="submit" className="w-full" disabled={workspaceForm.formState.isSubmitting}>
                  {workspaceForm.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-[10px] border-border/80 bg-card shadow-xl shadow-black/10">
            <CardHeader className="space-y-2">
              <CardTitle className="text-xl tracking-tight">Create your first project</CardTitle>
              <CardDescription>Issues will be numbered with the project key, like AUTH-1.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={projectForm.handleSubmit(submitProject)} className="space-y-4">
                <div className="grid grid-cols-[1fr_96px] gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="project-name">Project name</Label>
                    <Input id="project-name" placeholder="Authentication Service" {...projectForm.register("name")} />
                    {projectForm.formState.errors.name && <p className="text-xs text-destructive">{projectForm.formState.errors.name.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="project-key">Key</Label>
                    <Input id="project-key" className="font-mono uppercase" placeholder="AUTH" {...projectForm.register("key")} onChange={(event) => { projectForm.setValue("key", event.target.value.toUpperCase(), { shouldValidate: true, shouldDirty: true }); }} />
                    {projectForm.formState.errors.key && <p className="text-xs text-destructive">{projectForm.formState.errors.key.message}</p>}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-description">Description <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="project-description" placeholder="What this project covers" {...projectForm.register("description")} />
                  {projectForm.formState.errors.description && <p className="text-xs text-destructive">{projectForm.formState.errors.description.message}</p>}
                </div>
                <Separator />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setStep("workspace")} disabled={projectForm.formState.isSubmitting}>
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </Button>
                  <Button type="submit" className="flex-1" disabled={projectForm.formState.isSubmitting}>
                    {projectForm.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Finish setup
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

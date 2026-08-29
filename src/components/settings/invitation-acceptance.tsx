"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { selectOrganization, selectProject } from "@/components/layout/workspace-switcher";
import { Surface } from "@/components/tracebox/primitives";
import { createClient } from "@/lib/supabase/client";

export function InvitationAcceptance({ token, authenticated }: { token: string; authenticated: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "accepting" | "accepted" | "error">(authenticated ? "idle" : "error");
  const [message, setMessage] = useState(authenticated ? "Review the invitation and accept it with this account." : "Sign in with the invited email address to continue.");

  async function accept() {
    setState("accepting");
    try {
      const result = await createClient().rpc("accept_organization_invitation_context", { p_token: token });
      if (result.error) {
        const text = result.error.message;
        setState("error");
        setMessage(text.includes("WRONG_ACCOUNT") ? "This invitation belongs to a different email address. Sign out and use the invited account." : text.includes("EXPIRED") ? "This invitation has expired. Ask a workspace administrator for a new link." : text.includes("REVOKED") ? "This invitation was revoked." : text.includes("USED") ? "This invitation has already been accepted." : text.includes("PROJECT_ARCHIVED") ? "This project is archived, so this invitation can no longer be accepted." : text.includes("NOT_FOUND") ? "This invitation is invalid or no longer available." : "We could not accept this invitation. Try again or ask a workspace administrator for a new link.");
        return;
      }
      const context = (Array.isArray(result.data) ? result.data[0] : result.data) as { organization_id?: string; project_id?: string | null } | undefined;
      if (!context?.organization_id) {
        setState("error");
        setMessage("The invitation was accepted, but its workspace context was unavailable. Open TraceBox and choose the workspace manually.");
        return;
      }
      selectOrganization(context.organization_id);
      if (context.project_id) selectProject(context.project_id);
      setState("accepted");
      setMessage(context.project_id ? "You now have access to the invited project. Opening it now." : "You now have access to the workspace. Opening it now.");
      router.push(context.project_id ? "/dashboard/issues" : "/dashboard");
      router.refresh();
    } catch {
      setState("error");
      setMessage("We could not reach the server. Try again.");
    }
  }

  return <Surface className="mx-auto max-w-lg p-8 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">{state === "accepting" ? <Loader2 className="h-5 w-5 animate-spin" /> : state === "accepted" ? <CheckCircle2 className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}</div><h1 className="mt-4 text-xl font-semibold">{state === "accepted" ? "Invitation accepted" : "Workspace invitation"}</h1><p className="mt-2 text-sm text-muted-foreground">{message}</p>{!authenticated && <div className="mt-6 flex justify-center gap-2"><Button onClick={() => router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)}>Sign in</Button><Button variant="outline" onClick={() => router.push(`/signup?next=${encodeURIComponent(`/invite/${token}`)}`)}>Create account</Button></div>}{authenticated && state === "idle" && <Button className="mt-6" onClick={() => void accept()}>Accept invitation</Button>}{state === "accepted" && <Button className="mt-6" onClick={() => { router.push("/dashboard"); router.refresh(); }}>Open TraceBox</Button>}{state === "error" && authenticated && <Button variant="outline" className="mt-6" onClick={() => void accept()}>Try again</Button>}</Surface>;
}

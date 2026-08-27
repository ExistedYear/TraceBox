"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { passwordRecoverySchema, passwordResetSchema } from "@/lib/validation/auth";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = passwordRecoverySchema.safeParse({ email });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Enter a valid email."); return; }
    setBusy(true);
    const { error } = await createClient().auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` });
    setBusy(false);
    if (error) { toast.error("Could not send the reset email. Try again shortly."); return; }
    setSent(true);
  }
  return <Card className="w-full max-w-[420px]"><CardHeader><CardTitle>Reset your password</CardTitle><CardDescription>We will email you a secure reset link. The response is the same whether or not the account exists.</CardDescription></CardHeader><CardContent>{sent ? <div className="space-y-4 text-sm"><p>Check your inbox and follow the link to choose a new password.</p><Button asChild variant="outline" className="w-full"><Link href="/login">Back to login</Link></Button></div> : <form onSubmit={submit} className="space-y-4"><div className="space-y-2"><Label htmlFor="recovery-email">Email</Label><Input id="recovery-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div><Button className="w-full" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send reset link</Button><Button asChild variant="ghost" className="w-full"><Link href="/login">Cancel</Link></Button></form>}</CardContent></Card>;
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = passwordResetSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Check the passwords."); return; }
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: parsed.data.password });
    setBusy(false);
    if (error) { toast.error("This reset link is invalid or expired. Request a new one."); return; }
    toast.success("Password updated.");
    router.push("/dashboard"); router.refresh();
  }
  return <Card className="w-full max-w-[420px]"><CardHeader><CardTitle>Choose a new password</CardTitle><CardDescription>Use at least eight characters.</CardDescription></CardHeader><CardContent><form onSubmit={submit} className="space-y-4"><div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="confirm-new-password">Confirm password</Label><Input id="confirm-new-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div><Button className="w-full" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Update password</Button></form></CardContent></Card>;
}

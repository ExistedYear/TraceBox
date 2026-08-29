"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, KeyRound, Loader2, LogOut, Mail, RefreshCw, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Surface } from "@/components/tracebox/primitives";
import { getSafeAuthErrorMessage } from "@/lib/errors";
import { accountDisplayNameSchema, accountEmailSchema, accountPasswordSchema } from "@/lib/validation/account";
import { createClient } from "@/lib/supabase/client";

const AVATAR_BUCKET = "profile-avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

type AccountManagementProps = {
  userId: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

type FeedbackKind = "success" | "error";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "TB";
}

function storagePathFromUrl(value: string | null | undefined, userId: string) {
  if (!value) return null;
  const marker = "/storage/v1/object/public/profile-avatars/";
  const start = value.indexOf(marker);
  if (start < 0) return null;
  let path: string;
  try {
    path = decodeURIComponent(value.slice(start + marker.length).split("?")[0]);
  } catch {
    return null;
  }
  if (!path.startsWith(`${userId}/`)) return null;
  return path;
}

function avatarExtension(type: string) {
  return type === "image/jpeg" ? "jpg" : type.split("/")[1] ?? "png";
}

export function AccountManagement({ userId, email: initialEmail, displayName: initialDisplayName, avatarUrl: initialAvatarUrl }: AccountManagementProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName ?? initialEmail.split("@")[0] ?? "User");
  const [savedDisplayName, setSavedDisplayName] = useState(initialDisplayName ?? initialEmail.split("@")[0] ?? "User");
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl ?? null);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileMessageKind, setProfileMessageKind] = useState<FeedbackKind | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailMessageKind, setEmailMessageKind] = useState<FeedbackKind | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordMessageKind, setPasswordMessageKind] = useState<FeedbackKind | null>(null);
  const [cleanupPath, setCleanupPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const label = displayName || email.split("@")[0] || "User";

  async function updateProfile(nextName: string, nextAvatarUrl: string | null) {
    const { error } = await createClient().rpc("update_current_profile", {
      p_display_name: nextName,
      p_avatar_url: nextAvatarUrl ?? "",
    });
    return error;
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = accountDisplayNameSchema.safeParse({ displayName });
    if (!parsed.success) {
      setProfileMessageKind("error");
      setProfileMessage(parsed.error.issues[0]?.message ?? "Check your display name.");
      return;
    }
    setProfileBusy(true);
    setProfileMessage(null);
    setProfileMessageKind(null);
    let error;
    try {
      error = await updateProfile(parsed.data.displayName, avatarUrl);
    } catch {
      setProfileBusy(false);
      setProfileMessageKind("error");
      setProfileMessage("We could not reach the server. Please try again.");
      return;
    }
    setProfileBusy(false);
    if (error) {
      console.error("Profile update failed", { code: error.code, message: error.message });
      setProfileMessageKind("error");
      setProfileMessage("We could not save your profile. Please try again.");
      return;
    }
    setDisplayName(parsed.data.displayName);
    setSavedDisplayName(parsed.data.displayName);
    setProfileMessageKind("success");
    setProfileMessage("Profile saved.");
    router.refresh();
  }

  async function uploadAvatar(file: File) {
    const savedName = accountDisplayNameSchema.safeParse({ displayName: savedDisplayName });
    if (!savedName.success) {
      setProfileMessageKind("error");
      setProfileMessage(savedName.error.issues[0]?.message ?? "Save a valid display name before uploading an avatar.");
      return;
    }
    if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
      toast.error("Use a PNG, JPEG, WebP, or GIF image.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("Avatar images must be 5 MB or smaller.");
      return;
    }

    setAvatarBusy(true);
    setProfileMessage(null);
    const path = `${userId}/${crypto.randomUUID()}.${avatarExtension(file.type)}`;
    const oldPath = storagePathFromUrl(avatarUrl, userId);
    let supabase: ReturnType<typeof createClient> | null = null;
    let uploaded = false;
    let profileCommitted = false;
    try {
      supabase = createClient();
      const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
      if (uploadError) {
        console.error("Avatar upload failed", { code: uploadError.name, message: uploadError.message });
        toast.error("We could not upload that avatar. Please try again.");
        return;
      }
      uploaded = true;

      const publicUrl = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
      const profileError = await updateProfile(savedName.data.displayName, publicUrl);
      if (profileError) {
        console.error("Profile avatar update failed", { code: profileError.code, message: profileError.message });
        const { error: cleanupError } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
        if (cleanupError) setCleanupPath(path);
        else uploaded = false;
        toast.error("We could not save that avatar. Your previous image is still active.");
        return;
      }

      uploaded = false;
      profileCommitted = true;
      setAvatarUrl(publicUrl);
      router.refresh();
      if (oldPath && oldPath !== path) {
        const { error: cleanupError } = await supabase.storage.from(AVATAR_BUCKET).remove([oldPath]);
        if (cleanupError) {
          setCleanupPath(oldPath);
          toast.success("Avatar updated. Old image cleanup is pending.");
        } else {
          setCleanupPath(null);
          toast.success("Avatar updated.");
        }
      } else {
        toast.success("Avatar updated.");
      }
    } catch {
      if (profileCommitted) {
        if (oldPath) setCleanupPath(oldPath);
        toast.success(oldPath ? "Avatar updated. Old image cleanup is pending." : "Avatar updated.");
      } else if (uploaded && supabase) {
        try {
          const { error: cleanupError } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
          if (cleanupError) setCleanupPath(path);
        } catch {
          setCleanupPath(path);
        }
        toast.error("We could not reach the server. Please try again.");
      } else {
        toast.error("We could not reach the server. Please try again.");
      }
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    if (!avatarUrl || avatarBusy) return;
    const savedName = accountDisplayNameSchema.safeParse({ displayName: savedDisplayName });
    if (!savedName.success) {
      setProfileMessageKind("error");
      setProfileMessage(savedName.error.issues[0]?.message ?? "Save a valid display name before removing an avatar.");
      return;
    }
    setAvatarBusy(true);
    setProfileMessage(null);
    const oldPath = storagePathFromUrl(avatarUrl, userId);
    let profileCommitted = false;
    try {
      const profileError = await updateProfile(savedName.data.displayName, null);
      if (profileError) {
        console.error("Avatar removal profile update failed", { code: profileError.code, message: profileError.message });
        toast.error("We could not remove your avatar. Please try again.");
        return;
      }

      setAvatarUrl(null);
      profileCommitted = true;
      router.refresh();
      if (oldPath) {
        const { error: cleanupError } = await createClient().storage.from(AVATAR_BUCKET).remove([oldPath]);
        if (cleanupError) {
          setCleanupPath(oldPath);
          toast.success("Avatar removed. Old image cleanup is pending.");
        } else {
          setCleanupPath(null);
          toast.success("Avatar removed.");
        }
      } else {
        toast.success("Avatar removed.");
      }
    } catch {
      if (profileCommitted) {
        if (oldPath) setCleanupPath(oldPath);
        toast.success(oldPath ? "Avatar removed. Old image cleanup is pending." : "Avatar removed.");
      } else {
        toast.error("We could not reach the server. Please try again.");
      }
    } finally {
      setAvatarBusy(false);
    }
  }

  async function retryCleanup() {
    if (!cleanupPath || avatarBusy) return;
    setAvatarBusy(true);
    try {
      const { error } = await createClient().storage.from(AVATAR_BUCKET).remove([cleanupPath]);
      if (error) {
        toast.error("Old avatar cleanup is still unavailable. Try again later.");
        return;
      }
      setCleanupPath(null);
      toast.success("Old avatar cleaned up.");
    } catch {
      toast.error("We could not reach the server. Try cleanup again later.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function changeEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = accountEmailSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailMessageKind("error");
      setEmailMessage(parsed.error.issues[0]?.message ?? "Check your email address.");
      return;
    }
    if (parsed.data.email.toLowerCase() === initialEmail.toLowerCase()) {
      setEmailMessageKind("error");
      setEmailMessage("That is already your current email.");
      return;
    }
    setEmailBusy(true);
    setEmailMessage(null);
    setEmailMessageKind(null);
    let error;
    try {
      ({ error } = await createClient().auth.updateUser({ email: parsed.data.email }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard/account` }));
    } catch {
      setEmailBusy(false);
      setEmailMessageKind("error");
      setEmailMessage("We could not reach the server. Please try again.");
      return;
    }
    setEmailBusy(false);
    if (error) {
      console.error("Email update failed", { code: error.code, message: error.message });
      setEmailMessageKind("error");
      setEmailMessage(getSafeAuthErrorMessage(error.message));
      return;
    }
    setEmailMessageKind("success");
    setEmailMessage("Check your inbox to confirm the new email address.");
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = accountPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      setPasswordMessageKind("error");
      setPasswordMessage(parsed.error.issues[0]?.message ?? "Check your new password.");
      return;
    }
    setPasswordBusy(true);
    setPasswordMessage(null);
    setPasswordMessageKind(null);
    let error;
    try {
      ({ error } = await createClient().auth.updateUser({ password: parsed.data.password }));
    } catch {
      setPasswordBusy(false);
      setPasswordMessageKind("error");
      setPasswordMessage("We could not reach the server. Please try again.");
      return;
    }
    setPasswordBusy(false);
    if (error) {
      console.error("Password update failed", { code: error.code, message: error.message });
      setPasswordMessageKind("error");
      setPasswordMessage(getSafeAuthErrorMessage(error.message));
      return;
    }
    setPassword("");
    setConfirmPassword("");
    setPasswordMessageKind("success");
    setPasswordMessage("Password updated.");
  }

  async function signOutEverywhere() {
    if (!window.confirm("Sign out of every active TraceBox session?")) return;
    setSignOutBusy(true);
    let error;
    try {
      ({ error } = await createClient().auth.signOut({ scope: "global" }));
    } catch {
      setSignOutBusy(false);
      toast.error("We could not reach the server. Please try again.");
      return;
    }
    if (error) {
      console.error("Global sign out failed", { code: error.code, message: error.message });
      setSignOutBusy(false);
      toast.error("We could not sign you out everywhere. Please try again.");
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-[1100px] space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="border-b border-border/80 pb-5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Personal account</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">Account settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage the identity and sign-in methods you use across TraceBox.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <div className="space-y-5">
          <Surface className="p-5 sm:p-6">
            <div className="flex items-start gap-3"><UserRound className="mt-0.5 h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold">Profile identity</h2><p className="mt-1 text-xs text-muted-foreground">This name appears beside your issues, comments, and activity.</p></div></div>
            <form onSubmit={saveProfile} className="mt-5 space-y-4">
              <div className="space-y-2"><Label htmlFor="account-display-name">Display name</Label><Input id="account-display-name" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setProfileMessage(null); setProfileMessageKind(null); }} autoComplete="name" maxLength={120} />{profileMessage && <p role="status" className={`text-xs ${profileMessageKind === "success" ? "text-emerald-400" : "text-destructive"}`}>{profileMessage}</p>}</div>
              <Button type="submit" size="sm" className="h-8" disabled={profileBusy || avatarBusy}>{profileBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save profile</Button>
            </form>
          </Surface>

          <Surface className="p-5 sm:p-6">
            <div className="flex items-start gap-3"><ImagePlus className="mt-0.5 h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold">Profile image</h2><p className="mt-1 text-xs text-muted-foreground">PNG, JPEG, WebP, or GIF · up to 5 MB. Images are public to workspace collaborators.</p></div></div>
            <div className="mt-5 flex flex-wrap items-center gap-4"><Avatar className="h-16 w-16 border border-border/80"><AvatarImage src={avatarUrl ?? undefined} alt="" /><AvatarFallback className="text-lg">{initials(label)}</AvatarFallback></Avatar><div className="flex flex-wrap gap-2"><input ref={fileInputRef} type="file" accept={AVATAR_MIME_TYPES.join(",")} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadAvatar(file); }} /><Button type="button" size="sm" variant="outline" className="h-8" onClick={() => fileInputRef.current?.click()} disabled={avatarBusy}><ImagePlus className="h-3.5 w-3.5" />{avatarUrl ? "Replace image" : "Upload image"}</Button>{avatarUrl && <Button type="button" size="sm" variant="ghost" className="h-8 text-muted-foreground hover:text-destructive" onClick={() => void removeAvatar()} disabled={avatarBusy}><Trash2 className="h-3.5 w-3.5" />Remove</Button>}</div></div>
            {cleanupPath && <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"><span className="flex-1">The previous image still needs cleanup.</span><Button type="button" size="sm" variant="outline" className="h-7 border-amber-500/40 text-xs" onClick={() => void retryCleanup()} disabled={avatarBusy}><RefreshCw className="h-3 w-3" />Retry cleanup</Button></div>}
          </Surface>

          <Surface className="p-5 sm:p-6">
            <div className="flex items-start gap-3"><Mail className="mt-0.5 h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold">Email address</h2><p className="mt-1 text-xs text-muted-foreground">Changing your email requires confirmation from both inboxes when enabled by your Auth settings.</p></div></div>
            <form onSubmit={changeEmail} className="mt-5 space-y-4"><div className="space-y-2"><Label htmlFor="account-email">Email</Label><Input id="account-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setEmailMessage(null); setEmailMessageKind(null); }} autoComplete="email" />{emailMessage && <p role="status" className={`text-xs ${emailMessageKind === "success" ? "text-emerald-400" : "text-destructive"}`}>{emailMessage}</p>}</div><Button type="submit" size="sm" className="h-8" disabled={emailBusy}>{emailBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Change email</Button></form>
          </Surface>
        </div>

        <div className="space-y-5">
          <Surface className="p-5 sm:p-6"><div className="flex items-start gap-3"><KeyRound className="mt-0.5 h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold">Password</h2><p className="mt-1 text-xs text-muted-foreground">Use a long, unique password to protect your account.</p></div></div><form onSubmit={changePassword} className="mt-5 space-y-4"><div className="space-y-2"><Label htmlFor="account-password">New password</Label><Input id="account-password" type="password" value={password} onChange={(event) => { setPassword(event.target.value); setPasswordMessage(null); setPasswordMessageKind(null); }} autoComplete="new-password" /> </div><div className="space-y-2"><Label htmlFor="account-confirm-password">Confirm new password</Label><Input id="account-confirm-password" type="password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setPasswordMessage(null); setPasswordMessageKind(null); }} autoComplete="new-password" />{passwordMessage && <p role="status" className={`text-xs ${passwordMessageKind === "success" ? "text-emerald-400" : "text-destructive"}`}>{passwordMessage}</p>}</div><Button type="submit" size="sm" className="h-8" disabled={passwordBusy}>{passwordBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Update password</Button></form><div className="mt-4 border-t border-border/70 pt-4"><p className="text-xs text-muted-foreground">Can’t sign in?</p><Button asChild variant="link" size="sm" className="h-7 px-0 text-xs"><Link href="/forgot-password">Send a recovery link</Link></Button></div></Surface>
          <Surface className="p-5 sm:p-6"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold">Account controls</h2><p className="mt-1 text-xs text-muted-foreground">Review in-app delivery settings or end every active session.</p></div></div><div className="mt-5 space-y-2"><Button asChild variant="outline" size="sm" className="h-8 w-full justify-start"><Link href="/dashboard/settings/notifications">Manage notification preferences</Link></Button><Button type="button" variant="destructive" size="sm" className="h-8 w-full justify-start" onClick={() => void signOutEverywhere()} disabled={signOutBusy}>{signOutBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}Sign out everywhere</Button></div></Surface>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5 text-emerald-400" /> Authentication changes are handled by Supabase Auth.</p>
    </main>
  );
}

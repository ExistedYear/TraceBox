"use client";

import { useState } from "react";
import { KeyRound, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_TOKEN_PRESETS } from "@/lib/api-scopes";
import { createClient } from "@/lib/supabase/client";

type Token = { id: string; name: string; scopes: string[]; expires_at: string | null; last_used_at: string | null; created_at: string };

async function makeTokenHash(raw: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newRawToken() { return `tbx_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`; }
function dateLabel(value: string | null) { return value ? new Date(value).toLocaleString([], { dateStyle: "medium" }) : "Never"; }
function isFutureExpiry(value: string) { return Date.parse(value) > Date.now(); }

export function ApiTokensManager({ organizationId, initialTokens }: { organizationId: string; initialTokens: Token[] }) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<keyof typeof API_TOKEN_PRESETS>("read");
  const [expiresAt, setExpiresAt] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rotateTarget, setRotateTarget] = useState<Token | null>(null);
  const [rotateExpiry, setRotateExpiry] = useState("");
  const [rotateNever, setRotateNever] = useState(false);

  async function createToken() {
    if (!name.trim() || busy) return;
    if (expiresAt && !isFutureExpiry(`${expiresAt}T23:59:59Z`)) { toast.error("Choose an expiration date in the future."); return; }
    setBusy("create");
    try {
      const raw = newRawToken();
      const { data, error } = await createClient().rpc("create_api_token", { p_organization_id: organizationId, p_name: name.trim(), p_token_hash: await makeTokenHash(raw), p_scopes: [...API_TOKEN_PRESETS[preset]], p_expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59Z`).toISOString() : undefined });
      if (error) { toast.error("Could not create API token. Check your workspace access and try again."); return; }
      setTokens((current) => [{ id: String(data), name: name.trim(), scopes: [...API_TOKEN_PRESETS[preset]], expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59Z`).toISOString() : null, last_used_at: null, created_at: new Date().toISOString() }, ...current]);
      setNewToken(raw); setName(""); setExpiresAt(""); toast.success("Token created. Copy it now; it cannot be shown again.");
    } catch { toast.error("Could not create API token. Please retry."); }
    finally { setBusy(null); }
  }

  async function rotateToken(token: Token, replacementExpiry: string | null) {
    if (busy) return;
    if (!window.confirm("Rotate this token now? The old token will stop working immediately.")) return;
    if (replacementExpiry && !isFutureExpiry(replacementExpiry)) { toast.error("Choose a replacement expiration date in the future."); return; }
    setBusy(token.id);
    try {
      const raw = newRawToken();
      const rotationExpiry = replacementExpiry ?? undefined;
      const { data, error } = await createClient().rpc("rotate_api_token", { p_token_id: token.id, p_token_hash: await makeTokenHash(raw), p_expires_at: rotationExpiry });
      if (error) { toast.error("Could not rotate token. The existing token remains active."); return; }
      setTokens((current) => current.map((item) => item.id === token.id ? { ...item, id: String(data), expires_at: replacementExpiry, last_used_at: null, created_at: new Date().toISOString() } : item));
      setNewToken(raw); setRotateTarget(null); toast.success("Token rotated. Copy the replacement now.");
    } catch { toast.error("Could not rotate token. Please retry."); }
    finally { setBusy(null); }
  }

  async function revokeToken(token: Token) {
    if (busy || !window.confirm(`Revoke ${token.name}? Applications using it will immediately lose access.`)) return;
    setBusy(token.id);
    try {
      const { error } = await createClient().rpc("revoke_api_token", { p_token_id: token.id });
      if (error) { toast.error("Could not revoke token. Please retry."); return; }
      setTokens((current) => current.filter((item) => item.id !== token.id)); toast.success("Token revoked.");
    } catch { toast.error("Could not revoke token. Please retry."); }
    finally { setBusy(null); }
  }

  return <Surface>
    <div className="border-b border-border/80 px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-primary" /> API tokens</h2><p className="mt-1 text-xs text-muted-foreground">Organization-scoped bearer tokens. Access follows your current project memberships; no separate project restriction is stored.</p></div>
    {newToken && <div className="m-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs"><p className="font-semibold text-amber-700 dark:text-amber-200">Copy this token now. It cannot be shown again.</p><code className="mt-2 block break-all font-mono text-amber-900 dark:text-amber-100">{newToken}</code><div className="mt-2 flex gap-2"><Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void navigator.clipboard.writeText(newToken).then(() => toast.success("Token copied."), () => toast.error("Could not copy token. Select and copy it manually."))}>Copy token</Button><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setNewToken(null)}>Dismiss</Button></div></div>}
    {rotateTarget && <div className="m-4 space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3 text-xs"><p className="font-semibold">Rotate {rotateTarget.name}</p><p className="text-muted-foreground">The old token stops working immediately. Choose a future expiration or explicitly choose never.</p><div className="flex flex-wrap items-end gap-3"><div><Label htmlFor="rotate-expiry" className="text-xs">Replacement expires</Label><Input id="rotate-expiry" type="date" min={new Date().toISOString().slice(0, 10)} disabled={rotateNever} value={rotateExpiry} onChange={(event) => setRotateExpiry(event.target.value)} className="mt-1 h-8 text-xs" /></div><label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={rotateNever} onChange={(event) => setRotateNever(event.target.checked)} /> Never expires</label><Button size="sm" className="h-8 text-xs" disabled={!rotateNever && !rotateExpiry || Boolean(busy)} onClick={() => void rotateToken(rotateTarget, rotateNever ? null : new Date(`${rotateExpiry}T23:59:59Z`).toISOString())}>Confirm rotation</Button><Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setRotateTarget(null)}>Cancel</Button></div></div>}
    <div className="grid gap-3 border-b border-border/70 p-4 sm:grid-cols-[1fr_180px_160px_auto] sm:items-end"><div><Label htmlFor="api-token-name" className="text-xs">Token name</Label><Input id="api-token-name" className="mt-1 h-8 text-xs" placeholder="CI automation" value={name} onChange={(event) => setName(event.target.value)} /></div><div><Label htmlFor="api-token-scope" className="text-xs">Scope preset</Label><select id="api-token-scope" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={preset} onChange={(event) => setPreset(event.target.value as keyof typeof API_TOKEN_PRESETS)}><option value="read">Read only</option><option value="contributor">Contributor</option><option value="full">Full API access</option></select></div><div><Label htmlFor="api-token-expiry" className="text-xs">Expires (optional)</Label><Input id="api-token-expiry" type="date" min={new Date().toISOString().slice(0, 10)} className="mt-1 h-8 text-xs" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></div><Button size="sm" className="h-8 text-xs" onClick={() => void createToken()} disabled={!name.trim() || Boolean(busy)}>{busy === "create" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Create token</Button></div>
    <ul className="divide-y divide-border/70">{tokens.length === 0 ? <li className="p-8 text-center text-xs text-muted-foreground">No API tokens.</li> : tokens.map((token) => <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"><div className="min-w-0"><p className="font-medium">{token.name}</p><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{token.scopes.join(", ")}</p><p className="mt-1 text-[10px] text-muted-foreground">Created {dateLabel(token.created_at)} · Expires {dateLabel(token.expires_at)} · Last used {dateLabel(token.last_used_at)}</p></div><div className="flex gap-1"><Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => { setRotateTarget(token); setRotateExpiry(token.expires_at ? token.expires_at.slice(0, 10) : ""); setRotateNever(!token.expires_at); }} disabled={Boolean(busy)}><RefreshCw className="h-3 w-3" />Rotate</Button><Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive" onClick={() => void revokeToken(token)} disabled={Boolean(busy)}><Trash2 className="h-3 w-3" />Revoke</Button></div></li>)}</ul>
    <p className="border-t border-border/70 px-4 py-3 text-[11px] text-muted-foreground">TraceBox retains token creation, expiration, and last-used timestamps only; it does not currently provide usage history, rate-limit guarantees, or a request explorer.</p>
  </Surface>;
}

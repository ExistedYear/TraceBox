"use client";

import { useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type Field = { id: string; name: string; field_type: string; is_required: boolean };
type Token = { id: string; name: string; scopes: string[]; expires_at: string | null; created_at: string };
type Props = { projectId: string; organizationId: string; initialFields: Field[]; initialTokens: Token[] };
const fieldTypes = ["TEXT", "NUMBER", "BOOLEAN", "DATE", "SINGLE_SELECT", "MULTI_SELECT", "USER"];

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function CustomFieldsManager({ projectId, organizationId, initialFields, initialTokens }: Props) {
  const [fields, setFields] = useState(initialFields);
  const [tokens, setTokens] = useState(initialTokens);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState("TEXT");
  const [tokenName, setTokenName] = useState("");
  const [tokenScope, setTokenScope] = useState<"read" | "write" | "read,write">("read");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addField() {
    if (busy || !fieldName.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("create_custom_field", { p_project_id: projectId, p_name: fieldName.trim(), p_field_type: fieldType, p_config: {}, p_is_required: false });
      if (error) { toast.error("Could not create custom field."); return; }
      setFields((current) => [...current, { id: String(data), name: fieldName.trim(), field_type: fieldType, is_required: false }]);
      setFieldName("");
      toast.success("Custom field created.");
    } catch { toast.error("Could not reach the server."); } finally { setBusy(false); }
  }

  async function deleteField(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await createClient().rpc("delete_custom_field", { p_field_id: id });
      if (error) { toast.error("Could not delete custom field."); return; }
      setFields((current) => current.filter((field) => field.id !== id));
    } catch { toast.error("Could not reach the server."); } finally { setBusy(false); }
  }

  async function createToken() {
    if (busy || !tokenName.trim()) return;
    setBusy(true);
    try {
      const raw = `tbx_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
      const tokenHash = await sha256(raw);
      const scopes = tokenScope.split(",") as ("read" | "write")[];
      const { data, error } = await createClient().rpc("create_api_token", { p_organization_id: organizationId, p_name: tokenName.trim(), p_token_hash: tokenHash, p_scopes: scopes });
      if (error) { toast.error("Could not create API token."); return; }
      setTokens((current) => [...current, { id: String(data), name: tokenName.trim(), scopes, expires_at: null, created_at: new Date().toISOString() }]);
      setTokenName("");
      setNewToken(raw);
    } catch { toast.error("Could not create API token."); } finally { setBusy(false); }
  }

  async function revokeToken(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await createClient().rpc("revoke_api_token", { p_token_id: id });
      if (error) { toast.error("Could not revoke API token."); return; }
      setTokens((current) => current.filter((token) => token.id !== id));
    } catch { toast.error("Could not reach the server."); } finally { setBusy(false); }
  }

  return <div className="space-y-8"><section className="space-y-3"><div><h2 className="text-sm font-semibold">Custom fields</h2><p className="text-xs text-muted-foreground">Add project-specific metadata to issues.</p></div><div className="flex gap-2"><Input className="h-8 max-w-xs text-xs" placeholder="field name" aria-label="Custom field name" value={fieldName} onChange={(event) => setFieldName(event.target.value)} /><select aria-label="Custom field type" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={fieldType} onChange={(event) => setFieldType(event.target.value)}>{fieldTypes.map((type) => <option key={type}>{type}</option>)}</select><Button size="sm" className="h-8 gap-1 text-xs" onClick={() => void addField()} disabled={busy}><Plus className="h-3 w-3" /> Add</Button></div><ul className="divide-y divide-border/60 rounded border border-border/70">{fields.length === 0 ? <li className="p-4 text-xs text-muted-foreground">No custom fields.</li> : fields.map((field) => <li key={field.id} className="flex items-center justify-between px-3 py-2 text-xs"><span>{field.name} <span className="font-mono text-[10px] text-muted-foreground">{field.field_type}</span></span><Button variant="ghost" size="sm" className="h-6 px-1.5 text-muted-foreground hover:text-destructive" onClick={() => void deleteField(field.id)} disabled={busy} aria-label={`Delete ${field.name}`}><Trash2 className="h-3 w-3" /></Button></li>)}</ul></section><section className="space-y-3 border-t border-border/70 pt-6"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-primary" /> API tokens</h2><p className="text-xs text-muted-foreground">Tokens are shown once. Store them in a password manager.</p></div><div className="flex flex-wrap gap-2"><Input className="h-8 max-w-xs text-xs" placeholder="token name" aria-label="API token name" value={tokenName} onChange={(event) => setTokenName(event.target.value)} /><select aria-label="API token scope" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={tokenScope} onChange={(event) => setTokenScope(event.target.value as typeof tokenScope)}><option value="read">Read only</option><option value="write">Write only</option><option value="read,write">Read + write</option></select><Button size="sm" className="h-8 text-xs" onClick={() => void createToken()} disabled={busy}>Create token</Button></div>{newToken && <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 font-mono text-xs text-amber-200"><p className="mb-1 font-sans font-semibold">Copy this token now. It cannot be shown again.</p><code className="break-all">{newToken}</code><Button variant="ghost" size="sm" className="mt-2 h-6 text-xs" onClick={() => setNewToken(null)}>Dismiss</Button></div>}<ul className="divide-y divide-border/60 rounded border border-border/70">{tokens.length === 0 ? <li className="p-4 text-xs text-muted-foreground">No API tokens.</li> : tokens.map((token) => <li key={token.id} className="flex items-center justify-between px-3 py-2 text-xs"><span>{token.name} <span className="ml-1 font-mono text-[10px] text-muted-foreground">{token.scopes.join(", ")}</span></span><Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-destructive" onClick={() => void revokeToken(token.id)} disabled={busy}>Revoke</Button></li>)}</ul></section></div>;
}

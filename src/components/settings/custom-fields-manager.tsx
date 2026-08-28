"use client";

import { useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { humanizeEnum } from "@/lib/issues";
import { API_TOKEN_PRESETS } from "@/lib/api-scopes";
import { createClient } from "@/lib/supabase/client";

type Field = { id: string; name: string; field_type: string; config: Record<string, unknown>; is_required: boolean };
type Token = { id: string; name: string; scopes: string[]; expires_at: string | null; created_at: string };
type Props = { projectId: string; organizationId: string; canManage: boolean; initialFields: Field[]; initialTokens: Token[] };
const fieldTypes = ["TEXT", "NUMBER", "BOOLEAN", "DATE", "SINGLE_SELECT", "MULTI_SELECT", "USER"];
const tokenPresets = API_TOKEN_PRESETS;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function CustomFieldsManager({ projectId, organizationId, canManage, initialFields, initialTokens }: Props) {
  const [fields, setFields] = useState(initialFields);
  const [tokens, setTokens] = useState(initialTokens);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState("TEXT");
  const [fieldOptions, setFieldOptions] = useState("");
  const [fieldRequired, setFieldRequired] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenPreset, setTokenPreset] = useState<keyof typeof tokenPresets>("read");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsOptions = fieldType === "SINGLE_SELECT" || fieldType === "MULTI_SELECT";

  async function addField() {
    if (busy || !fieldName.trim() || !canManage) return;
    const options = fieldOptions.split(",").map((item) => item.trim()).filter(Boolean);
    if (needsOptions && options.length === 0) { toast.error("Add at least one comma-separated option."); return; }
    const config = needsOptions ? { options: [...new Set(options)] } : {};
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("create_custom_field", { p_project_id: projectId, p_name: fieldName.trim(), p_field_type: fieldType, p_config: config, p_is_required: fieldRequired });
      if (error) { toast.error("Could not create custom field."); return; }
      setFields((current) => [...current, { id: String(data), name: fieldName.trim(), field_type: fieldType, config, is_required: fieldRequired }]);
      setFieldName(""); setFieldOptions(""); setFieldRequired(false);
      toast.success("Custom field created.");
    } catch { toast.error("Could not reach the server."); } finally { setBusy(false); }
  }

  async function deleteField(id: string) {
    if (busy || !canManage || !window.confirm("Delete this custom field and all of its issue values?")) return;
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
      const scopes = [...tokenPresets[tokenPreset]];
      const { data, error } = await createClient().rpc("create_api_token", { p_organization_id: organizationId, p_name: tokenName.trim(), p_token_hash: tokenHash, p_scopes: scopes });
      if (error) { toast.error("Could not create API token."); return; }
      setTokens((current) => [...current, { id: String(data), name: tokenName.trim(), scopes, expires_at: null, created_at: new Date().toISOString() }]);
      setTokenName(""); setNewToken(raw);
    } catch { toast.error("Could not create API token."); } finally { setBusy(false); }
  }

  async function revokeToken(id: string) {
    if (busy || !window.confirm("Revoke this API token? Applications using it will immediately lose access.")) return;
    setBusy(true);
    try {
      const { error } = await createClient().rpc("revoke_api_token", { p_token_id: id });
      if (error) { toast.error("Could not revoke API token."); return; }
      setTokens((current) => current.filter((token) => token.id !== id));
    } catch { toast.error("Could not reach the server."); } finally { setBusy(false); }
  }

  return <div className="space-y-5">
    <Surface>
      <div className="flex items-center justify-between gap-3 border-b border-border/80 px-4 py-3"><div><h2 className="text-sm font-semibold">Custom fields</h2><p className="mt-0.5 text-xs text-muted-foreground">Add typed project-specific metadata to issues.</p></div><span className="font-mono text-[10px] text-muted-foreground">{fields.length} fields</span></div>
      {canManage ? <div className="grid items-end gap-3 border-b border-border/70 p-4 sm:grid-cols-[minmax(180px,1fr)_170px_auto]">
        <div><Label htmlFor="custom-field-name" className="text-xs">Field name</Label><Input id="custom-field-name" className="mt-1 h-8 text-xs" placeholder="Customer impact" value={fieldName} onChange={(event) => setFieldName(event.target.value)} /></div>
        <div><Label htmlFor="custom-field-type" className="text-xs">Field type</Label><select id="custom-field-type" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={fieldType} onChange={(event) => setFieldType(event.target.value)}>{fieldTypes.map((type) => <option key={type} value={type}>{humanizeEnum(type)}</option>)}</select></div>
        <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => void addField()} disabled={busy}><Plus className="h-3 w-3" /> Add field</Button>
        {needsOptions && <div className="sm:col-span-2"><Label htmlFor="custom-field-options" className="text-xs">Select options</Label><Input id="custom-field-options" className="mt-1 h-8 text-xs" placeholder="High, Medium, Low" value={fieldOptions} onChange={(event) => setFieldOptions(event.target.value)} /></div>}
        <label className="flex h-8 items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={fieldRequired} onChange={(event) => setFieldRequired(event.target.checked)} /> Required on issues</label>
      </div> : <p className="border-b border-border/70 p-4 text-xs text-muted-foreground">Only project maintainers can manage custom fields.</p>}
      <ul className="divide-y divide-border/70">{fields.length === 0 ? <li className="p-8 text-center text-xs text-muted-foreground">No custom fields configured.</li> : fields.map((field) => <li key={field.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"><span className="min-w-0"><span className="font-medium">{field.name}</span>{field.is_required && <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-amber-600 dark:text-amber-300">required</span>}<span className="ml-2 text-[10px] text-muted-foreground">{humanizeEnum(field.field_type)}</span></span>{canManage && <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => void deleteField(field.id)} disabled={busy} aria-label={`Delete ${field.name}`}><Trash2 className="h-3 w-3" /></Button>}</li>)}</ul>
    </Surface>

    <Surface>
      <div className="flex items-center justify-between gap-3 border-b border-border/80 px-4 py-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-primary" /> API tokens</h2><p className="mt-0.5 text-xs text-muted-foreground">Tokens are shown once. Store them in a password manager.</p></div><span className="font-mono text-[10px] text-muted-foreground">{tokens.length} active</span></div>
      <div className="grid items-end gap-3 border-b border-border/70 p-4 sm:grid-cols-[minmax(180px,1fr)_190px_auto]">
        <div><Label htmlFor="api-token-name" className="text-xs">Token name</Label><Input id="api-token-name" className="mt-1 h-8 text-xs" placeholder="CI automation" value={tokenName} onChange={(event) => setTokenName(event.target.value)} /></div>
        <div><Label htmlFor="api-token-scope" className="text-xs">Access preset</Label><select id="api-token-scope" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={tokenPreset} onChange={(event) => setTokenPreset(event.target.value as keyof typeof tokenPresets)}><option value="read">Read only</option><option value="contributor">Issue contributor</option><option value="full">All current API scopes</option></select></div>
        <Button size="sm" className="h-8 text-xs" onClick={() => void createToken()} disabled={busy}>Create token</Button>
      </div>
      {newToken && <div className="m-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 font-mono text-xs text-amber-700 dark:text-amber-200"><p className="mb-1 font-sans font-semibold">Copy this token now. It cannot be shown again.</p><code className="break-all">{newToken}</code><Button variant="ghost" size="sm" className="mt-2 h-6 text-xs" onClick={() => setNewToken(null)}>Dismiss</Button></div>}
      <ul className="divide-y divide-border/70">{tokens.length === 0 ? <li className="p-8 text-center text-xs text-muted-foreground">No API tokens.</li> : tokens.map((token) => <li key={token.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"><span className="min-w-0"><span className="font-medium">{token.name}</span><span className="ml-2 break-all font-mono text-[9px] text-muted-foreground">{token.scopes.join(", ")}</span></span><Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-destructive" onClick={() => void revokeToken(token.id)} disabled={busy}>Revoke</Button></li>)}</ul>
    </Surface>
  </div>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { formatShortDate } from "@/lib/date-format";
import { useRealtimeSubscription } from "@/hooks/use-realtime";

const ALLOWED_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml",
  "text/plain", "text/csv", "text/markdown", "application/json", "application/pdf",
  "application/zip", "application/gzip", "application/x-tar",
]);

export type AttachmentItem = {
  id: string;
  issue_id: string;
  uploader_id: string;
  filename: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
  uploader_name?: string | null;
};

type Props = {
  issueId: string;
  canUpload: boolean;
  currentUserId: string;
  isMaintainerOrDev: boolean;
  initialAttachments: AttachmentItem[];
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileIcon(mimeType: string | null, filename: string) {
  if (mimeType?.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(filename)) {
    return <FileImage className="h-4 w-4 text-blue-400" />;
  }
  if (mimeType?.includes("json") || mimeType?.includes("javascript") || /\.(ts|js|py|rs|go|sql|json)$/i.test(filename)) {
    return <FileCode className="h-4 w-4 text-emerald-400" />;
  }
  if (mimeType?.includes("zip") || mimeType?.includes("tar") || /\.(zip|tar|gz|7z)$/i.test(filename)) {
    return <FileArchive className="h-4 w-4 text-amber-400" />;
  }
  if (mimeType?.includes("text") || /\.(txt|log|md|csv)$/i.test(filename)) {
    return <FileText className="h-4 w-4 text-purple-400" />;
  }
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function uploadObject(path: string, file: File, accessToken: string, onProgress: (value: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/issue-attachments/${path}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("storage_upload_failed"));
    xhr.onerror = () => reject(new Error("storage_upload_failed"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export function IssueAttachmentsSection({
  issueId,
  canUpload,
  currentUserId,
  isMaintainerOrDev,
  initialAttachments,
}: Props) {
  const [attachments, setAttachments] = useState<AttachmentItem[]>(initialAttachments);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<Array<{ id: string; file: File; progress: number; status: "uploading" | "failed" | "done"; error?: string }>>([]);
  const uploadControllers = useRef(new Map<string, AbortController>());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Realtime subscription for attachments
  useRealtimeSubscription({
    table: "attachments",
    filter: `issue_id=eq.${issueId}`,
    onInsert: (payload: any) => {
      const item = payload as AttachmentItem;
      setAttachments((prev) => (prev.some((a) => a.id === item.id) ? prev : [...prev, item]));
    },
    onDelete: (payload: any) => {
      const item = payload as AttachmentItem;
      setAttachments((prev) => prev.filter((a) => a.id !== item.id));
    },
    onError: () => toast.error("Live attachment updates are unavailable. Refresh to see changes."),
    enabled: Boolean(issueId),
  });

  const handleUpload = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    const oversized = selected.filter((file) => file.size > 52428800);
    if (oversized.length) { toast.error(`${oversized.map((file) => file.name).join(", ")} exceeded the 50MB limit.`); return; }
    const unsupported = selected.filter((file) => !ALLOWED_MIME_TYPES.has(file.type));
    if (unsupported.length) { toast.error(`Unsupported file type: ${unsupported.map((file) => file.name).join(", ")}.`); return; }
    const tasks = selected.map((file) => ({ id: crypto.randomUUID(), file, progress: 0, status: "uploading" as const }));
    setUploadTasks(tasks);
    setUploading(true);
    let uploaded = 0;
    try {
      const supabase = createClient();
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (sessionError || !accessToken) throw new Error("Attachment session unavailable");
      for (const task of tasks) {
        const file = task.file;
        const extension = file.name.includes(".") ? `.${file.name.split(".").pop()}` : "";
        const storagePath = `${issueId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`;
        const controller = new AbortController();
        uploadControllers.current.set(task.id, controller);
        try { await uploadObject(storagePath, file, accessToken, (progress) => setUploadTasks((current) => current.map((item) => item.id === task.id ? { ...item, progress } : item)), controller.signal); }
        catch (error) { setUploadTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: "failed", error: error instanceof DOMException ? "Cancelled" : "Upload failed" } : item)); continue; }
        finally { uploadControllers.current.delete(task.id); }
        let attachmentId: string | null = null;
        try {
          const result = await supabase.rpc("add_attachment", { p_issue_id: issueId, p_filename: file.name, p_storage_path: storagePath, p_mime_type: file.type, p_size_bytes: file.size });
          if (result.error || !result.data) throw result.error ?? new Error("Attachment registration returned no ID");
          attachmentId = String(result.data);
        } catch {
          try { await supabase.storage.from("issue-attachments").remove([storagePath]); } catch { /* The reconciliation job removes unregistered objects. */ }
          setUploadTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: "failed", error: "Could not register" } : item));
          continue;
        }
        setUploadTasks((current) => current.map((item) => item.id === task.id ? { ...item, progress: 100, status: "done" } : item));
        setAttachments((previous) => [...previous, { id: attachmentId, issue_id: issueId, uploader_id: currentUserId, filename: file.name, storage_path: storagePath, mime_type: file.type || null, size_bytes: file.size, created_at: new Date().toISOString() }]);
        uploaded++;
      }
      if (uploaded) toast.success(`${uploaded} attachment${uploaded === 1 ? "" : "s"} uploaded.`);
    } catch { toast.error("Could not upload attachments. Please try again."); } finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const retryUpload = (task: (typeof uploadTasks)[number]) => { void handleUpload([task.file]); };

  const handleDownload = async (attachment: AttachmentItem) => {
    const downloadWindow = window.open("", "_blank");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from("issue-attachments")
        .createSignedUrl(attachment.storage_path, 300);

      if (error || !data?.signedUrl) {
        downloadWindow?.close();
        toast.error("Could not generate download link.");
        return;
      }
      if (downloadWindow) downloadWindow.location.href = data.signedUrl;
      else window.location.href = data.signedUrl;
    } catch {
      downloadWindow?.close();
      toast.error("Could not generate download link.");
    }
  };

  const handlePreviewImage = async (attachment: AttachmentItem) => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from("issue-attachments")
        .createSignedUrl(attachment.storage_path, 300);

      if (error || !data?.signedUrl) { toast.error("Could not preview image."); return; }
      setPreviewUrl(data.signedUrl);
      setPreviewTitle(attachment.filename);
    } catch {
      toast.error("Could not preview image.");
    }
  };

  const handleDelete = async (attachmentId: string) => {
    if (!window.confirm("Remove this attachment?")) return;
    const attachment = attachments.find((item) => item.id === attachmentId);
    try {
      const { error } = await createClient().rpc("delete_attachment", {
        p_attachment_id: attachmentId,
      });

      if (error) {
        toast.error("Could not delete attachment.");
        return;
      }

      if (attachment) {
        const { error: storageError } = await createClient().storage.from("issue-attachments").remove([attachment.storage_path]);
        if (storageError) {
          toast.error("Attachment record deleted, but the Storage object could not be removed. It will be cleaned up automatically.");
        }
      }
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      toast.success("Attachment deleted.");
    } catch {
      toast.error("Could not reach server.");
    }
  };

  return (
    <div
      className={dragActive ? "rounded-[10px] ring-2 ring-primary/70" : undefined}
      onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false); }}
      onDrop={(event) => { event.preventDefault(); setDragActive(false); void handleUpload(event.dataTransfer.files); }}
    >
    <Surface>
      <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Attachments
          </h2>
          <span className="rounded-full border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            {attachments.length}
          </span>
        </div>

        {canUpload && (
          <div>
            <input
              type="file"
              multiple
              ref={fileInputRef}
              className="hidden"
              onChange={(e) => void handleUpload(e.target.files)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <UploadCloud className="h-3 w-3" />}
              Upload files
            </Button>
          </div>
        )}
      </div>

      {canUpload && <div role="region" aria-label="Attachment drop zone" className={`mx-4 mb-3 rounded-md border border-dashed px-3 py-2 text-center text-[11px] transition-colors ${dragActive ? "border-primary bg-primary/10 text-foreground" : "border-border/80 text-muted-foreground"}`}><UploadCloud className="mx-auto mb-1 h-4 w-4" aria-hidden="true" /><p>{dragActive ? "Drop files to upload" : "Drag and drop files here, or use Upload files"}</p><p className="mt-0.5 text-[10px] text-muted-foreground/70">Allowed images, text, JSON, PDF, and archives · 50MB per file</p></div>}

      {uploadTasks.length > 0 && <div className="space-y-2 border-b border-border/70 px-4 py-3" aria-live="polite">{uploadTasks.map((task) => <div key={task.id} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate">{task.file.name}</span>{task.status === "uploading" && <><progress className="h-1.5 w-24" max={100} value={task.progress} aria-label={`Uploading ${task.file.name}`} /><Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => uploadControllers.current.get(task.id)?.abort()}>Cancel</Button></>}{task.status === "failed" && <><span className="text-destructive">{task.error}</span><Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => retryUpload(task)}>Retry</Button></>}{task.status === "done" && <span className="text-emerald-500">Done</span>}</div>)}</div>}

      {attachments.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-xs text-muted-foreground">No files attached to this issue.</p>
          {canUpload && (
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              Attach screenshots, log files, stack traces, or reproduction artifacts (up to 50MB).
            </p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {attachments.map((att) => {
            const isImage = att.mime_type?.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(att.filename);
            const canDelete = att.uploader_id === currentUserId || isMaintainerOrDev;

            return (
              <li key={att.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs">
                <div className="flex min-w-0 flex-1 basis-40 items-center gap-2.5">
                  {getFileIcon(att.mime_type, att.filename)}
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{att.filename}</p>
                    <p className="font-mono text-[10px] text-muted-foreground/70">
                      {formatBytes(att.size_bytes)} · {formatShortDate(att.created_at)}
                    </p>
                  </div>
                </div>

                <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
                  {isImage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => void handlePreviewImage(att)}
                    >
                      <ImageIcon className="h-3 w-3" /> Preview
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => void handleDownload(att)}
                  >
                    <Download className="h-3 w-3" /> Download
                  </Button>
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-muted-foreground hover:text-destructive"
                      onClick={() => void handleDelete(att.id)}
                      title="Remove attachment"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Image Lightbox Modal */}
      <Dialog open={Boolean(previewUrl)} onOpenChange={(open) => !open && setPreviewUrl(null)}>
        <DialogContent className="max-w-3xl p-2">
          <DialogTitle className="px-3 pt-2 text-xs font-mono">{previewTitle}</DialogTitle>
          {previewUrl && (
            <div className="flex max-h-[75vh] items-center justify-center overflow-auto rounded bg-black/80 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt={previewTitle} className="max-h-full max-w-full object-contain" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Surface>
    </div>
  );
}

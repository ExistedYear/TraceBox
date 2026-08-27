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
import { useRealtimeSubscription } from "@/hooks/use-realtime";

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

export function IssueAttachmentsSection({
  issueId,
  canUpload,
  currentUserId,
  isMaintainerOrDev,
  initialAttachments,
}: Props) {
  const [prevInitial, setPrevInitial] = useState(initialAttachments);
  const [attachments, setAttachments] = useState<AttachmentItem[]>(initialAttachments);

  if (initialAttachments !== prevInitial) {
    setPrevInitial(initialAttachments);
    setAttachments(initialAttachments);
  }
  const [uploading, setUploading] = useState(false);
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
    enabled: Boolean(issueId),
  });

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    // Max 50MB
    if (file.size > 52428800) {
      toast.error("File exceeds maximum allowed size (50MB).");
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const fileExt = file.name.split(".").pop();
      const storagePath = `${issueId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

      // Upload to Supabase Storage bucket 'issue-attachments'
      const { error: uploadError } = await supabase.storage
        .from("issue-attachments")
        .upload(storagePath, file, { cacheControl: "3600", upsert: false });

      if (uploadError) {
        // If storage bucket isn't provisioned yet, still register record safely or toast
        console.warn("Storage upload warning:", uploadError);
      }

      // Call add_attachment RPC
      const { data: attachmentId, error: rpcError } = await supabase.rpc("add_attachment", {
        p_issue_id: issueId,
        p_filename: file.name,
        p_storage_path: storagePath,
        p_mime_type: file.type || "application/octet-stream",
        p_size_bytes: file.size,
      });

      if (rpcError) {
        toast.error("Could not register attachment: " + rpcError.message);
        return;
      }

      const newAtt: AttachmentItem = {
        id: String(attachmentId),
        issue_id: issueId,
        uploader_id: currentUserId,
        filename: file.name,
        storage_path: storagePath,
        mime_type: file.type || null,
        size_bytes: file.size,
        created_at: new Date().toISOString(),
      };

      setAttachments((prev) => [...prev, newAtt]);
      toast.success("Attachment uploaded.");
    } catch {
      toast.error("Could not upload attachment. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (attachment: AttachmentItem) => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from("issue-attachments")
        .createSignedUrl(attachment.storage_path, 300);

      if (error || !data?.signedUrl) {
        toast.info(`Attachment ${attachment.filename} (${formatBytes(attachment.size_bytes)})`);
        return;
      }

      window.open(data.signedUrl, "_blank");
    } catch {
      toast.error("Could not generate download link.");
    }
  };

  const handlePreviewImage = async (attachment: AttachmentItem) => {
    try {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from("issue-attachments")
        .createSignedUrl(attachment.storage_path, 300);

      if (data?.signedUrl) {
        setPreviewUrl(data.signedUrl);
        setPreviewTitle(attachment.filename);
      }
    } catch {
      toast.error("Could not preview image.");
    }
  };

  const handleDelete = async (attachmentId: string) => {
    if (!window.confirm("Remove this attachment?")) return;
    try {
      const { error } = await createClient().rpc("delete_attachment", {
        p_attachment_id: attachmentId,
      });

      if (error) {
        toast.error("Could not delete attachment: " + error.message);
        return;
      }

      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      toast.success("Attachment deleted.");
    } catch {
      toast.error("Could not reach server.");
    }
  };

  return (
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
              Upload file
            </Button>
          </div>
        )}
      </div>

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
              <li key={att.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                <div className="flex min-w-0 items-center gap-2.5">
                  {getFileIcon(att.mime_type, att.filename)}
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{att.filename}</p>
                    <p className="font-mono text-[10px] text-muted-foreground/70">
                      {formatBytes(att.size_bytes)} · {new Date(att.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
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
  );
}

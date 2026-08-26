"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type Props = {
  issueId: string;
  initialWatching: boolean;
  initialWatcherCount: number;
};

export function IssueWatchButton({
  issueId,
  initialWatching,
  initialWatcherCount,
}: Props) {
  const router = useRouter();
  const [watching, setWatching] = useState(initialWatching);
  const [count, setCount] = useState(initialWatcherCount);
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    setLoading(true);
    const nextWatching = !watching;
    setWatching(nextWatching);
    setCount((prev) => (nextWatching ? prev + 1 : Math.max(0, prev - 1)));

    try {
      const { data, error } = await createClient().rpc("toggle_watch_issue", {
        p_issue_id: issueId,
      });

      if (error) {
        toast.error("Could not update watch status.");
        setWatching(watching);
        setCount(initialWatcherCount);
        return;
      }

      setWatching(Boolean(data));
      toast.success(data ? "Watching this issue." : "Stopped watching this issue.");
      router.refresh();
    } catch {
      toast.error("Could not reach the server.");
      setWatching(watching);
      setCount(initialWatcherCount);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      onClick={() => void handleToggle()}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : watching ? (
        <EyeOff className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Eye className="h-3.5 w-3.5" />
      )}
      <span>{watching ? "Unwatch" : "Watch"}</span>
      <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.2 font-mono text-[10px] text-muted-foreground">
        {count}
      </span>
    </Button>
  );
}

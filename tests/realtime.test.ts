/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = { channel: vi.fn(), removeChannel: vi.fn() };
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));

type Handler = (payload: { new?: unknown; old?: unknown }) => void;
function makeChannel() {
  const handlers = new Map<string, Handler>();
  let statusCallback: ((status: string) => void) | undefined;
  const channel = {
    on: vi.fn((_kind: string, options: { event: string }, callback: Handler) => { handlers.set(options.event, callback); return channel; }),
    subscribe: vi.fn((callback: (status: string) => void) => { statusCallback = callback; return channel; }),
    emit(event: string, payload: { new?: unknown; old?: unknown }) { handlers.get(event)?.(payload); },
    status(status: string) { statusCallback?.(status); },
  };
  return channel;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => "stable-id" });
});

describe("rendered realtime subscriptions", () => {
  it("subscribes with the table/filter payload and routes row events", async () => {
    const channel = makeChannel(); client.channel.mockReturnValue(channel);
    const inserted = vi.fn(); const updated = vi.fn(); const deleted = vi.fn();
    const { useRealtimeSubscription } = await import("@/hooks/use-realtime");
    renderHook(() => useRealtimeSubscription({ table: "comments", filter: "issue_id=eq.issue-1", onInsert: inserted, onUpdate: updated, onDelete: deleted }));
    expect(client.channel).toHaveBeenCalledWith("realtime:comments:issue_id=eq.issue-1:stable-id");
    expect(channel.on).toHaveBeenNthCalledWith(1, "postgres_changes", expect.objectContaining({ event: "INSERT", schema: "public", table: "comments", filter: "issue_id=eq.issue-1" }), expect.any(Function));
    channel.emit("INSERT", { new: { id: "c1" } }); channel.emit("UPDATE", { new: { id: "c1", body: "edited" } }); channel.emit("DELETE", { old: { id: "c1" } });
    expect(inserted).toHaveBeenCalledWith({ id: "c1" }); expect(updated).toHaveBeenCalledWith({ id: "c1", body: "edited" }); expect(deleted).toHaveBeenCalledWith({ id: "c1" });
  });

  it("reports disconnects, reconnects, and removes the channel on unmount", async () => {
    const channel = makeChannel(); client.channel.mockReturnValue(channel); const onError = vi.fn(); const onReconnect = vi.fn();
    const { useRealtimeSubscription } = await import("@/hooks/use-realtime");
    const rendered = renderHook(() => useRealtimeSubscription({ table: "issues", filter: "project_id=eq.project-1", onError, onReconnect }));
    act(() => channel.status("CHANNEL_ERROR")); act(() => channel.status("SUBSCRIBED"));
    expect(onError).toHaveBeenCalledOnce(); expect(onReconnect).toHaveBeenCalledOnce(); rendered.unmount(); expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("cleans up and resubscribes when project/filter changes", async () => {
    const first = makeChannel(); const second = makeChannel(); const updated = vi.fn(); client.channel.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { useRealtimeSubscription } = await import("@/hooks/use-realtime");
    const rendered = renderHook(({ project }) => useRealtimeSubscription({ table: "issues", filter: `project_id=eq.${project}`, onUpdate: updated }), { initialProps: { project: "one" } });
    rendered.rerender({ project: "two" }); expect(client.removeChannel).toHaveBeenCalledWith(first); expect(client.channel).toHaveBeenNthCalledWith(2, "realtime:issues:project_id=eq.two:stable-id");
    first.emit("UPDATE", { new: "stale" }); second.emit("UPDATE", { new: "fresh" }); expect(updated).toHaveBeenCalledOnce(); expect(updated).toHaveBeenCalledWith("fresh");
    rendered.unmount(); second.emit("UPDATE", { new: "disposed" }); expect(updated).toHaveBeenCalledOnce(); expect(client.removeChannel).toHaveBeenCalledWith(second);
  });

  it("does not subscribe while disabled and avoids stale callbacks", async () => {
    const channel = makeChannel(); client.channel.mockReturnValue(channel); const first = vi.fn(); const second = vi.fn();
    const { useRealtimeSubscription } = await import("@/hooks/use-realtime");
    const rendered = renderHook(({ callback, enabled }) => useRealtimeSubscription({ table: "comments", filter: "all", onInsert: callback, enabled }), { initialProps: { callback: first, enabled: false } });
    expect(client.channel).not.toHaveBeenCalled(); rendered.rerender({ callback: second, enabled: true }); channel.emit("INSERT", { new: "fresh" }); expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledWith("fresh");
  });
});

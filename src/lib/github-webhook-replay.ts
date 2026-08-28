import { MAX_GITHUB_WEBHOOK_ATTEMPTS, processGithubWebhookDelivery } from "@/lib/github-webhook-processor";

export async function replayGithubWebhookDeliveries(admin: any, limit = 25) {
  const now = Date.now();
  const staleBefore = new Date(now - 5 * 60 * 1000).toISOString();
  const [{ data: pending }, { data: stale }] = await Promise.all([
    admin.from("github_webhook_deliveries").select("delivery_id, next_retry_at, attempt_count").in("status", ["RECEIVED", "FAILED"]).lt("attempt_count", MAX_GITHUB_WEBHOOK_ATTEMPTS).order("received_at").limit(limit),
    admin.from("github_webhook_deliveries").select("delivery_id").eq("status", "PROCESSING").lt("processing_started_at", staleBefore).order("received_at").limit(limit),
  ]);
  const deliveryIds = [...(pending ?? []).filter((delivery: { next_retry_at: string | null }) => !delivery.next_retry_at || new Date(delivery.next_retry_at).getTime() <= now).map((delivery: { delivery_id: string }) => delivery.delivery_id), ...(stale ?? []).map((delivery: { delivery_id: string }) => delivery.delivery_id)].slice(0, limit);
  let processed = 0;
  for (const deliveryId of deliveryIds) if (await processGithubWebhookDelivery(deliveryId)) processed += 1;
  return { attempted: deliveryIds.length, processed };
}

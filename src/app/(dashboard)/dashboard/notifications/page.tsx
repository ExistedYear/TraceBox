import type { Metadata } from "next";

import { NotificationsInbox } from "@/components/notifications/notifications-inbox";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return <main className="mx-auto max-w-[1100px] p-4 sm:p-6 lg:p-8"><NotificationsInbox /></main>;
}


import type { Metadata } from "next";

import { NotificationPreferences } from "@/components/settings/notification-preferences";

export const metadata: Metadata = { title: "Notification preferences" };

export default function NotificationPreferencesPage() {
  return <NotificationPreferences />;
}


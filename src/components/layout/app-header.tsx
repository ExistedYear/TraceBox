import { MobileSidebar } from "@/components/layout/app-sidebar";
import { UserMenu } from "@/components/layout/user-menu";

type AppHeaderProps = { email: string; displayName?: string | null; avatarUrl?: string | null };

export function AppHeader({ email, displayName, avatarUrl }: AppHeaderProps) {
  return <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-6"><div className="flex items-center gap-3"><MobileSidebar /><div className="md:hidden"><span className="text-sm font-semibold">TraceBox</span></div><div className="hidden text-sm text-muted-foreground md:block">Workspace <span className="mx-2 text-border">/</span> Dashboard</div></div><UserMenu email={email} displayName={displayName} avatarUrl={avatarUrl} /></header>;
}

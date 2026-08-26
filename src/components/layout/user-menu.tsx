"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type UserMenuProps = { email: string; displayName?: string | null; avatarUrl?: string | null };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "TB";
}

export function UserMenu({ email, displayName, avatarUrl }: UserMenuProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const label = displayName || email.split("@")[0] || "User";

  async function signOut() {
    setIsSigningOut(true);
    const { error } = await createClient().auth.signOut();
    if (error) {
      toast.error("We could not log you out. Please try again.");
      setIsSigningOut(false);
      return;
    }
    router.push("/login");
    router.refresh();
  }

  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="h-auto gap-3 px-2 py-1.5" disabled={isSigningOut}><Avatar className="h-8 w-8"><AvatarImage src={avatarUrl ?? undefined} alt="" /><AvatarFallback>{initials(label)}</AvatarFallback></Avatar><span className="hidden max-w-40 truncate text-left text-sm sm:block">{label}</span><span className="sr-only">Open user menu</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56"><DropdownMenuLabel><span className="block truncate">{label}</span><span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{email}</span></DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void signOut()}><LogOut className="mr-2 h-4 w-4" />Log out</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}

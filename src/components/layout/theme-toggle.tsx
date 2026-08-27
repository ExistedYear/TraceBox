"use client";

import { useSyncExternalStore } from "react";
import { Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const accents = [
  { value: "blue", label: "Blue", color: "bg-blue-500" },
  { value: "neutral", label: "Neutral", color: "bg-zinc-100" },
  { value: "amber", label: "Amber", color: "bg-amber-500" },
  { value: "purple", label: "Purple", color: "bg-purple-500" },
  { value: "emerald", label: "Emerald", color: "bg-emerald-500" },
] as const;

function subscribeAccent(callback: () => void) {
  window.addEventListener("tracebox-accent-change", callback);
  return () => window.removeEventListener("tracebox-accent-change", callback);
}

function getAccentSnapshot() {
  return document.documentElement.dataset.accent ?? "blue";
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const accent = useSyncExternalStore(subscribeAccent, getAccentSnapshot, () => "blue");

  function updateAccent(value: string) {
    document.documentElement.dataset.accent = value;
    localStorage.setItem("tracebox-accent", value);
    window.dispatchEvent(new Event("tracebox-accent-change"));
  }

  return <div className="flex items-center"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Choose accent color"><Palette className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-40"><DropdownMenuLabel className="text-xs">Accent color</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuRadioGroup value={accent} onValueChange={updateAccent}>{accents.map((item) => <DropdownMenuRadioItem key={item.value} value={item.value} className="gap-2 text-xs"><span className={`h-2.5 w-2.5 rounded-full border border-white/20 ${item.color}`} />{item.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu><Button variant="ghost" size="icon" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Use light theme" : "Use dark theme"}>{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button></div>;
}

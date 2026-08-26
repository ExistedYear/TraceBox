import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

export function TraceMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn("h-5 w-5", className)} {...props}>
      <path d="M4 7h6l3 5h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17h5l3-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="7" r="1.5" fill="currentColor" />
      <circle cx="4" cy="17" r="1.5" fill="currentColor" />
      <circle cx="20" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function TraceLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-primary text-primary-foreground shadow-sm shadow-primary/20">
        <TraceMark className="h-5 w-5" />
      </span>
      {!compact && <span>TraceBox</span>}
    </span>
  );
}

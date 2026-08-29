import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Surface } from "@/components/tracebox/primitives";

/** A safe server-rendered failure state for a query-backed route. */
export function LoadError({
  title = "Could not load this page",
  description = "The server did not return the data needed for this view. Try again in a moment.",
  retryHref,
}: {
  title?: string;
  description?: string;
  retryHref: string;
}) {
  return (
    <Surface className="p-8 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-semibold">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      <Button asChild variant="outline" className="mt-5">
        <Link href={retryHref}>Try again</Link>
      </Button>
    </Surface>
  );
}

export function LoadErrorPage(props: Parameters<typeof LoadError>[0]) {
  return <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8"><LoadError {...props} /></main>;
}

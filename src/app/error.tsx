"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    // Keep production details in server logs; only a safe digest can be shown to users.
    console.error("Unhandled application error", error.digest ? { digest: error.digest } : undefined);
  }, [error]);

  return <main className="flex min-h-screen items-center justify-center p-6"><Card className="w-full max-w-md"><CardHeader><AlertTriangle className="mb-2 h-6 w-6 text-amber-300" /><CardTitle>Something went wrong</CardTitle><CardDescription>We could not load this page. Try again, or return to the workspace.</CardDescription></CardHeader><CardContent className="flex gap-3"><Button onClick={reset}>Try again</Button><Button variant="outline" onClick={() => router.push("/dashboard")}>Go to dashboard</Button></CardContent></Card></main>;
}

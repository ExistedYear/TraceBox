import { CheckCircle2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const stackChecks = ["Next.js", "Vercel", "Supabase", "Authentication", "Database connection"];

type DashboardOverviewProps = { displayName: string; email: string };

export function DashboardOverview({ displayName, email }: DashboardOverviewProps) {
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Welcome, {displayName}.</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Authenticated as{" "}
        <span className="font-medium text-foreground">{email}</span>
      </p>
      <Card className="mt-8">
        <CardHeader className="space-y-1.5">
          <CardTitle className="text-lg">Deployment status</CardTitle>
          <CardDescription>This deployment proves the foundation end to end.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {stackChecks.map((label) => (
              <li key={label} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}

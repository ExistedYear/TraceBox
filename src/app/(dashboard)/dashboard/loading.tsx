import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return <main className="mx-auto max-w-6xl p-6 sm:p-8 lg:p-10"><div className="mb-8 space-y-3"><Skeleton className="h-4 w-32" /><Skeleton className="h-9 w-72" /><Skeleton className="h-5 w-full max-w-xl" /></div><div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><Skeleton className="h-52 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div></main>;
}

import { Skeleton } from "@/components/ui/skeleton";

export default function IssuesLoading() {
  return (
    <main className="mx-auto max-w-[1500px] space-y-4 p-4 sm:p-6 lg:p-8">
      <Skeleton className="h-8 w-48" />
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-7 w-28" />
        ))}
      </div>
      <div className="space-y-2 rounded-[10px] border border-border/80 p-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    </main>
  );
}

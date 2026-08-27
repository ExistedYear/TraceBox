import { Skeleton } from "@/components/ui/skeleton";

export default function ReadinessLoading() {
  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-8 flex items-end justify-between border-b border-border/80 pb-6">
        <div>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-8 w-60" />
        </div>
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    </main>
  );
}

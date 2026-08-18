import { Skeleton } from "./Skeleton";

export function PageLoading() {
  return (
    <div className="space-y-5">
      <div>
        <Skeleton className="mb-2 h-3 w-40" />
        <Skeleton className="h-5 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <Skeleton className="mb-2 h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

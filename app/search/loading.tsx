import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <div className="flex h-screen">
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <Skeleton className="h-9 w-64 mb-2" />
            <Skeleton className="h-5 w-96" />
          </div>

          {/* Filters Skeleton */}
          <div className="bg-card border rounded-lg p-6 space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
            <Skeleton className="h-11 w-full" />
          </div>

          {/* Results Skeleton */}
          <div className="space-y-4">
            <Skeleton className="h-7 w-32" />
            <div className="grid gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-card border rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <Skeleton className="w-12 h-12 rounded-md" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-6 w-48" />
                      <div className="flex gap-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="space-y-1">
                        <Skeleton className="h-8 w-8 mx-auto" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                      <div className="space-y-1">
                        <Skeleton className="h-8 w-8 mx-auto" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

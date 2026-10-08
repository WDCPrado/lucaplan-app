import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardLoading() {
  return (
    <main
      data-product
      aria-busy="true"
      className="mx-auto max-w-6xl space-y-8 px-5 py-8 lg:px-8"
    >
      <p role="status" className="text-sm text-muted-foreground">
        Cargando tu plan…
      </p>
      <Skeleton className="h-11 w-64 motion-reduce:animate-none" />
      <div className="space-y-5 rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-10 w-44 motion-reduce:animate-none" />
        <Skeleton className="h-5 w-28 motion-reduce:animate-none" />
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton
              key={i}
              className="h-12 w-full motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="space-y-5">
            <Skeleton className="h-6 w-40 motion-reduce:animate-none" />
            {Array.from({ length: 3 }, (_, j) => (
              <Skeleton
                key={j}
                className="h-24 w-full motion-reduce:animate-none"
              />
            ))}
          </div>
        ))}
      </div>
    </main>
  )
}

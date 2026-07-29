import { Skeleton } from '@/components/ui/Skeleton'

export default function FlowsLoading() {
  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto p-6">
      <Skeleton className="h-8 w-32 mb-2" />
      <Skeleton className="h-4 w-64 mb-8" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border rounded-xl p-4">
            <Skeleton className="h-5 w-5 mb-2" />
            <Skeleton className="h-5 w-40 mb-2" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}

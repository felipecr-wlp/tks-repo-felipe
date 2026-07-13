/**
 * Skeleton de carga del timesheet personal (Circuito B27).
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function TrackingLoading() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <Skeleton className="h-6 w-44 mb-6" />
      <Skeleton className="h-16 w-full rounded-xl mb-6" />
      <Skeleton className="h-4 w-24 mb-3" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

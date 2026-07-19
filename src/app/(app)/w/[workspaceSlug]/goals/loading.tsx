/**
 * Skeleton de carga de "Metas".
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function GoalsLoading() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <Skeleton className="h-6 w-32 mb-2" />
      <Skeleton className="h-4 w-72 mb-6" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}

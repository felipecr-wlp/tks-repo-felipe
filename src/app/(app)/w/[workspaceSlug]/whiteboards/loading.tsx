/**
 * Skeleton de carga del listado de "Pizarras".
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function WhiteboardsLoading() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Skeleton className="h-6 w-32 mb-2" />
      <Skeleton className="h-4 w-64 mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}

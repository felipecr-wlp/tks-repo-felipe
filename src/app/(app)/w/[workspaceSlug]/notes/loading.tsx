/**
 * Skeleton de carga del home del wiki (Circuito B27).
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function NotesLoading() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <Skeleton className="h-7 w-56 mb-2" />
      <Skeleton className="h-4 w-80 mb-8" />
      <Skeleton className="h-4 w-32 mb-3" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-3">
            <Skeleton className="w-5 h-5 rounded" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

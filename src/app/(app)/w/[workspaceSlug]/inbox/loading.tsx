/**
 * Skeleton de carga de la bandeja de notificaciones (Circuito B27).
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function InboxLoading() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-7 w-24 rounded-lg" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

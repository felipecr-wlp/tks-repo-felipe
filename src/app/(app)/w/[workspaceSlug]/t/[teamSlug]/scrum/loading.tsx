/**
 * Skeleton de carga de la capa Scrum del equipo (Circuito B27).
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function ScrumLoading() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Skeleton className="h-5 w-48" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>
      <div className="flex-1 grid grid-cols-3 gap-4 px-6 py-4 overflow-hidden">
        {Array.from({ length: 3 }).map((_, col) => (
          <div key={col} className="flex flex-col gap-3">
            <Skeleton className="h-4 w-28" />
            {Array.from({ length: 4 }).map((_, card) => (
              <Skeleton key={card} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Skeleton de carga de "Mis Tareas" (Circuito B27).
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function MyTasksLoading() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <Skeleton className="h-6 w-36 mb-2" />
      <Skeleton className="h-4 w-64 mb-6" />
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-7 w-20 rounded-md" />
        <Skeleton className="h-7 w-20 rounded-md" />
        <Skeleton className="h-7 w-20 rounded-md" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

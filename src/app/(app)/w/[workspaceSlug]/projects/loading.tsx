/**
 * Skeleton de carga del Marketplace de Proyectos Internos (Circuito B27).
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function ProjectsLoading() {
  return (
    <div className="px-6 py-8">
      <Skeleton className="h-6 w-52 mb-2" />
      <Skeleton className="h-4 w-72 mb-6" />
      <div className="flex items-center gap-2 mb-6">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}

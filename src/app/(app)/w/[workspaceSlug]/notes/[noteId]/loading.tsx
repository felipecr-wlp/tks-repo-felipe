/**
 * Skeleton de carga de una nota individual. Evita el flash en blanco mientras
 * el servidor resuelve la nota (server component) y monta el editor.
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function NoteLoading() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-3 rounded" />
        <Skeleton className="h-3 w-24" />
      </div>
      {/* Icono + titulo */}
      <div className="flex items-center gap-3 mb-8">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <Skeleton className="h-8 w-72" />
      </div>
      {/* Parrafos */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-1/2" />
        <div className="h-4" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-10/12" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </div>
  )
}

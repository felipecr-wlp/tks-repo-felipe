/**
 * Skeleton de carga de la pagina de proyecto (Circuito B27).
 * Next.js la monta automaticamente como boundary de Suspense mientras el
 * Server Component trae proyecto/tareas/miembros, evitando el flash en
 * blanco al navegar entre proyectos.
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function ProjectLoading() {
  return (
    <div className="flex flex-col h-full">
      {/* Header: icono + nombre + tabs de vista */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Skeleton className="w-6 h-6 rounded" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-16 rounded" />
          ))}
        </div>
      </div>

      {/* Tablero: columnas con tarjetas */}
      <div className="flex-1 flex gap-4 px-6 py-4 overflow-hidden">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="flex-1 min-w-[260px] flex flex-col gap-3">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 3 }).map((_, card) => (
              <Skeleton key={card} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

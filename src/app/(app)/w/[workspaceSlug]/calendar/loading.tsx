/**
 * Skeleton de carga del calendario mensual (Circuito B27).
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function CalendarLoading() {
  return (
    <div className="flex flex-col h-full px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-6 w-40" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2 flex-1">
        {Array.from({ length: 35 }).map((_, i) => (
          <Skeleton key={i} className="rounded-md h-full min-h-[80px]" />
        ))}
      </div>
    </div>
  )
}

/**
 * Skeleton de carga del chat de equipo. Mismo patrón que inbox/loading.tsx:
 * header + burbujas alternadas para que la carga fría no muestre un área en blanco.
 */
import { Skeleton } from '@/components/ui/Skeleton'

export default function ChatLoading() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-border">
        <Skeleton className="w-5 h-5 rounded" />
        <Skeleton className="h-5 w-40 rounded-lg" />
      </div>
      <div className="flex-1 px-6 py-4 space-y-4 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={i % 3 === 2 ? 'flex justify-end' : 'flex items-start gap-2'}>
            {i % 3 !== 2 && <Skeleton className="w-7 h-7 rounded-full flex-shrink-0" />}
            <Skeleton className={`h-9 rounded-2xl ${i % 2 === 0 ? 'w-2/5' : 'w-1/4'}`} />
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 py-3">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  )
}

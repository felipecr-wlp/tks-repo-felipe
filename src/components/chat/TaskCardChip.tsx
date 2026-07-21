'use client'

/**
 * TaskCardChip, tarjeta de tarea enlazada dentro de un mensaje del chat (1.A).
 *
 * Recibe la tarjeta ya resuelta (o null si la tarea se borró / undefined si aún
 * carga) y la pinta con estado, prioridad y asignado. Al hacer clic abre la
 * tarea en su tablero. Es tonta: no hace fetch (lo hace el contenedor en lote).
 */
import Link from 'next/link'
import Image from 'next/image'
import { CheckSquare, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ResolvedTaskCard {
  id: string
  title: string
  priority: string
  status: { name: string; color: string | null } | null
  assignee: { display_name: string; avatar_url: string | null } | null
  href: string
}

const PRIORITY_DOT: Record<string, string> = {
  none: 'bg-muted-foreground/40',
  low: 'bg-sky-500',
  medium: 'bg-amber-500',
  high: 'bg-orange-500',
  urgent: 'bg-red-500',
}

const PRIORITY_LABEL: Record<string, string> = {
  none: 'Sin prioridad',
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
}

/** onMine controla el contraste (los mensajes propios van sobre fondo azul). */
export function TaskCardChip({
  card,
  onMine = false,
}: {
  card: ResolvedTaskCard | null | undefined
  onMine?: boolean
}) {
  if (card === undefined) {
    return (
      <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-border bg-background/80 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando tarea…
      </div>
    )
  }
  if (card === null) {
    return (
      <div className="mt-1.5 rounded-xl border border-dashed border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        Tarea no disponible
      </div>
    )
  }

  const inner = (
    <div
      className={cn(
        'mt-1.5 flex items-start gap-2.5 rounded-xl border bg-background px-3 py-2 transition-colors',
        'border-border hover:border-primary/40 hover:bg-accent/40'
      )}
    >
      <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <CheckSquare className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{card.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {card.status && (
            <span className="inline-flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: card.status.color ?? '#94a3b8' }}
              />
              {card.status.name}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <span className={cn('h-2 w-2 rounded-full', PRIORITY_DOT[card.priority] ?? PRIORITY_DOT.none)} />
            {PRIORITY_LABEL[card.priority] ?? 'Sin prioridad'}
          </span>
          {card.assignee && (
            <span className="inline-flex items-center gap-1">
              {card.assignee.avatar_url ? (
                <Image
                  src={card.assignee.avatar_url}
                  alt={card.assignee.display_name}
                  width={14}
                  height={14}
                  className="rounded-full"
                />
              ) : (
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-[8px] font-medium text-accent-foreground">
                  {(card.assignee.display_name ?? '?').charAt(0).toUpperCase()}
                </span>
              )}
              <span className="truncate max-w-[7rem]">{card.assignee.display_name}</span>
            </span>
          )}
        </span>
      </span>
    </div>
  )

  if (!card.href) return <div className={cn(onMine && 'text-left')}>{inner}</div>

  return (
    <Link href={card.href} className="block text-left">
      {inner}
    </Link>
  )
}

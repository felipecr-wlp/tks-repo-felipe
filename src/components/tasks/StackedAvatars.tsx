'use client'

/**
 * Avatares apilados para multiples asignados.
 * Muestra hasta 3 circulos superpuestos y, si hay mas, un chip "+N".
 * Cada avatar usa la foto si existe, o la inicial del nombre como respaldo.
 */
import { cn } from '@/lib/utils'

export interface StackedAssignee {
  id: string
  display_name: string | null
  avatar_url: string | null
}

interface StackedAvatarsProps {
  assignees: StackedAssignee[]
  className?: string
  /** Cuantos avatares mostrar antes del chip "+N". */
  max?: number
}

export function StackedAvatars({ assignees, className, max = 3 }: StackedAvatarsProps) {
  if (!assignees || assignees.length === 0) return null

  const shown = assignees.slice(0, max)
  const extra = assignees.length - shown.length

  return (
    <div className={cn('flex items-center', className)}>
      {shown.map((a, i) => {
        const name = a.display_name ?? '?'
        return (
          <div
            key={a.id}
            title={name}
            className={cn(
              'w-5 h-5 rounded-full overflow-hidden flex items-center justify-center',
              'text-[9px] font-medium bg-muted text-muted-foreground ring-2 ring-card',
              i > 0 && '-ml-2'
            )}
          >
            {a.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.avatar_url} alt={name} title={name} className="w-5 h-5 rounded-full object-cover" />
            ) : (
              name.charAt(0).toUpperCase()
            )}
          </div>
        )
      })}
      {extra > 0 && (
        <div
          title={`${extra} asignados más`}
          className="w-5 h-5 -ml-2 rounded-full flex items-center justify-center bg-muted text-muted-foreground text-[10px] font-medium ring-2 ring-card"
        >
          +{extra}
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * Badge de notificaciones sin leer para la Bandeja del sidebar (Circuito 2.C).
 * Cuenta inicial via /api/notifications/count y se mantiene en vivo suscrito a
 * la tabla notifications (INSERT/UPDATE/DELETE de las del propio usuario). Ante
 * cualquier cambio re-consulta el conteo (barato: head + count exact). Tambien
 * revalida al volver el foco a la pestana y al navegar (la ruta cambia).
 */
import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

interface InboxBadgeProps {
  workspaceSlug: string
  currentUserId: string
  collapsed: boolean
}

export function InboxBadge({ workspaceSlug, currentUserId, collapsed }: InboxBadgeProps) {
  const [count, setCount] = useState(0)
  const pathname = usePathname()

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications/count?workspace=${encodeURIComponent(workspaceSlug)}`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = await res.json()
      setCount(typeof data.unread === 'number' ? data.unread : 0)
    } catch {
      // Silencioso: el badge es informativo, no critico.
    }
  }, [workspaceSlug])

  // Conteo inicial + al navegar (incluye entrar/salir de la Bandeja, donde se
  // marca como leido) + al volver el foco a la pestana.
  useEffect(() => { refresh() }, [refresh, pathname])

  useEffect(() => {
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  // Realtime: cualquier cambio en mis notificaciones re-consulta el conteo.
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase.channel(`inbox-badge-${currentUserId}`)
    for (const event of ['INSERT', 'UPDATE'] as const) {
      ch.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event, schema: 'public', table: 'notifications', filter: `recipient_id=eq.${currentUserId}` },
        () => refresh()
      )
    }
    // DELETE sin filtro (el payload solo trae la PK); raro, refresh de mas es ok.
    ch.on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: 'DELETE', schema: 'public', table: 'notifications' },
      () => refresh()
    )
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [currentUserId, refresh])

  if (count <= 0) return null

  const label = count > 99 ? '99+' : String(count)

  // Colapsado: punto pequeno sobre el icono. Expandido: pastilla con el numero.
  if (collapsed) {
    return (
      <span
        className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary ring-2 ring-sidebar"
        aria-label={`${label} sin leer`}
      />
    )
  }

  return (
    <span
      className={cn(
        'ml-auto flex-shrink-0 min-w-[18px] h-[18px] px-1.5 inline-flex items-center justify-center',
        'text-[10px] font-semibold rounded-full bg-primary text-primary-foreground tabular-nums'
      )}
      aria-label={`${label} notificaciones sin leer`}
    >
      {label}
    </span>
  )
}

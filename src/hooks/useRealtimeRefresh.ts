'use client'

/**
 * useRealtimeRefresh, backbone de colaboración en vivo de WLO.
 *
 * Se suscribe a los cambios (INSERT/UPDATE/DELETE) de un conjunto de tablas via
 * Supabase Realtime y dispara router.refresh() con debounce. Como las páginas
 * son Server Components que leen con el admin client, un refresh re-renderiza la
 * data fresca para TODOS los usuarios conectados sin recargar la página.
 *
 * No reinventa el fetching: reusa el server render existente. Barato y robusto
 * (last-writer-wins a nivel de fila lo resuelve Postgres, no el cliente).
 *
 * Uso:
 *   useRealtimeRefresh({ channel: `scrum-${teamId}`, tables: ['tasks', 'sprints'] })
 */
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface RealtimeRefreshOptions {
  /** Nombre único del canal (evita colisiones entre vistas). */
  channel: string
  /** Tablas de public a observar. Deben estar en la publicación supabase_realtime. */
  tables: string[]
  /** Permite desactivar la suscripción (ej. mientras carga). Default true. */
  enabled?: boolean
  /** Callback opcional en cada cambio, antes del refresh (ej. sonido/badge). */
  onChange?: () => void
}

export function useRealtimeRefresh({
  channel,
  tables,
  enabled = true,
  onChange,
}: RealtimeRefreshOptions) {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const tablesKey = tables.join(',')

  useEffect(() => {
    if (!enabled || tables.length === 0) return

    const supabase = createClient()
    const ch = supabase.channel(channel)

    const handle = () => {
      onChangeRef.current?.()
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => router.refresh(), 400)
    }

    for (const table of tables) {
      ch.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table },
        handle
      )
    }

    ch.subscribe()

    return () => {
      if (timer.current) clearTimeout(timer.current)
      supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, enabled, tablesKey])
}

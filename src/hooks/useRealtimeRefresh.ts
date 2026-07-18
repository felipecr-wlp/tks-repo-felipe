'use client'

/**
 * useRealtimeRefresh, backbone de colaboración en vivo de WLO.
 *
 * Se suscribe a los cambios (INSERT/UPDATE/DELETE) de un conjunto de tablas via
 * Supabase Realtime y dispara router.refresh() con debounce. Como las páginas
 * son Server Components que leen con el admin client, un refresh re-renderiza la
 * data fresca para TODOS los usuarios conectados sin recargar la página.
 *
 * Regla de egress 5: SIEMPRE suscribirse con filter. Cada tabla puede pasarse
 * como string (sin filtro, solo para tablas pequeñas o casos legacy) o como
 * { table, filter } con sintaxis realtime ('col=eq.valor', 'col=in.(a,b)').
 *
 * Nota técnica: Supabase Realtime NO entrega eventos DELETE cuando la
 * suscripción tiene filter (el payload del DELETE solo trae la primary key).
 * Por eso, cuando hay filter, se suscriben INSERT y UPDATE filtrados y DELETE
 * sin filtro: los deletes son raros (la app archiva en vez de borrar) y un
 * refresh de más es preferible a un tablero desincronizado.
 *
 * Uso:
 *   useRealtimeRefresh({
 *     channel: `proj-tasks-${projectId}`,
 *     tables: [{ table: 'tasks', filter: `project_id=eq.${projectId}` }],
 *   })
 */
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type RealtimeTableSpec = string | { table: string; filter?: string }

interface RealtimeRefreshOptions {
  /** Nombre único del canal (evita colisiones entre vistas). */
  channel: string
  /** Tablas de public a observar. Deben estar en la publicación supabase_realtime. */
  tables: RealtimeTableSpec[]
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

  const tablesKey = tables
    .map(t => (typeof t === 'string' ? t : `${t.table}|${t.filter ?? ''}`))
    .join(',')

  useEffect(() => {
    if (!enabled || tables.length === 0) return

    const supabase = createClient()
    const ch = supabase.channel(channel)

    const handle = () => {
      onChangeRef.current?.()
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => router.refresh(), 400)
    }

    for (const spec of tables) {
      const table = typeof spec === 'string' ? spec : spec.table
      const filter = typeof spec === 'string' ? undefined : spec.filter
      if (filter) {
        for (const event of ['INSERT', 'UPDATE'] as const) {
          ch.on(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            'postgres_changes' as any,
            { event, schema: 'public', table, filter },
            handle
          )
        }
        // DELETE sin filter (ver nota técnica del encabezado).
        ch.on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'postgres_changes' as any,
          { event: 'DELETE', schema: 'public', table },
          handle
        )
      } else {
        ch.on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'postgres_changes' as any,
          { event: '*', schema: 'public', table },
          handle
        )
      }
    }

    ch.subscribe()

    return () => {
      if (timer.current) clearTimeout(timer.current)
      supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, enabled, tablesKey])
}

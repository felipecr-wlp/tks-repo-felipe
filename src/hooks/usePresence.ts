'use client'

/**
 * usePresence, presencia en vivo reutilizable (Supabase Realtime Presence).
 *
 * Devuelve la lista de OTROS usuarios viendo la misma superficie ahora mismo.
 * Se auto-registra (track) al suscribirse y limpia el canal al desmontar.
 * Mismo patrón que la pizarra colaborativa, extraído para reusar en Scrum,
 * tareas, notas, etc. sin duplicar la logica de canal.
 *
 * Uso:
 *   const viewers = usePresence({
 *     channel: `scrum-${teamId}`,
 *     userId: currentUserId,
 *     name: currentUserName,
 *   })
 */
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface Viewer {
  userId: string
  name: string
  avatarUrl?: string | null
}

interface UsePresenceArgs {
  channel: string
  userId: string
  name: string
  avatarUrl?: string | null
}

export function usePresence({ channel, userId, name, avatarUrl }: UsePresenceArgs): Viewer[] {
  const [viewers, setViewers] = useState<Viewer[]>([])

  useEffect(() => {
    if (!channel || !userId) return
    const supabase = createClient()
    const ch = supabase.channel(channel, {
      config: { presence: { key: userId } },
    })

    ch
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState() as Record<string, Array<Viewer>>
        // Dedup por userId, excluyendo al propio usuario (solo mostramos "otros").
        const seen = new Map<string, Viewer>()
        for (const key of Object.keys(state)) {
          for (const meta of state[key]) {
            if (meta.userId && meta.userId !== userId) {
              seen.set(meta.userId, {
                userId: meta.userId,
                name: meta.name,
                avatarUrl: meta.avatarUrl ?? null,
              })
            }
          }
        }
        setViewers(Array.from(seen.values()))
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          ch.track({ userId, name, avatarUrl: avatarUrl ?? null })
        }
      })

    return () => { supabase.removeChannel(ch) }
  }, [channel, userId, name, avatarUrl])

  return viewers
}

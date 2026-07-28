'use client'

/**
 * Presencia en vivo en la nota (Circuito A5). Muestra quién más la está viendo
 * ahora mismo, con Supabase Realtime Presence. Cada cliente hace track de su
 * identidad en un canal por nota; al sincronizar, pintamos un stack de avatares.
 * Silencioso si no hay nadie más (solo tú).
 */
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { cn, getInitials } from '@/lib/utils'
import { useT } from '@/lib/i18n/LanguageProvider'

interface PresentUser {
  id: string
  name: string
  avatar: string | null
}

interface NotePresenceProps {
  noteId: string
  currentUserId: string
  currentUserName: string
  currentUserAvatar: string | null
}

export function NotePresence({
  noteId, currentUserId, currentUserName, currentUserAvatar,
}: NotePresenceProps) {
  const tr = useT()
  const [others, setOthers] = useState<PresentUser[]>([])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`note-presence-${noteId}`, {
      config: { presence: { key: currentUserId } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresentUser>()
        // Aplanar y deduplicar por id, excluyendo al usuario actual.
        const seen = new Map<string, PresentUser>()
        for (const metas of Object.values(state)) {
          for (const meta of metas) {
            if (meta.id && meta.id !== currentUserId) seen.set(meta.id, meta)
          }
        }
        setOthers(Array.from(seen.values()))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            id:     currentUserId,
            name:   currentUserName,
            avatar: currentUserAvatar,
          } as PresentUser)
        }
      })

    return () => { supabase.removeChannel(channel) }
  }, [noteId, currentUserId, currentUserName, currentUserAvatar])

  if (others.length === 0) return null

  const shown = others.slice(0, 4)
  const extra = others.length - shown.length

  return (
    <div className="flex items-center -space-x-1.5" title={`${others.length} ${tr('note.viewingNow')}`}>
      {shown.map(u => (
        <div
          key={u.id}
          title={u.name}
          className={cn(
            'w-6 h-6 rounded-full overflow-hidden ring-2 ring-background bg-muted',
            'flex items-center justify-center text-[9px] font-medium text-muted-foreground'
          )}
        >
          {u.avatar ? (
            <Image src={u.avatar} alt={u.name} width={24} height={24} className="object-cover" />
          ) : (
            getInitials(u.name)
          )}
        </div>
      ))}
      {extra > 0 && (
        <div className="w-6 h-6 rounded-full ring-2 ring-background bg-muted flex items-center justify-center text-[9px] font-medium text-muted-foreground">
          +{extra}
        </div>
      )}
    </div>
  )
}

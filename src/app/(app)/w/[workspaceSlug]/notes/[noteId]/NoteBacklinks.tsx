'use client'

/**
 * Panel de backlinks (Circuito A3): notas que enlazan a esta nota.
 * Construye el grafo de documentacion tipo Notion/Obsidian. Se refresca al
 * montar y cuando cambia el noteId. Silencioso si no hay enlaces entrantes.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Link2 } from 'lucide-react'
import { NoteIcon } from '@/lib/note-icons'
import { timeAgo } from '@/lib/utils'
import { useT } from '@/lib/i18n/LanguageProvider'

interface Backlink {
  id: string
  title: string
  icon: string | null
  updated_at: string
}

interface NoteBacklinksProps {
  noteId: string
  workspaceSlug: string
}

export function NoteBacklinks({ noteId, workspaceSlug }: NoteBacklinksProps) {
  const tr = useT()
  const [links, setLinks] = useState<Backlink[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/notes/${noteId}/backlinks`)
        if (alive && res.ok) setLinks(await res.json())
      } catch {
        // el panel es secundario, no romper la nota
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [noteId])

  // Nada que mostrar: no ocupamos espacio con un panel vacío.
  if (loading || links.length === 0) return null

  return (
    <section className="mt-10 pt-6 border-t border-border">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        <Link2 className="w-3.5 h-3.5" />
        {tr('note.linkedFrom')} {links.length > 0 && `(${links.length})`}
      </h3>
      <div className="space-y-1">
        {links.map(l => (
          <Link
            key={l.id}
            href={`/w/${workspaceSlug}/notes/${l.id}`}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-sm text-foreground group"
          >
            <NoteIcon icon={l.icon} size={16} className="flex-shrink-0 text-muted-foreground" />
            <span className="truncate">{l.title || tr('search.untitled')}</span>
            <span className="ml-auto text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
              {timeAgo(l.updated_at)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

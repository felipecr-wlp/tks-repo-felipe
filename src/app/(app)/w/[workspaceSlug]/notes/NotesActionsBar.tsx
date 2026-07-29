'use client'

/**
 * NotesActionsBar, botón "Nueva nota" con dropdown de templates.
 * Al elegir un template, crea la nota con contenido predefinido y navega al editor.
 */
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { NOTE_TEMPLATES } from '@/lib/note-templates'
import { NoteIcon } from '@/lib/note-icons'
import { useT } from '@/lib/i18n/LanguageProvider'

interface NotesActionsBarProps {
  workspaceId: string
  workspaceSlug: string
  parentNoteId?: string | null  // si está, crea como sub-página
  variant?: 'primary' | 'subtle'
  label?: string
  /**
   * Departamento donde nace el documento. Solo lo manda la vista de un equipo:
   * ahí crear un documento ES el acto explícito de compartirlo con el
   * departamento, así que la nota nace con `visibility: 'space'` en vez de
   * privada. Desde el wiki general no se manda y la nota nace privada, que es
   * la regla por defecto (ver src/lib/note-visibility.ts).
   */
  spaceId?: string | null
}

export function NotesActionsBar({
  workspaceId,
  workspaceSlug,
  parentNoteId,
  variant = 'primary',
  label,
  spaceId,
}: NotesActionsBarProps) {
  const router = useRouter()
  const tr = useT()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function createFromTemplate(templateId: string) {
    const template = NOTE_TEMPLATES.find(t => t.id === templateId)
    if (!template) return

    setCreating(true)
    setOpen(false)
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          parent_note_id: parentNoteId ?? null,
          title: template.defaultTitle,
          content: template.content || null,
          icon: template.icon,
          // Nace privada; el autor decide despues si la comparte con su
          // departamento (ver src/lib/note-visibility.ts). La excepcion es
          // crearla DESDE un equipo: ahi el acto de crear ya es el acto de
          // compartir con ese departamento.
          visibility: spaceId ? 'space' : 'private',
          ...(spaceId ? { space_id: spaceId } : {}),
          ...(template.docKind ? { doc_kind: template.docKind } : {}),
          ...(template.sopStatus ? { sop_status: template.sopStatus } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? tr('common.unknownError'))
      router.push(`/w/${workspaceSlug}/notes/${data.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('notes.createError'))
      setCreating(false)
    }
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        disabled={creating}
        className={cn(
          'inline-flex items-center gap-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50',
          variant === 'primary'
            ? 'px-3 py-2 bg-primary text-primary-foreground hover:bg-primary/90'
            : 'px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent'
        )}
      >
        {creating ? (
          <span className={cn(
            'rounded-full animate-spin',
            variant === 'primary' ? 'w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground' : 'w-3 h-3 border border-muted-foreground/30 border-t-muted-foreground'
          )} />
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
        {label ?? (parentNoteId ? tr('notes.subPage') : tr('notes.newNote'))}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-popover border border-border rounded-lg shadow-raised z-[100] overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {tr('notes.templates')}
            </p>
          </div>
          <div className="py-1 max-h-80 overflow-y-auto">
            {NOTE_TEMPLATES.map(template => (
              <button
                key={template.id}
                onClick={() => createFromTemplate(template.id)}
                className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-accent transition-colors text-left"
              >
                <NoteIcon icon={template.icon} size={18} className="flex-shrink-0 mt-0.5 text-muted-foreground" />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{template.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                    {template.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

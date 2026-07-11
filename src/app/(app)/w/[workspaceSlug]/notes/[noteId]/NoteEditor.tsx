'use client'

/**
 * Editor de nota, full screen, Notion-lite con icon, breadcrumb y sub-páginas.
 * Auto-save con debounce 800ms.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Globe, Users, Folder, Lock, ChevronDown } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import { NoteIcon, NOTE_ICONS, normalizeNoteIconKey } from '@/lib/note-icons'
import { NotesActionsBar } from '../NotesActionsBar'

const RichTextEditor = dynamic(
  () => import('@/components/editor/RichTextEditor').then(m => m.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div className="text-sm text-muted-foreground py-4">Cargando editor...</div>
    ),
  }
)

interface NoteData {
  id: string
  parent_note_id: string | null
  icon: string | null
  title: string
  content: string | null
  visibility: string
  created_by: string | null
  updated_at: string
  author: { display_name: string; avatar_url: string | null } | null
}

interface Breadcrumb { id: string; title: string; icon: string | null }
interface ChildNote { id: string; title: string; icon: string | null }

interface NoteEditorProps {
  initial: NoteData
  currentUserId: string
  workspaceSlug: string
  workspaceId: string
  breadcrumbs: Breadcrumb[]
  childNotes: ChildNote[]
}

const VISIBILITY_OPTIONS = [
  { value: 'workspace', label: 'Workspace', Icon: Globe,  description: 'Visible para todos en el workspace' },
  { value: 'team',      label: 'Equipo',    Icon: Users,  description: 'Visible para el equipo' },
  { value: 'project',   label: 'Proyecto',  Icon: Folder, description: 'Visible para el proyecto' },
  { value: 'private',   label: 'Privada',   Icon: Lock,   description: 'Solo tú la puedes ver' },
] as const


export function NoteEditor({
  initial, currentUserId, workspaceSlug, workspaceId, breadcrumbs, childNotes,
}: NoteEditorProps) {
  const router = useRouter()
  const [title, setTitle] = useState(initial.title)
  const [icon, setIcon] = useState(normalizeNoteIconKey(initial.icon))
  const [visibility, setVisibility] = useState(initial.visibility)
  const [updatedAt, setUpdatedAt] = useState(initial.updated_at)
  const [saving, setSaving] = useState(false)
  const [showVisMenu, setShowVisMenu] = useState(false)
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isOwner = initial.created_by === currentUserId

  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const patch = useCallback(async (data: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/notes/${initial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Error al guardar')
      }
      const json = await res.json()
      setUpdatedAt(json.updated_at)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }, [initial.id])

  useEffect(() => {
    if (title === initial.title) return
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current)
    titleSaveTimer.current = setTimeout(() => {
      patch({ title: title.trim() || 'Sin título' })
    }, 800)
    return () => {
      if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current)
    }
  }, [title, initial.title, patch])

  function handleIconChange(newIcon: string) {
    setIcon(newIcon)
    setShowIconPicker(false)
    patch({ icon: newIcon })
  }

  function handleVisibilityChange(v: string) {
    setVisibility(v)
    setShowVisMenu(false)
    patch({ visibility: v })
  }

  async function handleDelete() {
    if (!isOwner) {
      toast.error('Solo el creador puede eliminar la nota')
      return
    }
    if (!confirm('¿Eliminar esta nota? Las sub-páginas también se eliminarán. No se puede deshacer.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/notes/${initial.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Nota eliminada')
      router.push(`/w/${workspaceSlug}/notes`)
    } catch {
      toast.error('Error al eliminar')
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      {/* Toolbar superior */}
      <div className="flex items-center justify-between mb-6 gap-4">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-xs text-muted-foreground min-w-0 flex-1">
          <Link
            href={`/w/${workspaceSlug}/notes`}
            className="hover:text-foreground transition-colors flex items-center gap-1 flex-shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <polyline points="7.5 9 4.5 6 7.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Notas
          </Link>
          {breadcrumbs.map(b => (
            <span key={b.id} className="flex items-center gap-1 min-w-0">
              <span className="text-muted-foreground/50">/</span>
              <Link
                href={`/w/${workspaceSlug}/notes/${b.id}`}
                className="hover:text-foreground transition-colors flex items-center gap-1 truncate max-w-[120px]"
              >
                <NoteIcon icon={b.icon} size={14} className="flex-shrink-0" />
                <span className="truncate">{b.title}</span>
              </Link>
            </span>
          ))}
          <span className="text-muted-foreground/50">/</span>
          <span className="text-foreground truncate">{title || 'Sin título'}</span>
        </nav>

        {/* Acciones */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {saving && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 border border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              Guardando…
            </span>
          )}
          {!saving && (
            <span className="text-xs text-muted-foreground hidden md:inline">
              Guardado {timeAgo(updatedAt)}
            </span>
          )}

          {/* Visibility */}
          <div className="relative">
            <button
              onClick={() => setShowVisMenu(!showVisMenu)}
              className="flex items-center gap-1.5 text-xs px-2 py-1 bg-muted/50 hover:bg-muted text-foreground rounded-md transition-colors"
            >
              {(() => {
                const cur = VISIBILITY_OPTIONS.find(v => v.value === visibility)
                if (!cur) return <span>{visibility}</span>
                const Icon = cur.Icon
                return <span className="flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{cur.label}</span>
              })()}
              <ChevronDown className="w-2.5 h-2.5" />
            </button>
            {showVisMenu && (
              <div
                className="absolute top-7 right-0 z-50 w-56 bg-popover border border-border rounded-lg shadow-lg py-1"
                onMouseLeave={() => setShowVisMenu(false)}
              >
                {VISIBILITY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleVisibilityChange(opt.value)}
                    className={cn(
                      'w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent transition-colors',
                      opt.value === visibility && 'bg-accent/50'
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <opt.Icon className="w-3.5 h-3.5" />{opt.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sub-página */}
          <NotesActionsBar
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            parentNoteId={initial.id}
            variant="subtle"
            label="Sub-página"
          />

          {isOwner && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="Eliminar nota"
              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M6 6.5v4M8 6.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M3 4l.8 7.2A1 1 0 004.8 12h4.4a1 1 0 001-.8L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Icon + Title */}
      <div className="flex items-start gap-3 mb-2">
        <div className="relative">
          <button
            onClick={() => setShowIconPicker(!showIconPicker)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg p-2 transition-colors"
            title="Cambiar icono"
          >
            <NoteIcon icon={icon} size={40} />
          </button>
          {showIconPicker && (
            <div
              className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1 w-56"
              onMouseLeave={() => setShowIconPicker(false)}
            >
              {NOTE_ICONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => handleIconChange(opt.key)}
                  title={opt.label}
                  className={cn(
                    'flex items-center justify-center p-2 rounded text-foreground hover:bg-accent transition-colors',
                    opt.key === icon && 'bg-accent'
                  )}
                >
                  <opt.Icon className="w-5 h-5" />
                </button>
              ))}
            </div>
          )}
        </div>

        <textarea
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Sin título"
          rows={1}
          className="flex-1 text-3xl font-bold text-foreground placeholder:text-muted-foreground/40 bg-transparent border-0 outline-none resize-none leading-tight pt-2"
          onInput={e => {
            const target = e.target as HTMLTextAreaElement
            target.style.height = 'auto'
            target.style.height = target.scrollHeight + 'px'
          }}
        />
      </div>

      {/* Author + meta */}
      <p className="text-xs text-muted-foreground mb-6 ml-1">
        {initial.author?.display_name ?? 'Usuario'} · creada {timeAgo(updatedAt)}
      </p>

      {/* Editor */}
      <RichTextEditor
        value={initial.content ?? ''}
        placeholder="Empieza a escribir, o usa la barra de formato arriba…"
        onSave={(html) => patch({ content: html || null })}
        className="!border-0 [&_.ProseMirror]:px-0 [&_.ProseMirror]:py-2 [&_.ProseMirror]:min-h-[300px]"
      />

      {/* Sub-páginas */}
      {childNotes.length > 0 && (
        <div className="mt-10 pt-6 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Sub-páginas
          </h3>
          <div className="space-y-1">
            {childNotes.map(child => (
              <Link
                key={child.id}
                href={`/w/${workspaceSlug}/notes/${child.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-sm text-foreground"
              >
                <NoteIcon icon={child.icon} size={16} className="flex-shrink-0 text-muted-foreground" />
                <span>{child.title || 'Sin título'}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

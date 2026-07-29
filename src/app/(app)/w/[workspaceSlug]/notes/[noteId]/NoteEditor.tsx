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
import { confirmDialog } from '@/components/ConfirmDialog'
import { Globe, Users, Folder, Lock, ChevronDown, Check, AlertTriangle, RotateCw, Loader2, FileDown, Palette, Sparkles } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import { useT } from '@/lib/i18n/LanguageProvider'
import { NoteIcon, NOTE_ICONS, normalizeNoteIconKey } from '@/lib/note-icons'
import { coverBackground, COVER_PRESETS } from '@/lib/note-cover'
import { NotesActionsBar } from '../NotesActionsBar'
import { NoteComments } from './NoteComments'
import { NoteBacklinks } from './NoteBacklinks'
import { NoteVersions } from './NoteVersions'
import { NotePresence } from './NotePresence'
import { SopMetaBar, type DocKind, type SopStatus } from './SopMetaBar'
import { SopAcknowledge } from './SopAcknowledge'
import { SopCompliance } from './SopCompliance'
import { SopApproval } from './SopApproval'

function EditorLoading() {
  const tr = useT()
  return <div className="text-sm text-muted-foreground py-4">{tr('note.edLoadingEditor')}</div>
}

const RichTextEditor = dynamic(
  () => import('@/components/editor/RichTextEditor').then(m => m.RichTextEditor),
  {
    ssr: false,
    loading: () => <EditorLoading />,
  }
)

interface NoteData {
  id: string
  parent_note_id: string | null
  icon: string | null
  title: string
  content: string | null
  visibility: string
  space_id: string | null
  /** Clave de la paleta de portadas. Null = automatica por id (note-cover.ts). */
  cover: string | null
  doc_kind: DocKind
  sop_status: SopStatus | null
  sop_version: string | null
  review_due: string | null
  created_by: string | null
  updated_at: string
  author: { display_name: string; avatar_url: string | null } | null
}

interface Breadcrumb { id: string; title: string; icon: string | null }
interface ChildNote { id: string; title: string; icon: string | null }

interface NoteEditorProps {
  initial: NoteData
  currentUserId: string
  currentUserName: string
  currentUserAvatar: string | null
  workspaceSlug: string
  workspaceId: string
  canManage: boolean
  breadcrumbs: Breadcrumb[]
  childNotes: ChildNote[]
  /** Departamentos con los que ESTE usuario puede compartir la nota. */
  spaces: { id: string; name: string }[]
  /** ¿Puede abrir la nota a toda la empresa? Solo los responsables. */
  canPublishWorkspace: boolean
}

/**
 * Alcance de la nota. La nota nace PRIVADA y compartirla la abre a un
 * DEPARTAMENTO, no a la empresa entera. El alcance de empresa existe (los SOPs
 * lo necesitan) pero solo lo asignan los responsables. Modelo completo en
 * src/lib/note-visibility.ts; la API valida lo mismo del lado servidor.
 */
type ScopeChoice =
  | { kind: 'private' }
  | { kind: 'space'; spaceId: string }
  | { kind: 'workspace' }


export function NoteEditor({
  initial, currentUserId, currentUserName, currentUserAvatar,
  workspaceSlug, workspaceId, canManage, breadcrumbs, childNotes,
  spaces, canPublishWorkspace,
}: NoteEditorProps) {
  const router = useRouter()
  const tr = useT()
  const [title, setTitle] = useState(initial.title)
  const [icon, setIcon] = useState(normalizeNoteIconKey(initial.icon))
  const [visibility, setVisibility] = useState(initial.visibility)
  const [spaceId, setSpaceId] = useState(initial.space_id)
  const [updatedAt, setUpdatedAt] = useState(initial.updated_at)
  // Máquina de estado del guardado, para que el usuario SIEMPRE sepa si su
  // trabajo está a salvo: 'saved' (persistido), 'dirty' (cambios sin guardar),
  // 'saving' (en vuelo) y 'error' (falló, hay que reintentar).
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const [showVisMenu, setShowVisMenu] = useState(false)
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [cover, setCover] = useState<string | null>(initial.cover)
  const [showCoverPicker, setShowCoverPicker] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Último payload que falló, para poder reintentar sin perder el cambio.
  const lastFailedRef = useRef<Record<string, unknown> | null>(null)

  const patch = useCallback(async (data: Record<string, unknown>) => {
    setStatus('saving')
    try {
      const res = await fetch(`/api/notes/${initial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? tr('note.edSaveError'))
      }
      const json = await res.json()
      setUpdatedAt(json.updated_at)
      lastFailedRef.current = null
      setStatus('saved')
    } catch (err) {
      // Guardamos el payload para reintentar y dejamos el estado en 'error'
      // (visible y con botón de reintento), en vez de solo un toast efímero.
      lastFailedRef.current = data
      setStatus('error')
      toast.error(err instanceof Error ? err.message : tr('note.edSaveError'))
    }
  }, [initial.id, tr])

  const retry = useCallback(() => {
    if (lastFailedRef.current) patch(lastFailedRef.current)
  }, [patch])

  // Guardia al salir con cambios sin guardar (o guardado en curso / con error).
  // Evita perder trabajo si el usuario cierra la pestaña o navega fuera.
  useEffect(() => {
    if (status === 'saved') return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [status])

  useEffect(() => {
    if (title === initial.title) return
    setStatus(s => (s === 'saving' ? s : 'dirty'))
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current)
    titleSaveTimer.current = setTimeout(() => {
      patch({ title: title.trim() || tr('search.untitled') })
    }, 800)
    return () => {
      if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current)
    }
  }, [title, initial.title, patch, tr])

  /**
   * Cambiar portada. `null` devuelve la nota al color automatico derivado de su
   * id, que es el default y nunca deja el documento en blanco.
   */
  function handleCoverChange(key: string | null) {
    setCover(key)
    setShowCoverPicker(false)
    patch({ cover: key })
  }

  function handleIconChange(newIcon: string) {
    setIcon(newIcon)
    setShowIconPicker(false)
    patch({ icon: newIcon })
  }

  function handleScopeChange(choice: ScopeChoice) {
    setShowVisMenu(false)
    if (choice.kind === 'space') {
      setVisibility('space')
      setSpaceId(choice.spaceId)
      patch({ visibility: 'space', space_id: choice.spaceId })
      return
    }
    setVisibility(choice.kind)
    patch({ visibility: choice.kind })
  }

  async function handleDelete() {
    if (!(await confirmDialog({ message: tr('note.edDeleteConfirm'), destructive: true, confirmLabel: tr('note.edDeleteConfirmLabel') }))) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/notes/${initial.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        toast.error(body?.error || tr('note.edDeleteError'))
        setDeleting(false)
        return
      }
      toast.success(tr('note.edDeleted'))
      router.push(`/w/${workspaceSlug}/notes`)
    } catch {
      toast.error(tr('note.edDeleteGenericError'))
      setDeleting(false)
    }
  }

  return (
    <div className="pb-28">
      {/* Barra superior: migas, estado de guardado y acciones */}
      <div className="mx-auto w-full max-w-[980px] px-6 sm:px-10 lg:px-12 pt-6">
      <div className="flex items-center justify-between mb-5 gap-4">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-xs text-muted-foreground min-w-0 flex-1">
          <Link
            href={`/w/${workspaceSlug}/notes`}
            className="hover:text-foreground transition-colors flex items-center gap-1 flex-shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <polyline points="7.5 9 4.5 6 7.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {tr('note.edBreadcrumbNotes')}
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
          <span className="text-foreground truncate">{title || tr('search.untitled')}</span>
        </nav>

        {/* Acciones */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {status === 'saving' && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              {tr('note.edSaving')}
            </span>
          )}
          {status === 'dirty' && (
            <span className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {tr('note.edUnsaved')}
            </span>
          )}
          {status === 'error' && (
            <button
              onClick={retry}
              title={tr('note.edRetryTitle')}
              className="text-xs text-destructive flex items-center gap-1.5 hover:underline"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {tr('note.edErrorRetry')}
              <RotateCw className="w-3 h-3" />
            </button>
          )}
          {status === 'saved' && (
            <span className="text-xs text-muted-foreground hidden md:flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-500" />
              {tr('note.edSaved')} {timeAgo(updatedAt)}
            </span>
          )}

          {/* Alcance: privada -> departamento -> empresa */}
          <div className="relative">
            <button
              onClick={() => setShowVisMenu(!showVisMenu)}
              className="flex items-center gap-1.5 text-xs px-2 py-1 bg-muted/50 hover:bg-muted text-foreground rounded-md transition-colors"
            >
              {visibility === 'workspace' ? (
                <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" />Toda la empresa</span>
              ) : visibility === 'private' ? (
                <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />Privada</span>
              ) : visibility === 'project' ? (
                <span className="flex items-center gap-1.5"><Folder className="w-3.5 h-3.5" />Proyecto</span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  {spaces.find(s => s.id === spaceId)?.name ?? 'Departamento'}
                </span>
              )}
              <ChevronDown className="w-2.5 h-2.5" />
            </button>
            {showVisMenu && (
              <div
                className="absolute top-7 right-0 z-50 w-64 bg-popover border border-border rounded-lg shadow-raised py-1"
                onMouseLeave={() => setShowVisMenu(false)}
              >
                <button
                  onClick={() => handleScopeChange({ kind: 'private' })}
                  className={cn(
                    'w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent transition-colors',
                    visibility === 'private' && 'bg-accent/50'
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Lock className="w-3.5 h-3.5" />Privada
                  </span>
                  <span className="text-[10px] text-muted-foreground">Solo tú la puedes ver</span>
                </button>

                <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Compartir con un departamento
                </div>
                {spaces.length === 0 ? (
                  <p className="px-3 pb-2 text-[10px] text-muted-foreground">
                    No perteneces a ningún departamento todavía.
                  </p>
                ) : (
                  spaces.map(s => (
                    <button
                      key={s.id}
                      onClick={() => handleScopeChange({ kind: 'space', spaceId: s.id })}
                      className={cn(
                        'w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent transition-colors',
                        visibility !== 'private' && visibility !== 'workspace' && spaceId === s.id && 'bg-accent/50'
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <Users className="w-3.5 h-3.5" />{s.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Visible solo para {s.name}
                      </span>
                    </button>
                  ))
                )}

                {canPublishWorkspace && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <button
                      onClick={() => handleScopeChange({ kind: 'workspace' })}
                      className={cn(
                        'w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent transition-colors',
                        visibility === 'workspace' && 'bg-accent/50'
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <Globe className="w-3.5 h-3.5" />Toda la empresa
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Cualquier miembro del workspace la puede leer
                      </span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Presencia en vivo (A5): quién más está viendo la nota ahora */}
          <NotePresence
            noteId={initial.id}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            currentUserAvatar={currentUserAvatar}
          />

          {/* Historial de versiones (A4) */}
          <NoteVersions noteId={initial.id} />

          {/* Exportar a PDF (via vista de impresión del navegador) */}
          <button
            onClick={() => window.open(`/print/notes/${initial.id}`, '_blank', 'noopener')}
            title={tr('note.edExportPdf')}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
          >
            <FileDown className="w-3.5 h-3.5" />
          </button>

          {/* Sub-página */}
          <NotesActionsBar
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            parentNoteId={initial.id}
            variant="subtle"
            label={tr('notes.subPage')}
          />

          {canManage && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              title={tr('note.edDeleteNote')}
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
      </div>

      {/* Portada. Nunca hay que subir nada: el color sale del id de la nota, así
          que ningún documento nace en blanco. Elegir otra es opcional y aparece
          al pasar el cursor, para no meter un control más en la primera vista. */}
      <div
        className="group/cover relative h-24 sm:h-32 w-full"
        style={{ background: coverBackground(initial.id, cover) }}
      >
        <div className="absolute bottom-2 right-3 sm:right-6">
          <button
            type="button"
            onClick={() => setShowCoverPicker(v => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md bg-black/25 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm transition-opacity hover:bg-black/40',
              showCoverPicker ? 'opacity-100' : 'opacity-0 group-hover/cover:opacity-100 focus-visible:opacity-100'
            )}
          >
            <Palette className="w-3.5 h-3.5" />
            {tr('note.edChangeCover')}
          </button>

          {showCoverPicker && (
            <div
              className="absolute bottom-full right-0 mb-2 z-50 w-64 rounded-xl border border-border bg-popover p-2.5 shadow-raised"
              onMouseLeave={() => setShowCoverPicker(false)}
            >
              <p className="px-0.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {tr('note.edCoverPalette')}
              </p>
              <div className="grid grid-cols-6 gap-1.5">
                {/* Automática: el color derivado del id. Siempre primera, porque
                    es el default y hay que poder regresar a él. */}
                <button
                  type="button"
                  onClick={() => handleCoverChange(null)}
                  title={tr('note.edCoverAuto')}
                  className={cn(
                    'relative h-7 w-full rounded-md ring-offset-1 ring-offset-popover transition-all hover:scale-105',
                    cover === null ? 'ring-2 ring-primary' : 'ring-1 ring-border'
                  )}
                  style={{ background: coverBackground(initial.id, null) }}
                >
                  <Sparkles className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow" />
                </button>
                {COVER_PRESETS.map(preset => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => handleCoverChange(preset.key)}
                    title={preset.label}
                    className={cn(
                      'h-7 w-full rounded-md ring-offset-1 ring-offset-popover transition-all hover:scale-105',
                      cover === preset.key ? 'ring-2 ring-primary' : 'ring-1 ring-border'
                    )}
                    style={{ background: preset.css }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Columna del documento */}
      <div className="mx-auto w-full max-w-[980px] px-6 sm:px-10 lg:px-12">

      {/* Icon + Title */}
      <div className="mb-2 -mt-9 relative">
        <div className="relative inline-block mb-2">
          <button
            onClick={() => setShowIconPicker(!showIconPicker)}
            className="bg-background border border-border shadow-raised text-foreground hover:bg-accent rounded-xl p-2.5 transition-colors"
            title={tr('note.edChangeIcon')}
          >
            <NoteIcon icon={icon} size={40} />
          </button>
          {showIconPicker && (
            <div
              className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-raised p-2 grid grid-cols-5 gap-1 w-56"
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
          placeholder={tr('search.untitled')}
          rows={1}
          className="w-full text-4xl sm:text-[2.75rem] font-bold tracking-tight text-foreground placeholder:text-muted-foreground/30 bg-transparent border-0 outline-none resize-none leading-[1.15]"
          onInput={e => {
            const target = e.target as HTMLTextAreaElement
            target.style.height = 'auto'
            target.style.height = target.scrollHeight + 'px'
          }}
        />
      </div>

      {/* Author + meta */}
      <p className="text-xs text-muted-foreground mb-3 ml-1">
        {initial.author?.display_name ?? tr('act.user')} · {tr('note.edCreated')} {timeAgo(updatedAt)}
      </p>

      {/* Barra de SOP: tipo de documento + ciclo de vida (estatus/versión/revisión) */}
      <SopMetaBar
        docKind={initial.doc_kind}
        sopStatus={initial.sop_status}
        sopVersion={initial.sop_version}
        reviewDue={initial.review_due}
        onPatch={patch}
      />

      {/* Aprobación / firma de la versión vigente (solo documentos operativos) */}
      {initial.doc_kind !== 'note' && <SopApproval noteId={initial.id} />}

      {/* Editor */}
      <RichTextEditor
        value={initial.content ?? ''}
        placeholder={tr('note.edEditorPlaceholder')}
        onSave={(html) => patch({ content: html || null })}
        onDirty={() => setStatus(s => (s === 'saving' ? s : 'dirty'))}
        autosaveMs={1200}
        blocks="full"
        density="page"
        workspaceId={workspaceId}
        noteId={initial.id}
      />

      {/* Sub-páginas */}
      {childNotes.length > 0 && (
        <div className="mt-10 pt-6 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {tr('note.edSubpages')}
          </h3>
          <div className="space-y-1">
            {childNotes.map(child => (
              <Link
                key={child.id}
                href={`/w/${workspaceSlug}/notes/${child.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-sm text-foreground"
              >
                <NoteIcon icon={child.icon} size={16} className="flex-shrink-0 text-muted-foreground" />
                <span>{child.title || tr('search.untitled')}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Cumplimiento obligatorio + acuse de lectura (solo documentos operativos) */}
      {initial.doc_kind !== 'note' && (
        <>
          <SopCompliance noteId={initial.id} />
          <SopAcknowledge noteId={initial.id} />
        </>
      )}

      {/* Backlinks (A3): notas que enlazan a esta */}
      <NoteBacklinks noteId={initial.id} workspaceSlug={workspaceSlug} />

      {/* Comentarios (hilo lateral) */}
      <NoteComments noteId={initial.id} currentUserId={currentUserId} />
      </div>
    </div>
  )
}

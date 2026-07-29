'use client'

/**
 * Sidebar persistente del wiki, tree, favoritos, recientes, context menu, inline rename.
 *
 * Features:
 *   - Tree jerárquico con expand/collapse (estado en localStorage por workspace)
 *   - Highlight de nota actual + auto-expand de sus ancestros
 *   - Recientes (últimas 8, localStorage) + Favoritos (starred, localStorage)
 *   - Inline "+" al hover para crear sub-página
 *   - **Click derecho** → menú con: Renombrar, Duplicar, Favorito, Eliminar
 *   - **Doble click en título** → editar inline
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Pencil, Plus, Copy, Star, Trash2, Building2, ChevronDown, Hash, Lock, FileText, ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import { promptDialog } from '@/components/PromptDialog'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import { NoteIcon, DEFAULT_NOTE_ICON } from '@/lib/note-icons'

interface NoteRow {
  id: string
  title: string
  icon: string | null
  parent_note_id: string | null
  space_id: string | null
  visibility: string
  updated_at: string
  created_by: string | null
}

interface SpaceRow {
  id: string
  name: string
  icon: string | null
  color: string | null
  is_restricted: boolean
  created_by: string | null
}

interface NoteNode extends NoteRow {
  children: NoteNode[]
}

interface NotesTreeSidebarProps {
  notes: NoteRow[]
  spaces: SpaceRow[]
  workspaceId: string
  workspaceSlug: string
  currentUserId: string
}

// Departamento seleccionado en el switcher. 'all' = todo el workspace,
// 'general' = notas sin departamento, o el id de un departamento concreto.
type SpaceFilter = 'all' | 'general' | string

interface ContextMenuState {
  noteId: string
  x: number
  y: number
}

function buildTree(notes: NoteRow[]): NoteNode[] {
  const map = new Map<string, NoteNode>()
  notes.forEach(n => map.set(n.id, { ...n, children: [] }))
  const roots: NoteNode[] = []
  notes.forEach(n => {
    const node = map.get(n.id)!
    if (n.parent_note_id && map.has(n.parent_note_id)) {
      map.get(n.parent_note_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  const sortRec = (nodes: NoteNode[]) => {
    nodes.sort((a, b) => a.title.localeCompare(b.title))
    nodes.forEach(n => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

function ancestorsOf(noteId: string, notes: NoteRow[]): string[] {
  const map = new Map(notes.map(n => [n.id, n]))
  const ancestors: string[] = []
  let current = map.get(noteId)
  while (current?.parent_note_id) {
    ancestors.push(current.parent_note_id)
    current = map.get(current.parent_note_id)
  }
  return ancestors
}

// Devuelve todos los descendientes (ids) de una nota, recursivo
function descendantsOf(noteId: string, notes: NoteRow[]): Set<string> {
  const out = new Set<string>()
  const stack = [noteId]
  while (stack.length) {
    const cur = stack.pop()!
    notes.forEach(n => {
      if (n.parent_note_id === cur) {
        out.add(n.id)
        stack.push(n.id)
      }
    })
  }
  return out
}

export function NotesTreeSidebar({
  notes, spaces, workspaceId, workspaceSlug,
}: NotesTreeSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  // Colaboración en vivo: el árbol de notas se actualiza cuando otro usuario
  // crea, renombra, mueve o borra una nota.
  useRealtimeRefresh({
    channel: `notes-${workspaceId}`,
    tables: [{ table: 'notes', filter: `workspace_id=eq.${workspaceId}` }],
  })

  const currentNoteId = useMemo(() => {
    const match = pathname.match(/\/notes\/([^/]+)/)
    return match ? match[1] : null
  }, [pathname])

  const expandedKey = `notes-expanded-${workspaceId}`
  const recentKey   = `notes-recent-${workspaceId}`
  const favKey      = `notes-favs-${workspaceId}`
  const spaceKey    = `notes-space-${workspaceId}`

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [recent, setRecent]     = useState<string[]>([])
  const [favs, setFavs]         = useState<Set<string>>(new Set())
  const [mounted, setMounted]   = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [spaceFilter, setSpaceFilter] = useState<SpaceFilter>('all')
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false)
  const [creatingSpace, setCreatingSpace] = useState(false)

  // Hidratar
  useEffect(() => {
    try {
      const e = localStorage.getItem(expandedKey)
      if (e) setExpanded(new Set(JSON.parse(e)))
      const r = localStorage.getItem(recentKey)
      if (r) setRecent(JSON.parse(r))
      const f = localStorage.getItem(favKey)
      if (f) setFavs(new Set(JSON.parse(f)))
      const s = localStorage.getItem(spaceKey)
      if (s) setSpaceFilter(s)
    } catch { /* ignorar */ }
    setMounted(true)
  }, [expandedKey, recentKey, favKey, spaceKey])

  const selectSpace = useCallback((f: SpaceFilter) => {
    setSpaceFilter(f)
    setSpaceMenuOpen(false)
    try { localStorage.setItem(spaceKey, f) } catch {}
  }, [spaceKey])

  // Recientes + auto-expand al abrir nota
  useEffect(() => {
    if (!mounted || !currentNoteId) return
    setRecent(prev => {
      const next = [currentNoteId, ...prev.filter(id => id !== currentNoteId)].slice(0, 8)
      try { localStorage.setItem(recentKey, JSON.stringify(next)) } catch {}
      return next
    })
    const ancestors = ancestorsOf(currentNoteId, notes)
    if (ancestors.length > 0) {
      setExpanded(prev => {
        const next = new Set(prev)
        ancestors.forEach(id => next.add(id))
        try { localStorage.setItem(expandedKey, JSON.stringify([...next])) } catch {}
        return next
      })
    }
  }, [currentNoteId, mounted, notes, recentKey, expandedKey])

  // Cerrar context menu al click fuera
  useEffect(() => {
    if (!contextMenu) return
    function close() { setContextMenu(null) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  // Atajos de teclado globales (cuando hay nota actual abierta)
  useEffect(() => {
    if (!currentNoteId) return
    function onKey(e: KeyboardEvent) {
      // Ignorar si está escribiendo en input/textarea
      const t = e.target as HTMLElement
      const isTyping = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      if (isTyping) return

      if (e.key === 'F2') {
        e.preventDefault()
        setRenaming(currentNoteId)
      } else if (e.key === 'Delete') {
        e.preventDefault()
        const note = notes.find(n => n.id === currentNoteId)
        if (note) deleteNote(note.id, note.title)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNoteId, notes])

  const toggleExpanded = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(expandedKey, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [expandedKey])

  const toggleFav = useCallback((id: string) => {
    setFavs(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(favKey, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [favKey])

  // ── Acciones ──────────────────────────────────────────────────────────────
  async function createSubpage(parentId: string | null) {
    if (creatingUnder) return
    setCreatingUnder(parentId ?? 'root')
    // Una sub-pagina hereda el departamento del padre. Una pagina raiz se crea
    // en el departamento seleccionado (null si es 'Todos' o 'General').
    const parentSpace = parentId ? notes.find(n => n.id === parentId)?.space_id ?? null : null
    const rootSpace = spaceFilter === 'all' || spaceFilter === 'general' ? null : spaceFilter
    const space_id = parentId ? parentSpace : rootSpace
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          parent_note_id: parentId ?? null,
          space_id,
          title: 'Sin título',
          // Nace privada. El autor decide despues si la comparte con su
          // departamento (ver src/lib/note-visibility.ts).
          visibility: 'private',
          icon: DEFAULT_NOTE_ICON,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      if (parentId) {
        setExpanded(prev => {
          const next = new Set(prev)
          next.add(parentId)
          try { localStorage.setItem(expandedKey, JSON.stringify([...next])) } catch {}
          return next
        })
      }
      router.push(`/w/${workspaceSlug}/notes/${data.id}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear')
    } finally {
      setCreatingUnder(null)
    }
  }

  async function createSpace() {
    if (creatingSpace) return
    setSpaceMenuOpen(false)
    const name = await promptDialog({
      title: 'Nuevo departamento',
      label: 'Nombre del departamento (RH, Marketing, Legal...)',
      placeholder: 'Ej. Marketing',
      confirmLabel: 'Crear',
      validate: (v) => (v.length > 60 ? 'Máximo 60 caracteres.' : null),
    })
    if (!name) return
    setCreatingSpace(true)
    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      toast.success(`Departamento "${name}" creado`)
      selectSpace(data.id)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear departamento')
    } finally {
      setCreatingSpace(false)
    }
  }

  async function renameNote(id: string, newTitle: string) {
    const trimmed = newTitle.trim() || 'Sin título'
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Error')
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al renombrar')
    }
  }

  async function duplicateNote(id: string) {
    try {
      const res = await fetch(`/api/notes/${id}/duplicate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      toast.success('Nota duplicada')
      router.push(`/w/${workspaceSlug}/notes/${data.id}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al duplicar')
    }
  }

  async function deleteNote(id: string, title: string) {
    const childrenIds = notes.filter(n => n.parent_note_id === id).map(n => n.id)
    const message = childrenIds.length > 0
      ? `¿Eliminar "${title}" y sus ${childrenIds.length} sub-página(s)? No se puede deshacer.`
      : `¿Eliminar "${title}"? No se puede deshacer.`

    if (!(await confirmDialog({ message, destructive: true, confirmLabel: 'Eliminar' }))) return

    try {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Error')
      }
      toast.success('Nota eliminada')
      // Si la nota actual fue eliminada, ir a /notes
      if (currentNoteId === id || childrenIds.includes(currentNoteId ?? '')) {
        router.push(`/w/${workspaceSlug}/notes`)
      } else {
        router.refresh()
      }
      // Limpiar de favoritos/recientes
      setFavs(prev => {
        const next = new Set(prev)
        next.delete(id)
        try { localStorage.setItem(favKey, JSON.stringify([...next])) } catch {}
        return next
      })
      setRecent(prev => {
        const next = prev.filter(rid => rid !== id)
        try { localStorage.setItem(recentKey, JSON.stringify(next)) } catch {}
        return next
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    }
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const forbiddenDropIds = useMemo(() => {
    if (!draggingId) return new Set<string>()
    const set = descendantsOf(draggingId, notes)
    set.add(draggingId)  // no permitir drop sobre sí mismo
    return set
  }, [draggingId, notes])

  function handleDragStart(e: DragStartEvent) {
    setDraggingId(e.active.id as string)
  }

  async function handleDragEnd(e: DragEndEvent) {
    setDraggingId(null)
    const noteId = e.active.id as string
    const overId = e.over?.id as string | undefined
    if (!overId) return

    // overId puede ser 'root' (drop al root) o un noteId
    const newParentId = overId === 'root' ? null : overId
    if (newParentId === noteId) return  // no parent a sí mismo

    const note = notes.find(n => n.id === noteId)
    if (!note) return
    if (note.parent_note_id === newParentId) return  // sin cambio

    // Validar ciclo
    if (newParentId && descendantsOf(noteId, notes).has(newParentId)) {
      toast.error('No se puede mover una nota dentro de su propia descendencia')
      return
    }

    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_note_id: newParentId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Error')
      }
      toast.success(newParentId ? 'Nota movida' : 'Nota movida a raíz')
      // Auto-expand el nuevo padre
      if (newParentId) {
        setExpanded(prev => {
          const next = new Set(prev)
          next.add(newParentId)
          try { localStorage.setItem(expandedKey, JSON.stringify([...next])) } catch {}
          return next
        })
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al mover')
    }
  }

  // ── Estructuras derivadas ─────────────────────────────────────────────────
  // Si el departamento seleccionado ya no existe (fue borrado), caer a 'all'.
  const activeFilter: SpaceFilter = useMemo(() => {
    if (spaceFilter === 'all' || spaceFilter === 'general') return spaceFilter
    return spaces.some(s => s.id === spaceFilter) ? spaceFilter : 'all'
  }, [spaceFilter, spaces])

  const activeSpace = useMemo(
    () => (activeFilter === 'all' || activeFilter === 'general'
      ? null
      : spaces.find(s => s.id === activeFilter) ?? null),
    [activeFilter, spaces],
  )

  // Notas visibles en el arbol segun el departamento activo.
  const treeNotes = useMemo(() => {
    if (activeFilter === 'all') return notes
    if (activeFilter === 'general') return notes.filter(n => !n.space_id)
    return notes.filter(n => n.space_id === activeFilter)
  }, [notes, activeFilter])

  const tree = useMemo(() => buildTree(treeNotes), [treeNotes])
  const notesById = useMemo(() => new Map(notes.map(n => [n.id, n])), [notes])

  const favNotes = useMemo(() =>
    [...favs].map(id => notesById.get(id)).filter((n): n is NoteRow => !!n)
  , [favs, notesById])

  const recentNotes = useMemo(() =>
    recent.map(id => notesById.get(id)).filter((n): n is NoteRow => !!n).slice(0, 5)
  , [recent, notesById])

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
      <aside className="w-52 sm:w-64 flex-shrink-0 border-r border-border bg-muted/30 flex flex-col">
        <div className="relative flex items-center justify-between gap-1 px-2 py-2 border-b border-border">
          <button
            onClick={() => setSpaceMenuOpen(o => !o)}
            className="flex-1 flex items-center gap-1.5 min-w-0 px-1.5 py-1 rounded-md hover:bg-accent transition-colors"
            title="Cambiar de departamento"
          >
            {activeSpace ? (
              <span
                className="flex-shrink-0 w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: activeSpace.color ?? 'var(--muted-foreground)' }}
              />
            ) : (
              <Building2 className="flex-shrink-0 w-3.5 h-3.5 text-muted-foreground" />
            )}
            <span className="truncate text-sm font-semibold text-foreground">
              {activeFilter === 'all' ? 'Todos los departamentos'
                : activeFilter === 'general' ? 'General'
                : activeSpace?.name ?? 'Departamento'}
            </span>
            <ChevronDown className={cn('flex-shrink-0 w-3.5 h-3.5 text-muted-foreground transition-transform', spaceMenuOpen && 'rotate-180')} />
          </button>
          <button
            onClick={() => createSubpage(null)}
            disabled={creatingUnder !== null}
            title="Nueva nota raíz"
            className="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors disabled:opacity-50"
          >
            {creatingUnder === 'root' ? (
              <span className="block w-3 h-3 border border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            )}
          </button>

          {spaceMenuOpen && (
            <>
              <div className="fixed inset-0 z-[70]" onClick={() => setSpaceMenuOpen(false)} />
              <div className="absolute left-2 right-2 top-full z-[71] mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
                <SpaceMenuItem
                  active={activeFilter === 'all'}
                  onClick={() => selectSpace('all')}
                  icon={<Building2 className="w-3.5 h-3.5 text-muted-foreground" />}
                  label="Todos los departamentos"
                />
                <SpaceMenuItem
                  active={activeFilter === 'general'}
                  onClick={() => selectSpace('general')}
                  icon={<Hash className="w-3.5 h-3.5 text-muted-foreground" />}
                  label="General (sin departamento)"
                />
                {spaces.length > 0 && <div className="my-1 h-px bg-border" />}
                {spaces.map(s => (
                  <SpaceMenuItem
                    key={s.id}
                    active={activeFilter === s.id}
                    onClick={() => selectSpace(s.id)}
                    icon={
                      <span
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: s.color ?? 'var(--muted-foreground)' }}
                      />
                    }
                    label={s.name}
                    restricted={s.is_restricted}
                  />
                ))}
                <div className="my-1 h-px bg-border" />
                <button
                  onClick={createSpace}
                  disabled={creatingSpace}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="flex-1">Nuevo departamento</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Lente transversal: todos los procesos y SOPs del workspace */}
        <div className="px-1 pt-1.5">
          <Link
            href={`/w/${workspaceSlug}/notes/sops`}
            className={cn(
              'flex items-center gap-2 px-2.5 py-1.5 mx-1 rounded-md text-sm font-medium transition-colors',
              pathname.endsWith('/notes/sops')
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'text-foreground hover:bg-accent/60'
            )}
          >
            <ClipboardList className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">Procesos y SOPs</span>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5">
          {favNotes.length > 0 && (
            <Section title="Favoritos">
              {favNotes.map(n => (
                <SimpleRow
                  key={n.id}
                  note={n}
                  workspaceSlug={workspaceSlug}
                  active={currentNoteId === n.id}
                  onToggleFav={() => toggleFav(n.id)}
                  isFav
                  onContextMenu={(x, y) => setContextMenu({ noteId: n.id, x, y })}
                />
              ))}
            </Section>
          )}

          {recentNotes.length > 0 && (
            <Section title="Recientes">
              {recentNotes.map(n => (
                <SimpleRow
                  key={n.id}
                  note={n}
                  workspaceSlug={workspaceSlug}
                  active={currentNoteId === n.id}
                  onToggleFav={() => toggleFav(n.id)}
                  isFav={favs.has(n.id)}
                  onContextMenu={(x, y) => setContextMenu({ noteId: n.id, x, y })}
                />
              ))}
            </Section>
          )}

          <Section title={activeSpace ? activeSpace.name : activeFilter === 'general' ? 'General' : 'Todas las páginas'}>
            {tree.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                <div className="rounded-full bg-muted p-2.5">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {activeSpace
                    ? `Sin páginas en ${activeSpace.name} todavía.`
                    : 'Sin notas todavía.'}
                </p>
                <button
                  onClick={() => createSubpage(null)}
                  disabled={creatingUnder !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" /> Crear primera página
                </button>
              </div>
            ) : (
              tree.map(node => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  toggleExpanded={toggleExpanded}
                  currentNoteId={currentNoteId}
                  workspaceSlug={workspaceSlug}
                  onCreateChild={createSubpage}
                  creatingUnder={creatingUnder}
                  onToggleFav={toggleFav}
                  favs={favs}
                  renaming={renaming}
                  setRenaming={setRenaming}
                  onRename={renameNote}
                  onContextMenu={(x, y, id) => setContextMenu({ noteId: id, x, y })}
                  onRequestDelete={deleteNote}
                  draggingId={draggingId}
                  forbiddenDropIds={forbiddenDropIds}
                />
              ))
            )}
          </Section>

          {/* Drop zone para mover a raíz (al final del tree) */}
          <RootDropZone draggingId={draggingId} />
        </div>
      </aside>

      <DragOverlay dropAnimation={null}>
        {draggingId && notesById.get(draggingId) && (
          <div className="bg-popover border border-border shadow-raised rounded-md px-3 py-1.5 text-sm text-foreground flex items-center gap-2 max-w-xs">
            <NoteIcon icon={notesById.get(draggingId)!.icon} size={14} className="flex-shrink-0 text-muted-foreground" />
            <span className="truncate">{notesById.get(draggingId)!.title || 'Sin título'}</span>
          </div>
        )}
      </DragOverlay>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          note={notesById.get(contextMenu.noteId)}
          isFav={favs.has(contextMenu.noteId)}
          onRename={() => { setRenaming(contextMenu.noteId); setContextMenu(null) }}
          onDuplicate={() => { duplicateNote(contextMenu.noteId); setContextMenu(null) }}
          onToggleFav={() => { toggleFav(contextMenu.noteId); setContextMenu(null) }}
          onDelete={() => {
            const note = notesById.get(contextMenu.noteId)
            if (note) deleteNote(note.id, note.title)
            setContextMenu(null)
          }}
          onCreateChild={() => { createSubpage(contextMenu.noteId); setContextMenu(null) }}
        />
      )}
      </DndContext>
    </>
  )
}

// ── Root drop zone (mueve a raíz) ───────────────────────────────────────────
function RootDropZone({ draggingId }: { draggingId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'root' })
  if (!draggingId) return null
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mx-3 my-2 px-3 py-2 text-xs text-center rounded-md border-2 border-dashed transition-colors',
        isOver
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border/60 text-muted-foreground'
      )}
    >
      Soltar aquí para mover a raíz
    </div>
  )
}

// ── Space (departamento) menu item ──────────────────────────────────────────
function SpaceMenuItem({
  active, onClick, icon, label, restricted,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  restricted?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors',
        active ? 'bg-accent text-accent-foreground font-medium' : 'text-foreground hover:bg-accent/60',
      )}
    >
      <span className="flex-shrink-0 flex items-center justify-center w-4">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {restricted && <Lock className="flex-shrink-0 w-3 h-3 text-muted-foreground" />}
    </button>
  )
}

// ── Section ─────────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="px-3 py-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {title}
        </p>
      </div>
      <div>{children}</div>
    </div>
  )
}

// ── Simple row ──────────────────────────────────────────────────────────────
function SimpleRow({
  note, workspaceSlug, active, onToggleFav, isFav, onContextMenu,
}: {
  note: NoteRow
  workspaceSlug: string
  active: boolean
  onToggleFav: () => void
  isFav: boolean
  onContextMenu: (x: number, y: number) => void
}) {
  return (
    <div
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e.clientX, e.clientY) }}
      className={cn(
        'group flex items-center gap-1.5 pl-3 pr-2 py-1 mx-1 rounded-md transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      )}
    >
      <Link
        href={`/w/${workspaceSlug}/notes/${note.id}`}
        className="flex-1 flex items-center gap-1.5 text-sm min-w-0"
      >
        <NoteIcon icon={note.icon} size={14} className="flex-shrink-0 text-muted-foreground" />
        <span className="truncate">{note.title || 'Sin título'}</span>
      </Link>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFav() }}
        className={cn(
          'flex-shrink-0 p-0.5 rounded transition-opacity',
          isFav ? 'opacity-100 text-amber-500' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground'
        )}
        title={isFav ? 'Quitar favorito' : 'Marcar favorito'}
      >
        <StarIcon filled={isFav} />
      </button>
    </div>
  )
}

// ── Tree node ───────────────────────────────────────────────────────────────
// NOTA (virtualizacion, deliberadamente omitida): este arbol es recursivo y con
// estado por nodo (expand/collapse desde localStorage) mas drag & drop de
// @dnd-kit (cada TreeNode registra useDraggable + useDroppable). Virtualizar con
// useVirtualizer exigiria aplanar el arbol visible a una lista lineal en cada
// render y re-cablear los refs de dnd por fila, lo que rompe el reparentado por
// arrastre y el resaltado de drop target. El costo de romperlo supera al
// beneficio (la barra lateral rara vez pasa de unas decenas de nodos visibles a
// la vez, ya que los colapsados no se montan). Se deja como esfuerzo aparte.
function TreeNode({
  node, depth, expanded, toggleExpanded, currentNoteId, workspaceSlug,
  onCreateChild, creatingUnder, onToggleFav, favs,
  renaming, setRenaming, onRename, onContextMenu, onRequestDelete,
  draggingId, forbiddenDropIds,
}: {
  node: NoteNode
  depth: number
  expanded: Set<string>
  toggleExpanded: (id: string) => void
  currentNoteId: string | null
  workspaceSlug: string
  onCreateChild: (parentId: string | null) => void
  creatingUnder: string | null
  onToggleFav: (id: string) => void
  favs: Set<string>
  renaming: string | null
  setRenaming: (id: string | null) => void
  onRename: (id: string, title: string) => void
  onContextMenu: (x: number, y: number, id: string) => void
  onRequestDelete: (id: string, title: string) => void
  draggingId: string | null
  forbiddenDropIds: Set<string>
}) {
  const isExpanded = expanded.has(node.id)
  const hasChildren = node.children.length > 0
  const active = currentNoteId === node.id
  const isFav = favs.has(node.id)
  const isCreating = creatingUnder === node.id
  const isRenaming = renaming === node.id

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.id,
    disabled: isRenaming,
  })
  const isForbidden = forbiddenDropIds.has(node.id)
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: node.id,
    disabled: isForbidden || draggingId === null,
  })
  const setRef = (el: HTMLDivElement | null) => {
    setDragRef(el)
    setDropRef(el)
  }
  const isDropTarget = isOver && !isForbidden

  return (
    <div>
      <div
        ref={setRef}
        {...attributes}
        {...listeners}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e.clientX, e.clientY, node.id) }}
        className={cn(
          'group flex items-center gap-0.5 pr-2 py-1 mx-1 rounded-md transition-colors',
          active && !isDropTarget ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
          isDragging && 'opacity-40',
          isDropTarget && 'bg-primary/15 ring-1 ring-primary',
        )}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => toggleExpanded(node.id)}
            className="flex-shrink-0 p-0.5 rounded hover:bg-foreground/10 text-muted-foreground transition-colors"
            aria-label={isExpanded ? 'Colapsar' : 'Expandir'}
          >
            <svg
              width="11" height="11" viewBox="0 0 12 12" fill="none"
              className={cn('transition-transform', isExpanded ? 'rotate-90' : '')}
            >
              <path d="M4 3l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="w-[19px] flex-shrink-0" />
        )}

        {isRenaming ? (
          <RenameInput
            initial={node.title}
            icon={node.icon}
            onSubmit={(t) => { onRename(node.id, t); setRenaming(null) }}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <Link
            href={`/w/${workspaceSlug}/notes/${node.id}`}
            onDoubleClick={(e) => { e.preventDefault(); setRenaming(node.id) }}
            className="flex-1 flex items-center gap-1.5 text-sm min-w-0"
            title="Doble clic para renombrar · Clic derecho para más"
          >
            <NoteIcon icon={node.icon} size={14} className="flex-shrink-0 text-muted-foreground" />
            <span className="truncate">{node.title || 'Sin título'}</span>
          </Link>
        )}

        {!isRenaming && (
          <>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFav(node.id) }}
              className={cn(
                'flex-shrink-0 p-0.5 rounded transition-opacity',
                isFav ? 'opacity-100 text-amber-500' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground'
              )}
              title={isFav ? 'Quitar favorito' : 'Marcar favorito'}
            >
              <StarIcon filled={isFav} />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCreateChild(node.id) }}
              disabled={creatingUnder !== null}
              className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all disabled:opacity-30"
              title="Crear sub-página"
            >
              {isCreating ? (
                <span className="block w-3 h-3 border border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              ) : (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRequestDelete(node.id, node.title) }}
              className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
              title="Eliminar"
            >
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M6 6.5v4M8 6.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M3 4l.8 7.2A1 1 0 004.8 12h4.4a1 1 0 001-.8L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </>
        )}
      </div>

      {isExpanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
              currentNoteId={currentNoteId}
              workspaceSlug={workspaceSlug}
              onCreateChild={onCreateChild}
              creatingUnder={creatingUnder}
              onToggleFav={onToggleFav}
              favs={favs}
              renaming={renaming}
              setRenaming={setRenaming}
              onRename={onRename}
              onContextMenu={onContextMenu}
              onRequestDelete={onRequestDelete}
              draggingId={draggingId}
              forbiddenDropIds={forbiddenDropIds}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Rename input ────────────────────────────────────────────────────────────
function RenameInput({
  initial, icon, onSubmit, onCancel,
}: {
  initial: string
  icon: string | null
  onSubmit: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className="flex-1 flex items-center gap-1.5 min-w-0">
      <NoteIcon icon={icon} size={14} className="flex-shrink-0 text-muted-foreground" />
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onSubmit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onSubmit(value) }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        onClick={(e) => e.stopPropagation()}
        className="flex-1 text-sm bg-background border border-ring rounded px-1.5 py-0.5 outline-none min-w-0"
      />
    </div>
  )
}

// ── Context menu ────────────────────────────────────────────────────────────
function ContextMenu({
  x, y, note, isFav,
  onRename, onDuplicate, onToggleFav, onDelete, onCreateChild,
}: {
  x: number
  y: number
  note: NoteRow | undefined
  isFav: boolean
  onRename: () => void
  onDuplicate: () => void
  onToggleFav: () => void
  onDelete: () => void
  onCreateChild: () => void
}) {
  if (!note) return null

  // Posicionamiento que no sale de la pantalla (best effort)
  const menuW = 200
  const menuH = 220
  const adjX = x + menuW > window.innerWidth ? window.innerWidth - menuW - 8 : x
  const adjY = y + menuH > window.innerHeight ? window.innerHeight - menuH - 8 : y

  return (
    <div
      className="fixed z-[80] w-50 bg-popover border border-border rounded-lg shadow-raised py-1 animate-in fade-in zoom-in-95 duration-100"
      style={{ top: adjY, left: adjX, width: menuW }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ContextItem icon={<Pencil className="w-3.5 h-3.5" />} label="Renombrar" hint="F2 / doble clic" onClick={onRename} />
      <ContextItem icon={<Plus className="w-3.5 h-3.5" />} label="Sub-página" onClick={onCreateChild} />
      <ContextItem icon={<Copy className="w-3.5 h-3.5" />} label="Duplicar" onClick={onDuplicate} />
      <ContextItem
        icon={<Star className={cn('w-3.5 h-3.5', isFav && 'fill-amber-400 text-amber-400')} />}
        label={isFav ? 'Quitar favorito' : 'Marcar favorito'}
        onClick={onToggleFav}
      />
      <div className="h-px bg-border my-1" />
      <ContextItem
        icon={<Trash2 className="w-3.5 h-3.5" />}
        label="Eliminar"
        onClick={onDelete}
        destructive
      />
    </div>
  )
}

function ContextItem({
  icon, label, hint, onClick, destructive,
}: {
  icon: ReactNode
  label: string
  hint?: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors',
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-accent'
      )}
    >
      <span className="text-sm leading-none">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </button>
  )
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill={filled ? 'currentColor' : 'none'}>
      <path
        d="M7 1.5l1.8 3.6 4 .6-2.9 2.8.7 4L7 10.6l-3.6 1.9.7-4L1.2 5.7l4-.6L7 1.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

'use client'

/**
 * CommandPalette, modal de búsqueda global (Cmd+K).
 *
 * Features:
 *   - Búsqueda en tasks, projects, teams, members del workspace
 *   - Navegación con teclado (↑↓ Enter Esc)
 *   - Quick actions cuando no hay query (mis tareas, inbox, ir al inicio…)
 *   - Animación slide-down + backdrop blur
 *   - Debounce 200ms en el fetch
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { toast } from 'sonner'
import { cn, getInitials } from '@/lib/utils'
import { ProjectIcon } from '@/lib/project-icons'
import { useCommandPalette } from '@/stores/command-palette'

interface CommandPaletteProps {
  workspaceSlug: string
  workspaceId: string
  isAdmin?: boolean
}

interface SearchResult {
  tasks: Array<{
    id: string
    title: string
    project_slug: string | null
    project_name: string | null
    team_slug: string | null
  }>
  projects: Array<{
    id: string
    name: string
    slug: string
    icon: string | null
    team_slug: string | null
  }>
  teams: Array<{
    id: string
    name: string
    slug: string
  }>
  members: Array<{
    id: string
    display_name: string
    avatar_url: string | null
    email: string | null
  }>
  notes: Array<{
    id: string
    title: string
    icon: string | null
    doc_kind: string | null
  }>
}

const EMPTY_RESULT: SearchResult = { tasks: [], projects: [], teams: [], members: [], notes: [] }

interface FlatItem {
  id: string
  type: 'task' | 'project' | 'team' | 'member' | 'note' | 'action'
  label: string
  sublabel?: string
  href?: string
  // Acción in situ (crear nota…): si está, se ejecuta en vez de navegar.
  onSelect?: () => void | Promise<void>
  icon?: React.ReactNode
  avatarUrl?: string | null
  initials?: string
  group: string
}

export function CommandPalette({ workspaceSlug, workspaceId, isAdmin = false }: CommandPaletteProps) {
  const router = useRouter()
  const { open, setOpen, toggle } = useCommandPalette()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Crea una nota rápida (en blanco o con el texto tecleado como título) y salta
  // al editor. Reutiliza POST /api/notes, el mismo endpoint del botón "Nueva nota".
  const createNote = useCallback(async (title: string) => {
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          title: title.trim() || 'Sin título',
          visibility: 'workspace',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Error')
      setOpen(false)
      router.push(`/w/${workspaceSlug}/notes/${data.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear la nota')
    } finally {
      setCreating(false)
    }
  }, [creating, workspaceId, workspaceSlug, router, setOpen])

  // ── Hotkey global (Cmd+K / Ctrl+K) ────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, toggle, setOpen])

  // ── Reset al abrir ────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setResults(null)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    if (!query.trim()) {
      setResults(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const handle = setTimeout(async () => {
      try {
        const url = `/api/search?q=${encodeURIComponent(query.trim())}&workspace_id=${encodeURIComponent(workspaceId)}`
        const res = await fetch(url)
        if (!res.ok) throw new Error()
        const data: SearchResult = await res.json()
        setResults(data)
        setActiveIndex(0)
      } catch {
        setResults(EMPTY_RESULT)
      } finally {
        setLoading(false)
      }
    }, 180)
    return () => clearTimeout(handle)
  }, [query, open, workspaceId])

  // ── Aplanar resultados para nav con teclado ───────────────────────────────
  const items: FlatItem[] = useMemo(() => {
    if (!query.trim()) {
      // Quick actions cuando no hay query
      return [
        {
          id: 'a-home',
          type: 'action',
          label: 'Ir al inicio del workspace',
          href: `/w/${workspaceSlug}`,
          icon: <HomeIcon />,
          group: 'Navegación',
        },
        {
          id: 'a-mytasks',
          type: 'action',
          label: 'Mis tareas',
          href: `/w/${workspaceSlug}/my-tasks`,
          icon: <TasksIcon />,
          group: 'Navegación',
        },
        {
          id: 'a-inbox',
          type: 'action',
          label: 'Bandeja',
          href: `/w/${workspaceSlug}/inbox`,
          icon: <InboxIcon />,
          group: 'Navegación',
        },
        {
          id: 'a-newnote',
          type: 'action',
          label: 'Crear nota',
          onSelect: () => createNote('Sin título'),
          icon: <NoteIcon />,
          group: 'Acciones',
        },
        // Crear equipo: solo administradores del workspace.
        ...(isAdmin ? [{
          id: 'a-newteam',
          type: 'action' as const,
          label: 'Crear equipo',
          href: `/w/${workspaceSlug}/teams/new`,
          icon: <PlusIcon />,
          group: 'Acciones',
        }] : []),
        {
          id: 'a-newws',
          type: 'action',
          label: 'Crear workspace',
          href: `/settings/workspaces/new`,
          icon: <PlusIcon />,
          group: 'Acciones',
        },
      ]
    }

    if (!results) return []

    const flat: FlatItem[] = []
    // Acción contextual arriba de todo: crear una nota con el texto tecleado.
    flat.push({
      id: 'a-createnote-q',
      type: 'action',
      label: `Crear nota «${query.trim()}»`,
      onSelect: () => createNote(query.trim()),
      icon: <PlusIcon />,
      group: 'Crear',
    })
    results.tasks.forEach(t => flat.push({
      id: `t-${t.id}`,
      type: 'task',
      label: t.title,
      sublabel: t.project_name ?? undefined,
      href: t.team_slug && t.project_slug
        ? `/w/${workspaceSlug}/t/${t.team_slug}/p/${t.project_slug}`
        : undefined,
      icon: <TaskIcon />,
      group: 'Tareas',
    }))
    results.projects.forEach(p => flat.push({
      id: `p-${p.id}`,
      type: 'project',
      label: p.name,
      href: p.team_slug ? `/w/${workspaceSlug}/t/${p.team_slug}/p/${p.slug}` : undefined,
      icon: <ProjectIcon icon={p.icon} size={16} />,
      group: 'Proyectos',
    }))
    results.teams.forEach(t => flat.push({
      id: `tm-${t.id}`,
      type: 'team',
      label: t.name,
      href: `/w/${workspaceSlug}/t/${t.slug}`,
      icon: <TeamIcon />,
      group: 'Equipos',
    }))
    results.notes.forEach(n => flat.push({
      id: `n-${n.id}`,
      type: 'note',
      label: n.title || 'Sin título',
      sublabel: n.doc_kind && n.doc_kind !== 'note' ? 'Documento' : undefined,
      href: `/w/${workspaceSlug}/notes/${n.id}`,
      icon: <NoteIcon />,
      group: 'Notas',
    }))
    results.members.forEach(m => flat.push({
      id: `m-${m.id}`,
      type: 'member',
      label: m.display_name,
      sublabel: m.email ?? undefined,
      avatarUrl: m.avatar_url,
      initials: getInitials(m.display_name),
      group: 'Personas',
    }))
    return flat
  }, [results, query, workspaceSlug, isAdmin, createNote])

  // ── Agrupar para render ───────────────────────────────────────────────────
  const groups = useMemo(() => {
    const map = new Map<string, FlatItem[]>()
    items.forEach(item => {
      if (!map.has(item.group)) map.set(item.group, [])
      map.get(item.group)!.push(item)
    })
    return Array.from(map.entries())
  }, [items])

  // ── Selection navegation ──────────────────────────────────────────────────
  const select = useCallback((item: FlatItem) => {
    // Acción in situ (crear nota): se encarga de cerrar/navegar por su cuenta.
    if (item.onSelect) {
      item.onSelect()
      return
    }
    setOpen(false)
    if (item.href) {
      router.push(item.href)
    }
  }, [router, setOpen])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (items.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(i => (i + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(i => (i - 1 + items.length) % items.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = items[activeIndex]
        if (item) select(item)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, items, activeIndex, select])

  // Auto-scroll item activo
  useEffect(() => {
    if (!listRef.current) return
    const activeEl = listRef.current.querySelector<HTMLElement>('[data-active="true"]')
    activeEl?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  let runningIndex = 0
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] animate-in fade-in duration-150"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh] pointer-events-none">
        <div
          className="w-full max-w-xl bg-popover border border-border rounded-xl shadow-overlay pointer-events-auto overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-4 duration-200"
          style={{ maxHeight: '70vh' }}
        >
          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <SearchIcon />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Busca tareas, notas, proyectos, equipos o personas…"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
            {(loading || creating) && (
              <span className="w-3 h-3 border border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            )}
            <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-muted text-muted-foreground rounded border border-border">
              Esc
            </kbd>
          </div>

          {/* Lista */}
          <div ref={listRef} className="flex-1 overflow-y-auto py-1">
            {items.length === 0 && query.trim() && !loading && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Sin resultados para «{query}»
              </div>
            )}

            {groups.map(([group, groupItems]) => (
              <div key={group} className="py-1">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  {group}
                </div>
                {groupItems.map((item) => {
                  const myIndex = runningIndex++
                  const active = myIndex === activeIndex
                  return (
                    <button
                      key={item.id}
                      data-active={active}
                      onMouseEnter={() => setActiveIndex(myIndex)}
                      onClick={() => select(item)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                        active
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground hover:bg-accent/50'
                      )}
                    >
                      <div className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-muted-foreground">
                        {item.avatarUrl ? (
                          <Image
                            src={item.avatarUrl}
                            alt={item.label}
                            width={24}
                            height={24}
                            className="object-cover rounded-full"
                          />
                        ) : item.initials ? (
                          <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium">
                            {item.initials}
                          </span>
                        ) : (
                          item.icon
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{item.label}</div>
                        {item.sublabel && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {item.sublabel}
                          </div>
                        )}
                      </div>
                      {active && (
                        <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-muted text-muted-foreground rounded border border-border">
                          ↵
                        </kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border bg-muted/20 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="font-mono px-1.5 py-0.5 bg-background rounded border border-border">↑↓</kbd>
                Navegar
              </span>
              <span className="flex items-center gap-1">
                <kbd className="font-mono px-1.5 py-0.5 bg-background rounded border border-border">↵</kbd>
                Abrir
              </span>
            </div>
            <span className="text-muted-foreground/70">
              {items.length} resultado{items.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Icons ───────────────────────────────────────────────────────────────────
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-muted-foreground">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
function HomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 6l5-4 5 4v6H2V6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
function TasksIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="2" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="9" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 3.5h5M7 10.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
function InboxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1 7l1.5-4h9L13 7v5H1V7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M1 7h3l1 2h4l1-2h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
function TaskIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
function NoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 1.5h5L11 4.5V12a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 3 12V1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 1.5v3h3M5 7.5h4M5 9.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function TeamIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="5" cy="5" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10" cy="6" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 12c0-2 1.5-3.5 3.5-3.5s3.5 1.5 3.5 3.5M9 12c.5-1.5 1.5-2.5 3-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

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
import {
  Search,
  Home,
  ListChecks,
  Inbox,
  FileText,
  Plus,
  CircleDot,
  Users,
  Settings,
  BarChart3,
  Calendar,
  GraduationCap,
  CornerDownLeft,
  Clock,
  Folder,
} from 'lucide-react'
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

// ── Recientes (persistidos en localStorage) ─────────────────────────────────
// Guardamos lo mínimo para poder renderizar y navegar sin volver a buscar.
type RecentType = 'task' | 'project' | 'team' | 'member' | 'note' | 'action'

interface RecentItem {
  id: string
  type: RecentType
  label: string
  sublabel?: string
  href: string
  iconHint: RecentType
  ts: number
}

const RECENTS_CAP = 8
const recentsKey = (workspaceId: string) => `wlo-cmdk-recents-${workspaceId}`

function loadRecents(workspaceId: string): RecentItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(recentsKey(workspaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r): r is RecentItem =>
        r && typeof r.id === 'string' && typeof r.href === 'string' && typeof r.label === 'string')
      .slice(0, RECENTS_CAP)
  } catch {
    return []
  }
}

function saveRecents(workspaceId: string, list: RecentItem[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(recentsKey(workspaceId), JSON.stringify(list.slice(0, RECENTS_CAP)))
  } catch {
    // localStorage lleno o bloqueado: no es crítico, seguimos sin persistir.
  }
}

// Ícono lucide por tipo de reciente (se reconstruye al render, no se serializa).
function recentIcon(hint: RecentType): React.ReactNode {
  switch (hint) {
    case 'task': return <CircleDot className="w-3.5 h-3.5" />
    case 'project': return <Folder className="w-3.5 h-3.5" />
    case 'team': return <Users className="w-3.5 h-3.5" />
    case 'member': return <Users className="w-3.5 h-3.5" />
    case 'note': return <FileText className="w-3.5 h-3.5" />
    default: return <Home className="w-3.5 h-3.5" />
  }
}

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
  const [recents, setRecents] = useState<RecentItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Registra un item en Recientes (dedupe por id+type, más reciente primero, cap 8).
  const recordRecent = useCallback((r: Omit<RecentItem, 'ts'>) => {
    setRecents(prev => {
      const filtered = prev.filter(x => !(x.id === r.id && x.type === r.type))
      const next = [{ ...r, ts: Date.now() }, ...filtered].slice(0, RECENTS_CAP)
      saveRecents(workspaceId, next)
      return next
    })
  }, [workspaceId])

  // Afijo Cmd (Mac) vs Ctrl (resto) para el hint del atajo.
  const [modKey, setModKey] = useState('Ctrl')
  useEffect(() => {
    if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) {
      setModKey('Cmd')
    }
  }, [])

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
      setRecents(loadRecents(workspaceId))
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, workspaceId])

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
      // Recientes (si hay) arriba, luego quick actions.
      const recentItems: FlatItem[] = recents.map(r => ({
        id: `r-${r.type}-${r.id}`,
        type: r.type,
        label: r.label,
        sublabel: r.sublabel,
        href: r.href,
        icon: recentIcon(r.iconHint),
        group: 'Recientes',
      }))
      return [
        ...recentItems,
        {
          id: 'a-home',
          type: 'action',
          label: 'Ir al inicio del workspace',
          href: `/w/${workspaceSlug}`,
          icon: <Home className="w-3.5 h-3.5" />,
          group: 'Navegación',
        },
        {
          id: 'a-mytasks',
          type: 'action',
          label: 'Mis tareas',
          href: `/w/${workspaceSlug}/my-tasks`,
          icon: <ListChecks className="w-3.5 h-3.5" />,
          group: 'Navegación',
        },
        {
          id: 'a-inbox',
          type: 'action',
          label: 'Bandeja',
          href: `/w/${workspaceSlug}/inbox`,
          icon: <Inbox className="w-3.5 h-3.5" />,
          group: 'Navegación',
        },
        {
          id: 'a-calendar',
          type: 'action',
          label: 'Calendario',
          href: `/w/${workspaceSlug}/calendar`,
          icon: <Calendar className="w-3.5 h-3.5" />,
          group: 'Navegación',
        },
        {
          id: 'a-analytics',
          type: 'action',
          label: 'Analítica',
          href: `/w/${workspaceSlug}/analytics`,
          icon: <BarChart3 className="w-3.5 h-3.5" />,
          group: 'Navegación',
        },
        {
          id: 'a-academia',
          type: 'action',
          label: 'Academia',
          href: `/w/${workspaceSlug}/academia`,
          icon: <GraduationCap className="w-3.5 h-3.5" />,
          group: 'Navegación',
        },
        {
          id: 'a-settings',
          type: 'action',
          label: 'Configuración',
          href: `/w/${workspaceSlug}/settings`,
          icon: <Settings className="w-3.5 h-3.5" />,
          group: 'Navegación',
        },
        {
          id: 'a-newnote',
          type: 'action',
          label: 'Crear nota',
          onSelect: () => createNote('Sin título'),
          icon: <FileText className="w-3.5 h-3.5" />,
          group: 'Acciones',
        },
        // Crear equipo: solo administradores del workspace.
        ...(isAdmin ? [{
          id: 'a-newteam',
          type: 'action' as const,
          label: 'Crear equipo',
          href: `/w/${workspaceSlug}/teams/new`,
          icon: <Plus className="w-3.5 h-3.5" />,
          group: 'Acciones',
        }] : []),
        {
          id: 'a-newws',
          type: 'action',
          label: 'Crear workspace',
          href: `/settings/workspaces/new`,
          icon: <Plus className="w-3.5 h-3.5" />,
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
      icon: <Plus className="w-3.5 h-3.5" />,
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
      icon: <CircleDot className="w-3.5 h-3.5" />,
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
      icon: <Users className="w-3.5 h-3.5" />,
      group: 'Equipos',
    }))
    results.notes.forEach(n => flat.push({
      id: `n-${n.id}`,
      type: 'note',
      label: n.title || 'Sin título',
      sublabel: n.doc_kind && n.doc_kind !== 'note' ? 'Documento' : undefined,
      href: `/w/${workspaceSlug}/notes/${n.id}`,
      icon: <FileText className="w-3.5 h-3.5" />,
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
  }, [results, query, workspaceSlug, isAdmin, createNote, recents])

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
      // Registrar en Recientes antes de navegar. Guardamos el id base (sin el
      // prefijo de reciente "r-") para deduplicar contra futuras selecciones.
      const baseId = item.id.startsWith('r-') ? item.id.slice(item.id.indexOf('-', 2) + 1) : item.id
      recordRecent({
        id: baseId,
        type: item.type,
        label: item.label,
        sublabel: item.sublabel,
        href: item.href,
        iconHint: item.type,
      })
      router.push(item.href)
    }
  }, [router, setOpen, recordRecent])

  // Enter sobre una query sin match exacto: ir a la página de resultados.
  const goToResultsPage = useCallback(() => {
    const q = query.trim()
    if (!q) return
    setOpen(false)
    router.push(`/w/${workspaceSlug}/search?q=${encodeURIComponent(q)}`)
  }, [query, workspaceSlug, router, setOpen])

  // ¿Hay un resultado cuyo título coincide EXACTAMENTE con lo tecleado?
  const hasExactMatch = useMemo(() => {
    if (!results) return false
    const q = query.trim().toLowerCase()
    if (!q) return false
    const all = [
      ...results.tasks.map(t => t.title),
      ...results.projects.map(p => p.name),
      ...results.teams.map(t => t.name),
      ...results.notes.map(n => n.title),
      ...results.members.map(m => m.display_name),
    ]
    return all.some(label => (label ?? '').trim().toLowerCase() === q)
  }, [results, query])

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
        // Con query y sin match exacto: Enter abre la página de resultados,
        // salvo que el usuario haya movido la selección a un resultado concreto
        // (algo distinto de las acciones "Crear …" que van primero).
        const q = query.trim()
        const onAction = item?.type === 'action'
        if (q && !hasExactMatch && (onAction || !item)) {
          goToResultsPage()
          return
        }
        if (item) select(item)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, items, activeIndex, select, query, hasExactMatch, goToResultsPage])

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
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
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
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground mb-3">
                  Sin resultados para «{query}»
                </p>
                <button
                  onClick={goToResultsPage}
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <Search className="w-3.5 h-3.5" />
                  Ver la página de búsqueda
                </button>
              </div>
            )}

            {groups.map(([group, groupItems]) => (
              <div key={group} className="py-1">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
                  {group === 'Recientes' && <Clock className="w-3 h-3" />}
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

            {/* Afijo: ir a la página completa de resultados */}
            {query.trim() && results && !loading && (
              <button
                onClick={goToResultsPage}
                className="w-full flex items-center gap-3 px-3 py-2 text-left border-t border-border text-muted-foreground hover:bg-accent/50 transition-colors"
              >
                <div className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center">
                  <CornerDownLeft className="w-3.5 h-3.5" />
                </div>
                <span className="text-sm">Ver todos los resultados de «{query.trim()}»</span>
              </button>
            )}
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
                {query.trim() ? 'Ver resultados' : 'Abrir'}
              </span>
            </div>
            <span className="flex items-center gap-1 text-muted-foreground/70">
              <kbd className="font-mono px-1.5 py-0.5 bg-background rounded border border-border">{modKey}+K</kbd>
              para abrir
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

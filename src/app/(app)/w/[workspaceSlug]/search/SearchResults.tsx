'use client'

/**
 * Cliente de la página de resultados. Fetchea /api/search?full=1, agrupa por
 * tipo con conteos, permite filtrar por tipo y enlaza cada resultado a su ruta.
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  Search,
  FolderKanban,
  FileText,
  Users,
  User,
  ListChecks,
} from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { ProjectIcon } from '@/lib/project-icons'
import { useT } from '@/lib/i18n/LanguageProvider'

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
  teams: Array<{ id: string; name: string; slug: string }>
  members: Array<{
    id: string
    display_name: string
    avatar_url: string | null
    email: string | null
  }>
  notes: Array<{ id: string; title: string; icon: string | null; doc_kind: string | null }>
}

const EMPTY_RESULT: SearchResult = { tasks: [], projects: [], teams: [], members: [], notes: [] }

type TypeFilter = 'all' | 'tasks' | 'projects' | 'notes' | 'teams' | 'members'

interface SearchResultsProps {
  workspaceSlug: string
  workspaceId: string
  workspaceName: string
  initialQuery: string
  initialType: string
}

export function SearchResults({
  workspaceSlug,
  workspaceId,
  workspaceName,
  initialQuery,
  initialType,
}: SearchResultsProps) {
  const router = useRouter()
  const tr = useT()
  const [query, setQuery] = useState(initialQuery)
  const [type, setType] = useState<TypeFilter>(normalizeType(initialType))
  const [results, setResults] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)

  // Mantiene la URL sincronizada (compartible / back-button) sin recargar.
  const syncUrl = useCallback((q: string, t: TypeFilter) => {
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (t !== 'all') p.set('type', t)
    const qs = p.toString()
    router.replace(`/w/${workspaceSlug}/search${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [router, workspaceSlug])

  // Fetch con debounce.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const handle = setTimeout(async () => {
      try {
        const url = `/api/search?q=${encodeURIComponent(q)}&workspace_id=${encodeURIComponent(workspaceId)}&full=1`
        const res = await fetch(url)
        if (!res.ok) throw new Error()
        const data: SearchResult = await res.json()
        setResults(data)
      } catch {
        setResults(EMPTY_RESULT)
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(handle)
  }, [query, workspaceId])

  const counts = useMemo(() => {
    const r = results ?? EMPTY_RESULT
    return {
      tasks: r.tasks.length,
      projects: r.projects.length,
      notes: r.notes.length,
      teams: r.teams.length,
      members: r.members.length,
      total: r.tasks.length + r.projects.length + r.notes.length + r.teams.length + r.members.length,
    }
  }, [results])

  const filters: Array<{ key: TypeFilter; label: string; count: number }> = [
    { key: 'all', label: tr('search.filterAll'), count: counts.total },
    { key: 'tasks', label: tr('search.tasks'), count: counts.tasks },
    { key: 'projects', label: tr('search.projects'), count: counts.projects },
    { key: 'notes', label: tr('search.notes'), count: counts.notes },
    { key: 'teams', label: tr('search.teams'), count: counts.teams },
    { key: 'members', label: tr('search.members'), count: counts.members },
  ]

  const show = (t: TypeFilter) => type === 'all' || type === t
  const r = results ?? EMPTY_RESULT

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header + input */}
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-foreground">{tr('search.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{workspaceName}</p>
      </div>

      <div className="flex items-center gap-3 px-4 py-2.5 mb-5 bg-card border border-border rounded-lg focus-within:border-ring/40 transition-colors">
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            syncUrl(e.target.value, type)
          }}
          placeholder={tr('search.placeholder')}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
        {loading && (
          <span className="w-3.5 h-3.5 border border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
        )}
      </div>

      {/* Filtro por tipo */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => {
              setType(f.key)
              syncUrl(query, f.key)
            }}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors',
              type === f.key
                ? 'bg-primary text-primary-foreground border-transparent'
                : 'bg-background text-muted-foreground border-border hover:text-foreground hover:border-ring'
            )}
          >
            {f.label}
            {query.trim() && (
              <span className={cn(
                'text-[10px] font-medium',
                type === f.key ? 'text-primary-foreground/80' : 'text-muted-foreground/70'
              )}>
                {f.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Estados */}
      {!query.trim() ? (
        <EmptyState
          icon={<Search className="w-10 h-10 text-muted-foreground/50" />}
          title={tr('search.emptyTitle')}
          subtitle={tr('search.emptySubtitle')}
        />
      ) : !loading && counts.total === 0 ? (
        <EmptyState
          icon={<Search className="w-10 h-10 text-muted-foreground/50" />}
          title={`${tr('search.noResultsPrefix')} "${query.trim()}"`}
          subtitle={tr('search.noResultsSubtitle')}
        />
      ) : (
        <div className="space-y-8">
          {/* Tareas */}
          {show('tasks') && r.tasks.length > 0 && (
            <Section icon={<ListChecks className="w-4 h-4" />} title={tr('search.tasks')} count={r.tasks.length}>
              {r.tasks.map(t => {
                const href = t.team_slug && t.project_slug
                  ? `/w/${workspaceSlug}/t/${t.team_slug}/p/${t.project_slug}`
                  : undefined
                return (
                  <ResultRow
                    key={t.id}
                    href={href}
                    icon={<ListChecks className="w-4 h-4 text-muted-foreground" />}
                    label={t.title}
                    sublabel={t.project_name ?? undefined}
                  />
                )
              })}
            </Section>
          )}

          {/* Proyectos */}
          {show('projects') && r.projects.length > 0 && (
            <Section icon={<FolderKanban className="w-4 h-4" />} title={tr('search.projects')} count={r.projects.length}>
              {r.projects.map(p => (
                <ResultRow
                  key={p.id}
                  href={p.team_slug ? `/w/${workspaceSlug}/t/${p.team_slug}/p/${p.slug}` : undefined}
                  icon={<ProjectIcon icon={p.icon} size={16} />}
                  label={p.name}
                />
              ))}
            </Section>
          )}

          {/* Notas */}
          {show('notes') && r.notes.length > 0 && (
            <Section icon={<FileText className="w-4 h-4" />} title={tr('search.notes')} count={r.notes.length}>
              {r.notes.map(n => (
                <ResultRow
                  key={n.id}
                  href={`/w/${workspaceSlug}/notes/${n.id}`}
                  icon={<FileText className="w-4 h-4 text-muted-foreground" />}
                  label={n.title || tr('search.untitled')}
                  sublabel={n.doc_kind && n.doc_kind !== 'note' ? tr('search.document') : undefined}
                />
              ))}
            </Section>
          )}

          {/* Equipos */}
          {show('teams') && r.teams.length > 0 && (
            <Section icon={<Users className="w-4 h-4" />} title={tr('search.teams')} count={r.teams.length}>
              {r.teams.map(t => (
                <ResultRow
                  key={t.id}
                  href={`/w/${workspaceSlug}/t/${t.slug}`}
                  icon={<Users className="w-4 h-4 text-muted-foreground" />}
                  label={t.name}
                />
              ))}
            </Section>
          )}

          {/* Personas */}
          {show('members') && r.members.length > 0 && (
            <Section icon={<User className="w-4 h-4" />} title={tr('search.members')} count={r.members.length}>
              {r.members.map(m => (
                <ResultRow
                  key={m.id}
                  icon={
                    m.avatar_url ? (
                      <Image
                        src={m.avatar_url}
                        alt={m.display_name}
                        width={24}
                        height={24}
                        className="object-cover rounded-full"
                      />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                        {getInitials(m.display_name)}
                      </span>
                    )
                  }
                  label={m.display_name}
                  sublabel={m.email ?? undefined}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function normalizeType(t: string): TypeFilter {
  const valid: TypeFilter[] = ['all', 'tasks', 'projects', 'notes', 'teams', 'members']
  return (valid as string[]).includes(t) ? (t as TypeFilter) : 'all'
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2 text-muted-foreground">
        {icon}
        <h2 className="text-xs uppercase tracking-wider font-medium">{title}</h2>
        <span className="text-[11px] text-muted-foreground/70">{count}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

function ResultRow({
  href,
  icon,
  label,
  sublabel,
}: {
  href?: string
  icon: React.ReactNode
  label: string
  sublabel?: string
}) {
  const inner = (
    <div className="flex items-center gap-3 bg-card border border-border rounded-lg px-3 py-2.5 hover:border-ring/30 transition-colors">
      <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate">{label}</div>
        {sublabel && <div className="text-[11px] text-muted-foreground truncate">{sublabel}</div>}
      </div>
    </div>
  )
  if (!href) return <div className="opacity-70 cursor-default">{inner}</div>
  return <Link href={href}>{inner}</Link>
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <div className="text-center py-16">
      <div className="mx-auto mb-3 flex justify-center">{icon}</div>
      <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

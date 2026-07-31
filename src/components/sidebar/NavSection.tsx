'use client'

/**
 * Sección de navegación para un equipo y sus proyectos.
 * Colapsable individualmente, y ese plegado se RECUERDA: quien pertenece a
 * varios equipos cerraba los que no usa y volvian a abrirse en cada recarga,
 * dejando la barra otra vez larga. Se guardan solo los CERRADOS (lista corta),
 * asi un equipo nuevo aparece abierto por defecto sin tener que registrarlo.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ProjectIcon } from '@/lib/project-icons'

interface Team {
  id: string
  name: string
  slug: string
  is_archived?: boolean
  projects: Array<{ id: string; name: string; slug: string; icon: string | null }>
}

interface NavSectionProps {
  team: Team
  workspaceSlug: string
  collapsed: boolean
  pathname: string
}

const CLOSED_KEY = 'wlo-sidebar-teams-closed'

/** Lee la lista de equipos cerrados. Ante cualquier basura, lista vacia. */
function readClosed(): string[] {
  try {
    const raw = localStorage.getItem(CLOSED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function NavSection({ team, workspaceSlug, collapsed, pathname }: NavSectionProps) {
  // Abierto en el primer render para que servidor y cliente coincidan; la
  // preferencia guardada se aplica ya montado.
  const [open, setOpen] = useState(true)
  const teamBase = `/w/${workspaceSlug}/t/${team.slug}`

  useEffect(() => {
    if (readClosed().includes(team.id)) setOpen(false)
  }, [team.id])

  const toggleOpen = () => {
    setOpen(prev => {
      const next = !prev
      try {
        const closed = new Set(readClosed())
        if (next) closed.delete(team.id)
        else closed.add(team.id)
        localStorage.setItem(CLOSED_KEY, JSON.stringify([...closed]))
      } catch {
        // Sin localStorage el plegado sigue funcionando, solo no se recuerda.
      }
      return next
    })
  }

  // El equipo está en foco (su vista raíz activa) pero ningún hijo lo está:
  // sugerimos el Tablero como acción principal con un acento tenue.
  const teamRootActive = pathname === teamBase
  const anyChildActive =
    pathname.startsWith(`${teamBase}/scrum`) ||
    pathname.startsWith(`${teamBase}/chat`) ||
    pathname.startsWith(`${teamBase}/docs`) ||
    pathname.startsWith(`${teamBase}/p/`)
  const suggestBoard = teamRootActive && !anyChildActive

  if (collapsed) {
    // Modo colapsado: solo mostrar el ícono del equipo con tooltip
    return (
      <Link
        href={teamBase}
        title={team.name}
        data-active={pathname.startsWith(teamBase) || undefined}
        className={cn(
          'flex items-center justify-center w-8 h-8 mx-auto rounded-md text-sm font-medium transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          pathname.startsWith(teamBase) ? 'bg-accent text-accent-foreground ring-1 ring-primary/50' : 'text-muted-foreground'
        )}
      >
        {team.name.charAt(0).toUpperCase()}
      </Link>
    )
  }

  return (
    <div>
      {/* Header del equipo, chevron (toggle) + nombre (link a la vista del equipo) */}
      <div className="flex items-center gap-0.5 group">
        <button
          onClick={toggleOpen}
          aria-label={open ? `Colapsar ${team.name}` : `Expandir ${team.name}`}
          aria-expanded={open}
          className="flex-shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={cn('transition-transform', open ? 'rotate-90' : '')}
          >
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <Link
          href={teamBase}
          // Los nombres de equipo son largos y se truncan casi siempre
          // ("BILLING AND MANAGEMENT..."): sin tooltip no hay forma de leerlos.
          title={team.name}
          data-active={pathname === teamBase || undefined}
          className={cn(
            'flex-1 min-w-0 truncate px-1.5 py-1.5 rounded-md text-xs font-medium uppercase tracking-wide transition-colors flex items-center gap-1.5',
            'hover:text-foreground hover:bg-accent',
            team.is_archived
              ? 'text-muted-foreground/50 italic'
              : pathname === teamBase ? 'text-foreground bg-accent' : 'text-muted-foreground'
          )}
        >
          <span className="truncate">{team.name}</span>
          {/* Equipo plegado con la pagina actual adentro: sin esta marca el
              usuario pierde de vista donde esta parado. */}
          {!open && pathname.startsWith(teamBase) && pathname !== teamBase && (
            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary" />
          )}
          {team.is_archived && (
            <span className="flex-shrink-0 text-[9px] font-normal normal-case tracking-normal px-1 py-0.5 rounded bg-muted text-muted-foreground/70">
              Inactivo
            </span>
          )}
        </Link>

        {/* Botón agregar proyecto */}
        <Link
          href={`${teamBase}/projects/new`}
          title="Nuevo proyecto"
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Link>
      </div>

      {/* Contenido del equipo: Tablero + Chat + proyectos.
          Línea guía izquierda para leerlos como hijos del equipo (estilo Linear). */}
      {open && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border/60 pl-1.5">
          {/* Acceso directo a Planeación (Scrum/Kanban) del equipo */}
          <Link
            href={`${teamBase}/scrum`}
            data-active={pathname.startsWith(`${teamBase}/scrum`) || undefined}
            className={cn(
              'relative flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              pathname.startsWith(`${teamBase}/scrum`)
                ? 'bg-accent text-accent-foreground font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-full before:bg-primary'
                : suggestBoard
                  ? 'text-foreground ring-1 ring-primary/40 bg-primary/5'
                  : 'text-muted-foreground'
            )}
          >
            <span className="flex-shrink-0 w-4 h-4"><BoardIcon /></span>
            <span className="truncate">Planeación</span>
          </Link>

          {/* Acceso directo al chat del equipo */}
          <Link
            href={`${teamBase}/chat`}
            data-active={pathname.startsWith(`${teamBase}/chat`) || undefined}
            className={cn(
              'relative flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              pathname.startsWith(`${teamBase}/chat`)
                ? 'bg-accent text-accent-foreground font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-full before:bg-primary'
                : 'text-muted-foreground'
            )}
          >
            <span className="flex-shrink-0 w-4 h-4"><ChatIcon /></span>
            <span className="truncate">Chat</span>
          </Link>

          {/* Documentos del equipo: reglas, SOPs y notas del departamento */}
          <Link
            href={`${teamBase}/docs`}
            data-active={pathname.startsWith(`${teamBase}/docs`) || undefined}
            className={cn(
              'relative flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              pathname.startsWith(`${teamBase}/docs`)
                ? 'bg-accent text-accent-foreground font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-full before:bg-primary'
                : 'text-muted-foreground'
            )}
          >
            <span className="flex-shrink-0 w-4 h-4"><DocsIcon /></span>
            <span className="truncate">Documentos</span>
          </Link>

          {team.projects.length === 0 && (
            <Link
              href={`${teamBase}/projects/new`}
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors rounded-md"
            >
              <span>+ Nuevo proyecto</span>
            </Link>
          )}
          {team.projects.map(project => {
            const projectBase = `${teamBase}/p/${project.slug}`
            const isActive = pathname.startsWith(projectBase)

            return (
              <Link
                key={project.id}
                href={projectBase}
                title={project.name}
                data-active={isActive || undefined}
                className={cn(
                  'relative flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-full before:bg-primary'
                    : 'text-muted-foreground'
                )}
              >
                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                  <ProjectIcon icon={project.icon} size={15} />
                </span>
                <span className="truncate">{project.name}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Icono de tablero Scrum ────────────────────────────────────────────────────
function BoardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 2v12M10 2v12" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

// ── Icono de documentos del equipo (libro abierto) ────────────────────────────
function DocsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 4.2C7 3.4 5.7 3 4 3H2v9h2c1.7 0 3 .4 4 1.2M8 4.2C9 3.4 10.3 3 12 3h2v9h-2c-1.7 0-3 .4-4 1.2M8 4.2v9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Icono de chat ─────────────────────────────────────────────────────────────
function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v5A1.5 1.5 0 0 1 12.5 11H6l-3 2.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

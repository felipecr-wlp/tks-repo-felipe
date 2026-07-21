'use client'

/**
 * Sidebar principal de la app, workspaces, navegacion jerarquizada y equipos.
 *
 * Acomodo estilo Linear: Bandeja y Mis tareas arriba sin grupo, luego
 * "Workspace", "Marketplace" y "Equipos" colapsables persistidos en
 * localStorage (`wlo-sidebar-groups-v2`). Modo colapsado (w-14) con tooltips.
 * Iconos de lucide-react para consistencia visual (sin emojis).
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { NavSection } from './NavSection'
import { UserMenu } from './UserMenu'
import { InboxBadge } from './InboxBadge'
import { useCommandPalette } from '@/stores/command-palette'
import { useNewTask } from '@/stores/new-task'
import { useMobileNav } from '@/stores/mobile-nav'
import {
  Home,
  CheckSquare,
  Inbox,
  CalendarDays,
  Timer,
  Target,
  FileText,
  PenTool,
  Compass,
  IdCard,
  GraduationCap,
  Search,
  ChevronLeft,
  ChevronDown,
  Plus,
  X,
  Lock,
  Building2,
  type LucideIcon,
} from 'lucide-react'

interface SidebarProps {
  workspaceSlug: string
  workspaceName: string
  orgName: string
  teams: Array<{
    id: string
    name: string
    slug: string
    is_archived?: boolean
    department?: { id: string; name: string; is_restricted: boolean } | null
    projects: Array<{ id: string; name: string; slug: string; icon: string | null }>
  }>
  isAdmin?: boolean
  userProfile: {
    id: string
    display_name: string
    avatar_url: string | null
    email: string
  }
  allWorkspaces: Array<{ id: string; name: string; slug: string }>
}

type GroupKey = 'workspace' | 'marketplace' | 'equipos'

const STORAGE_KEY = 'wlo-sidebar-groups-v2'

export function Sidebar({
  workspaceSlug,
  workspaceName,
  orgName,
  teams,
  isAdmin = false,
  userProfile,
  allWorkspaces,
}: SidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const base = `/w/${workspaceSlug}`

  // Drawer movil: estado compartido con la barra superior (hamburguesa).
  const mobileOpen = useMobileNav(s => s.open)
  const setMobileOpen = useMobileNav(s => s.setOpen)

  // Al navegar (cambia la ruta), cerrar el drawer en movil.
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname, setMobileOpen])

  // Estado de grupos colapsables, persistido en localStorage.
  const [openGroups, setOpenGroups] = useState<Record<GroupKey, boolean>>({
    workspace: true,
    marketplace: true,
    equipos: true,
  })

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setOpenGroups((prev) => ({ ...prev, ...JSON.parse(raw) }))
    } catch {
      // localStorage no disponible: usamos los defaults.
    }
  }, [])

  const toggleGroup = (key: GroupKey) => {
    setOpenGroups((prev) => {
      const nextState = { ...prev, [key]: !prev[key] }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState))
      } catch {
        // Ignorar si no se puede persistir.
      }
      return nextState
    })
  }

  // Lo mas usado va arriba, sin grupo: acceso en un clic (patron Linear).
  const topItems: Array<{ href: string; icon: LucideIcon; label: string; exact?: boolean }> = [
    { href: `${base}/inbox`, icon: Inbox, label: 'Bandeja' },
    { href: `${base}/my-tasks`, icon: CheckSquare, label: 'Mis tareas' },
  ]

  const workspaceItems: Array<{ href: string; icon: LucideIcon; label: string; exact?: boolean }> = [
    { href: base, icon: Home, label: 'Inicio', exact: true },
    { href: `${base}/guia`, icon: GraduationCap, label: 'Guía' },
    { href: `${base}/calendar`, icon: CalendarDays, label: 'Calendario' },
    { href: `${base}/notes`, icon: FileText, label: 'Notas' },
    { href: `${base}/whiteboards`, icon: PenTool, label: 'Pizarras' },
    { href: `${base}/goals`, icon: Target, label: 'Metas' },
    { href: `${base}/tracking`, icon: Timer, label: 'Tracking' },
  ]

  const marketplaceItems: Array<{ href: string; icon: LucideIcon; label: string; exact?: boolean }> = [
    { href: `${base}/projects`, icon: Compass, label: 'Oportunidades' },
    { href: `${base}/cv/${userProfile.id}`, icon: IdCard, label: 'Mi CV', exact: true },
  ]

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href)

  // Agrupar equipos por departamento para el sidebar. Los que no tienen
  // departamento (legacy / workspace General) van al final, sueltos.
  const deptGroups: Array<{
    id: string
    name: string
    is_restricted: boolean
    teams: typeof teams
  }> = []
  const looseTeams: typeof teams = []
  const groupIndex = new Map<string, number>()
  for (const team of teams) {
    const dept = team.department
    if (!dept) {
      looseTeams.push(team)
      continue
    }
    let idx = groupIndex.get(dept.id)
    if (idx === undefined) {
      idx = deptGroups.length
      groupIndex.set(dept.id, idx)
      deptGroups.push({ id: dept.id, name: dept.name, is_restricted: dept.is_restricted, teams: [] })
    }
    deptGroups[idx].teams.push(team)
  }
  deptGroups.sort((a, b) => a.name.localeCompare(b.name, 'es'))

  return (
    <>
      {/* Backdrop del drawer (solo movil, cuando esta abierto) */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          'flex flex-col h-full bg-sidebar border-r border-border',
          // Movil: drawer off-canvas fijo, siempre ancho completo.
          'fixed inset-y-0 left-0 z-50 w-64 max-w-[80vw] transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: columna estatica dentro del flujo flex, con colapso.
          'md:static md:z-auto md:max-w-none md:translate-x-0 md:transition-all',
          collapsed ? 'md:w-14' : 'md:w-60'
        )}
      >
      {/* ── Header: workspace switcher ─────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border min-h-[52px]">
        {!collapsed && (
          <WorkspaceSwitcher
            currentSlug={workspaceSlug}
            currentName={workspaceName}
            orgName={orgName}
            workspaces={allWorkspaces}
          />
        )}
        {/* Colapsar/expandir: solo desktop */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:inline-flex flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          <ChevronLeft
            size={16}
            className={cn('transition-transform', collapsed && 'rotate-180')}
          />
        </button>
        {/* Cerrar drawer: solo movil */}
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Cerrar menú"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Nav principal ──────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 space-y-0.5 px-2">
        {/* Búsqueda global (Cmd+K) */}
        <SearchButton collapsed={collapsed} />

        {/* Nueva tarea global (atajo C) */}
        <NewTaskButton collapsed={collapsed} />

        {/* Acceso directo: lo mas usado arriba y sin grupo */}
        <div className="space-y-0.5 pt-1">
          {topItems.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              icon={<item.icon size={16} />}
              label={item.label}
              collapsed={collapsed}
              active={isActive(item.href, item.exact)}
              badge={
                item.href === `${base}/inbox` ? (
                  <InboxBadge
                    workspaceSlug={workspaceSlug}
                    currentUserId={userProfile.id}
                    collapsed={collapsed}
                  />
                ) : undefined
              }
            />
          ))}
        </div>

        {/* Grupo: Workspace */}
        <NavGroup
          label="Workspace"
          collapsed={collapsed}
          open={openGroups.workspace}
          onToggle={() => toggleGroup('workspace')}
        >
          {workspaceItems.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              icon={<item.icon size={16} />}
              label={item.label}
              collapsed={collapsed}
              active={isActive(item.href, item.exact)}
            />
          ))}
        </NavGroup>

        {/* Grupo: Marketplace */}
        <NavGroup
          label="Marketplace"
          collapsed={collapsed}
          open={openGroups.marketplace}
          onToggle={() => toggleGroup('marketplace')}
        >
          {marketplaceItems.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              icon={<item.icon size={16} />}
              label={item.label}
              collapsed={collapsed}
              active={isActive(item.href, item.exact)}
            />
          ))}
        </NavGroup>

        {/* Grupo: Equipos */}
        <NavGroup
          label="Equipos"
          collapsed={collapsed}
          open={openGroups.equipos}
          onToggle={() => toggleGroup('equipos')}
          action={
            !collapsed && isAdmin ? (
              <Link
                href={`${base}/teams/new`}
                title="Nuevo equipo"
                className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              >
                <Plus size={12} />
              </Link>
            ) : undefined
          }
        >
          {/* Equipos agrupados por departamento */}
          {deptGroups.map((group) => (
            <div key={group.id} className="pt-1">
              {!collapsed && (
                <div className="flex items-center gap-1 px-2 pb-0.5 pt-1">
                  {group.is_restricted ? (
                    <Lock size={10} className="text-muted-foreground/70 flex-shrink-0" />
                  ) : (
                    <Building2 size={10} className="text-muted-foreground/70 flex-shrink-0" />
                  )}
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 truncate">
                    {group.name}
                  </span>
                </div>
              )}
              {group.teams.map((team) => (
                <NavSection
                  key={team.id}
                  team={team}
                  workspaceSlug={workspaceSlug}
                  collapsed={collapsed}
                  pathname={pathname}
                />
              ))}
            </div>
          ))}

          {/* Equipos sin departamento (sueltos) */}
          {looseTeams.map((team) => (
            <NavSection
              key={team.id}
              team={team}
              workspaceSlug={workspaceSlug}
              collapsed={collapsed}
              pathname={pathname}
            />
          ))}

          {!collapsed && teams.length === 0 && isAdmin && (
            <Link
              href={`${base}/teams/new`}
              className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors rounded-md"
            >
              <Plus size={12} />
              Crear primer equipo
            </Link>
          )}

          {!collapsed && teams.length === 0 && !isAdmin && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground/60">
              Aún no tienes equipos asignados.
            </p>
          )}
        </NavGroup>
      </nav>

      {/* ── Footer: perfil de usuario ──────────────────────────── */}
      <div className="border-t border-border p-2">
        <UserMenu profile={userProfile} collapsed={collapsed} workspaceSlug={workspaceSlug} />
      </div>
      </aside>
    </>
  )
}

// ── Nav Group (seccion colapsable con encabezado tenue) ────────────────────────
function NavGroup({
  label,
  collapsed,
  open,
  onToggle,
  action,
  children,
}: {
  label: string
  collapsed: boolean
  open: boolean
  onToggle: () => void
  action?: React.ReactNode
  children: React.ReactNode
}) {
  // En modo colapsado no hay encabezados: solo un separador entre grupos.
  if (collapsed) {
    return (
      <>
        <div className="h-px bg-border mx-1 my-2" />
        <div className="space-y-0.5">{children}</div>
      </>
    )
  }

  return (
    <div className="pt-3">
      <div className="px-2 pb-1 flex items-center justify-between group/hdr">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={open}
        >
          <ChevronDown
            size={11}
            className={cn('transition-transform', !open && '-rotate-90')}
          />
          {label}
        </button>
        {action}
      </div>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  )
}

// ── Nav Item ──────────────────────────────────────────────────────────────────
function NavItem({
  href,
  icon,
  label,
  collapsed,
  active,
  badge,
}: {
  href: string
  icon: React.ReactNode
  label: string
  collapsed: boolean
  active: boolean
  badge?: React.ReactNode
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        'relative flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        collapsed && 'justify-center',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground'
      )}
    >
      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
      {badge}
    </Link>
  )
}

// ── Nueva tarea con shortcut C ──────────────────────────────────────────────
function NewTaskButton({ collapsed }: { collapsed: boolean }) {
  const setOpen = useNewTask(s => s.setOpen)

  return (
    <button
      onClick={() => setOpen(true)}
      title={collapsed ? 'Nueva tarea (C)' : undefined}
      className={cn(
        'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors',
        'text-muted-foreground hover:bg-accent hover:text-foreground',
        collapsed && 'justify-center'
      )}
    >
      <span className="flex-shrink-0 flex items-center justify-center w-4 h-4">
        <Plus size={16} />
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left">Nueva tarea</span>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-muted text-muted-foreground rounded border border-border">
            C
          </kbd>
        </>
      )}
    </button>
  )
}

// ── Search button con shortcut Cmd+K ────────────────────────────────────────
function SearchButton({ collapsed }: { collapsed: boolean }) {
  const toggle = useCommandPalette(s => s.toggle)
  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform))
  }, [])

  return (
    <button
      onClick={toggle}
      title={collapsed ? 'Buscar (Cmd+K)' : undefined}
      className={cn(
        'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors',
        'text-muted-foreground hover:bg-accent hover:text-foreground',
        collapsed && 'justify-center'
      )}
    >
      <span className="flex-shrink-0 flex items-center justify-center w-4 h-4">
        <Search size={16} />
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left">Buscar</span>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-muted text-muted-foreground rounded border border-border">
            {isMac ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </>
      )}
    </button>
  )
}

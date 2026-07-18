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
import { useCommandPalette } from '@/stores/command-palette'
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
  Search,
  ChevronLeft,
  ChevronDown,
  Plus,
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
    projects: Array<{ id: string; name: string; slug: string; icon: string | null }>
  }>
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
  userProfile,
  allWorkspaces,
}: SidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const base = `/w/${workspaceSlug}`

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

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-sidebar border-r border-border transition-all duration-200',
        collapsed ? 'w-14' : 'w-60'
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
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          <ChevronLeft
            size={16}
            className={cn('transition-transform', collapsed && 'rotate-180')}
          />
        </button>
      </div>

      {/* ── Nav principal ──────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 space-y-0.5 px-2">
        {/* Búsqueda global (Cmd+K) */}
        <SearchButton collapsed={collapsed} />

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
            !collapsed ? (
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
          {teams.map((team) => (
            <NavSection
              key={team.id}
              team={team}
              workspaceSlug={workspaceSlug}
              collapsed={collapsed}
              pathname={pathname}
            />
          ))}

          {!collapsed && teams.length === 0 && (
            <Link
              href={`${base}/teams/new`}
              className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors rounded-md"
            >
              <Plus size={12} />
              Crear primer equipo
            </Link>
          )}
        </NavGroup>
      </nav>

      {/* ── Footer: perfil de usuario ──────────────────────────── */}
      <div className="border-t border-border p-2">
        <UserMenu profile={userProfile} collapsed={collapsed} />
      </div>
    </aside>
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
}: {
  href: string
  icon: React.ReactNode
  label: string
  collapsed: boolean
  active: boolean
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        collapsed && 'justify-center',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground'
      )}
    >
      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
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

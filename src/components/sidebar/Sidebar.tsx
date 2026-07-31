'use client'

/**
 * Sidebar principal de la app, workspaces, navegacion jerarquizada y equipos.
 *
 * Acomodo estilo Linear: Bandeja y Mis tareas arriba sin grupo, luego
 * "Workspace" y "Equipos" colapsables persistidos en localStorage
 * (`wlo-sidebar-groups-v2`). Modo colapsado (w-14) con tooltips.
 * Iconos de lucide-react para consistencia visual (sin emojis).
 *
 * MENOS BOTONES A LA VISTA (cambio deliberado): la barra llego a mostrar doce
 * destinos de golpe y la gente se perdia. Ahora el catalogo
 * (`src/lib/features.ts`) marca cinco como `primary` y el resto vive detras de
 * "Ver mas", que recuerda si lo dejaste abierto. Tambien desaparecio el grupo
 * "Marketplace": eran dos items y un encabezado entero para ellos, se mudaron
 * al bloque de mas. Nada se elimino, solo dejo de gritar.
 *
 * Ademas, un admin puede APAGAR funciones por persona: lo que venga en
 * `hiddenFeatures` no se dibuja. Esconder el boton es la mitad del trabajo, el
 * bloqueo real de la ruta vive en el layout del workspace.
 *
 * Detalles de uso que no son cosmeticos:
 * - El ancho (colapsado o no) tambien se persiste (`wlo-sidebar-collapsed`).
 *   Antes se reiniciaba en cada recarga y quien trabajaba angosto tenia que
 *   volver a colapsar todo el tiempo.
 * - Atajo Cmd/Ctrl + \ para abrir y cerrar la barra sin soltar el teclado.
 * - TODO item lleva `title`: la lista trunca nombres largos ("General (todos
 *   los equipos)", nombres de equipo), y sin tooltip no habia forma de leerlos.
 * - Al cargar, el item activo se trae a la vista: con muchos equipos quedaba
 *   fuera del scroll y la barra no decia donde estabas parado.
 * - Un grupo CERRADO que contiene la ruta activa se marca con un punto, para
 *   no perder la orientacion al plegarlo.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n/LanguageProvider'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { WloLogo } from '@/components/brand/WloLogo'
import { NavSection } from './NavSection'
import { UserMenu } from './UserMenu'
import { LanguageSwitcher } from './LanguageSwitcher'
import { InboxBadge } from './InboxBadge'
import { useCommandPalette } from '@/stores/command-palette'
import { useNewTask } from '@/stores/new-task'
import { useMobileNav } from '@/stores/mobile-nav'
import { FEATURES, type FeatureKey } from '@/lib/features'
import {
  Home,
  CheckSquare,
  Inbox,
  CalendarDays,
  Timer,
  Target,
  BarChart3,
  FileText,
  PenTool,
  MessagesSquare,
  Compass,
  IdCard,
  GraduationCap,
  BookOpen,
  ClipboardList,
  Workflow,
  Search,
  ChevronLeft,
  ChevronDown,
  Plus,
  X,
  Lock,
  Building2,
  MoreHorizontal,
  Puzzle,
  Hash,
  Clock,
  type LucideIcon,
} from 'lucide-react'

// Icono de cada funcion del catalogo. Vive aqui y no en `features.ts` porque
// ese modulo tambien lo importa el servidor, y arrastrar componentes de React
// a la capa de datos no aporta nada.
const FEATURE_ICONS: Record<FeatureKey, LucideIcon> = {
  inbox: Inbox,
  'my-tasks': CheckSquare,
  home: Home,
  general: MessagesSquare,
  guia: GraduationCap,
  academia: BookOpen,
  calendar: CalendarDays,
  reportes: ClipboardList,
  notes: FileText,
  whiteboards: PenTool,
  flows: Workflow,
  goals: Target,
  analytics: BarChart3,
  tracking: Timer,
  projects: Compass,
  cv: IdCard,
}

const PLUGIN_ICONS_MAP: Record<string, LucideIcon> = {
  'wlo-flows': Workflow,
  'wlo-counter': Hash,
  'wlo-clock': Clock,
}

const PLUGIN_LABELS: Record<string, string> = {
  'wlo-flows': 'Flows',
  'wlo-counter': 'Contador',
  'wlo-clock': 'Reloj',
}

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
  /** Funciones apagadas para esta persona (claves del catalogo). */
  hiddenFeatures?: string[]
  /** Complementos instalados en el workspace (connector_installs). */
  plugins?: Array<{ id: string; app_id: string; manifest: Record<string, any>; enabled: boolean }>
}

type GroupKey = 'workspace' | 'complementos' | 'equipos'

const STORAGE_KEY = 'wlo-sidebar-groups-v2'
const COLLAPSED_KEY = 'wlo-sidebar-collapsed'
const MORE_KEY = 'wlo-sidebar-more'

export function Sidebar({
  workspaceSlug,
  workspaceName,
  orgName,
  teams,
  isAdmin = false,
  userProfile,
  hiddenFeatures = [],
  plugins = [],
}: SidebarProps) {
  const pathname = usePathname()
  const { t } = useI18n()
  // Arranca expandido para que el HTML del servidor y el del cliente coincidan;
  // la preferencia real se aplica abajo, ya montado.
  const [collapsed, setCollapsed] = useState(false)
  const base = `/w/${workspaceSlug}`
  const navRef = useRef<HTMLElement | null>(null)

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
    complementos: true,
    equipos: true,
  })

  // "Ver mas": arranca cerrado y recuerda si lo dejaste abierto. Quien usa a
  // diario Metas o Tracking no tiene que ir a buscarlas en cada sesion.
  const [showMore, setShowMore] = useState(false)

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

  // Ancho preferido: se lee una vez al montar y se guarda en cada cambio.
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSED_KEY) === '1') setCollapsed(true)
      if (localStorage.getItem(MORE_KEY) === '1') setShowMore(true)
    } catch {
      // localStorage no disponible: se queda expandido.
    }
  }, [])

  const toggleMore = () => {
    setShowMore((prev) => {
      try {
        localStorage.setItem(MORE_KEY, prev ? '0' : '1')
      } catch {
        // Ignorar si no se puede persistir.
      }
      return !prev
    })
  }

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1')
      } catch {
        // Ignorar si no se puede persistir.
      }
      return !prev
    })
  }

  // Atajo Cmd/Ctrl + \. Se ignora mientras se escribe: en un campo de texto la
  // tecla le pertenece al usuario, no a la navegacion.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || !(e.metaKey || e.ctrlKey)) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      e.preventDefault()
      toggleCollapsed()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Traer el item activo a la vista al cargar. `block: 'nearest'` solo mueve el
  // scroll si de verdad quedo fuera, asi no da un salto gratuito.
  useEffect(() => {
    const activo = navRef.current?.querySelector('[data-active="true"]')
    activo?.scrollIntoView({ block: 'nearest' })
    // Solo al montar: durante la navegacion el usuario ya sabe donde esta y un
    // scroll automatico seria una sacudida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Los destinos salen del catalogo, no de una lista suelta: asi la barra, el
  // panel de permisos y la guarda de rutas hablan del mismo universo.
  const visible = FEATURES.filter((f) => !hiddenFeatures.includes(f.key))

  const toItem = (f: (typeof FEATURES)[number]) => ({
    key: f.key,
    // "Mi CV" es la unica ruta con parametro: apunta al perfil de quien mira.
    href: f.key === 'cv' ? `${base}/cv/${userProfile.id}` : f.segment ? `${base}/${f.segment}` : base,
    icon: FEATURE_ICONS[f.key],
    label: t(f.labelKey),
    // La raiz del workspace hace match exacto o se marcaria activa en toda la app.
    exact: f.segment === '' || f.key === 'cv',
  })

  // Lo mas usado va arriba, sin grupo: acceso en un clic (patron Linear).
  const topItems = visible.filter((f) => f.group === 'principal').map(toItem)
  const wsAll = visible.filter((f) => f.group === 'workspace')
  const primaryItems = wsAll.filter((f) => f.primary).map(toItem)
  const moreItems = wsAll.filter((f) => !f.primary).map(toItem)

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href)

  // Para avisar en el encabezado de un grupo cerrado que la ruta actual vive
  // dentro de el.
  const activeIn: Record<GroupKey, boolean> = {
    workspace: [...primaryItems, ...moreItems].some((i) => isActive(i.href, i.exact)),
    complementos: pathname.startsWith(`${base}/flows`) || pathname.startsWith(`${base}/widgets`),
    equipos: pathname.startsWith(`${base}/t/`),
  }

  // Si estas parado en una pantalla del bloque de mas, se abre solo: esconder
  // la pagina en la que estas seria peor que mostrarla de mas.
  const moreHasActive = moreItems.some((i) => isActive(i.href, i.exact))
  const moreOpen = showMore || moreHasActive

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
      {/* ── Header: marca del espacio ──────────────────────────── */}
      {/* Colapsada la barra mide 56px: con px-2.5 solo caben 36 de marca. Se
          aprieta a px-2 para que el logo llegue a 40 y siga siendo legible. */}
      <div
        className={cn(
          'flex items-center justify-between gap-1 py-2.5 border-b border-border min-h-[68px]',
          collapsed ? 'md:px-2 px-2.5' : 'px-2.5'
        )}
      >
        {!collapsed && (
          <WorkspaceSwitcher currentName={workspaceName} orgName={orgName} />
        )}
        {/* Colapsada la barra no cabe el switcher, pero la marca no se pierde:
            el propio logo es el boton para volver a abrir. */}
        {collapsed && (
          <button
            onClick={toggleCollapsed}
            className="hidden md:flex mx-auto items-center justify-center w-10 h-10 rounded-xl bg-white dark:bg-white/10 border border-border shadow-sm text-[#16202b] dark:text-white hover:border-primary/40 transition-colors"
            aria-label={t('nav.expandMenu')}
            title={`${t('nav.expandMenu')} (Ctrl+\\)`}
          >
            <WloLogo size={30} />
          </button>
        )}
        {/* Colapsar: solo desktop y solo con la barra abierta */}
        {!collapsed && (
          <button
            onClick={toggleCollapsed}
            className="hidden md:inline-flex flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label={t('nav.collapseMenu')}
            title={`${t('nav.collapseMenu')} (Ctrl+\\)`}
          >
            <ChevronLeft size={16} className="transition-transform" />
          </button>
        )}
        {/* Cerrar drawer: solo movil */}
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label={t('nav.closeMenu')}
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Nav principal ──────────────────────────────────────── */}
      <nav
        ref={navRef}
        className="flex-1 overflow-y-auto overflow-x-hidden py-2 space-y-0.5 px-2"
      >
        {/* Búsqueda global (Cmd+K) */}
        <SearchButton collapsed={collapsed} />

        {/* Nueva tarea global (atajo C) */}
        <NewTaskButton collapsed={collapsed} />

        {/* Acceso directo: lo mas usado arriba y sin grupo */}
        <div className="space-y-0.5 pt-1">
          {topItems.map((item) => (
            <NavItem
              key={item.key}
              href={item.href}
              icon={<item.icon size={16} />}
              label={item.label}
              collapsed={collapsed}
              active={isActive(item.href, item.exact)}
              badge={
                item.key === 'inbox' ? (
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
          label={t('nav.groupWorkspace')}
          collapsed={collapsed}
          open={openGroups.workspace}
          hasActive={activeIn.workspace}
          onToggle={() => toggleGroup('workspace')}
        >
          {primaryItems.map((item) => (
            <NavItem
              key={item.key}
              href={item.href}
              icon={<item.icon size={16} />}
              label={item.label}
              collapsed={collapsed}
              active={isActive(item.href, item.exact)}
            />
          ))}

          {/* Bloque "Ver mas": el resto de las pantallas, fuera de la vista
              hasta que se piden. En modo colapsado no hay espacio para el
              interruptor, asi que ahi se muestran todas como iconos. */}
          {(moreOpen || collapsed) &&
            moreItems.map((item) => (
              <NavItem
                key={item.key}
                href={item.href}
                icon={<item.icon size={16} />}
                label={item.label}
                collapsed={collapsed}
                active={isActive(item.href, item.exact)}
              />
            ))}

          {/* El interruptor se esconde si el bloque esta abierto a la fuerza
              (estas dentro de una de esas pantallas): un boton que dice "Ver
              menos" y no hace nada es peor que no tenerlo. */}
          {!collapsed && moreItems.length > 0 && !moreHasActive && (
            <button
              onClick={toggleMore}
              aria-expanded={moreOpen}
              className={cn(
                'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors',
                'text-muted-foreground/70 hover:bg-accent hover:text-foreground'
              )}
            >
              <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                {moreOpen ? <ChevronDown size={16} /> : <MoreHorizontal size={16} />}
              </span>
              <span className="truncate">
                {moreOpen ? t('nav.showLess') : `${t('nav.showMore')} (${moreItems.length})`}
              </span>
            </button>
          )}
        </NavGroup>

        {/* Grupo: Equipos */}
        <NavGroup
          label={t('nav.groupTeams')}
          collapsed={collapsed}
          open={openGroups.equipos}
          hasActive={activeIn.equipos}
          onToggle={() => toggleGroup('equipos')}
          action={
            !collapsed && isAdmin ? (
              <Link
                href={`${base}/teams/new`}
                title={t('nav.newTeam')}
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
              {t('nav.createFirstTeam')}
            </Link>
          )}

          {!collapsed && teams.length === 0 && !isAdmin && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground/60">
              {t('nav.noTeams')}
            </p>
          )}
        </NavGroup>

        {/* Complementos: plugins instalados */}
        {plugins && plugins.filter(p => p.enabled).length > 0 && (
          <NavGroup
            label={t('nav.groupComplementos')}
            collapsed={collapsed}
            open={openGroups.complementos}
            onToggle={() => toggleGroup('complementos')}
            active={activeIn.complementos}
          >
            {plugins.filter(p => p.enabled).map(p => {
              const PluginIcon = PLUGIN_ICONS_MAP[p.app_id] || Puzzle
              const href = p.app_id === 'wlo-flows' ? `${base}/flows` : `${base}/p/${p.app_id}`
              const label = PLUGIN_LABELS[p.app_id] || p.app_id
              const active = p.app_id === 'wlo-flows' ? isActive(`${base}/flows`) : isActive(`${base}/p/${p.app_id}`)
              return (
                <NavItem key={p.id} href={href} icon={<PluginIcon size={16} />} label={label} collapsed={collapsed} active={active} />
              )
            })}
          </NavGroup>
        )}
      </nav>

      {/* ── Footer: idioma + perfil de usuario ─────────────────── */}
      <div className="border-t border-border p-2 space-y-1">
        <LanguageSwitcher collapsed={collapsed} />
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
  hasActive = false,
  onToggle,
  action,
  children,
}: {
  label: string
  collapsed: boolean
  open: boolean
  /** La ruta actual vive dentro de este grupo. Solo se dibuja si esta cerrado. */
  hasActive?: boolean
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
          {!open && hasActive && (
            <span
              className="ml-1 w-1.5 h-1.5 rounded-full bg-primary"
              title="Estás en una página de esta sección"
            />
          )}
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
      // Siempre, no solo colapsado: expandido tambien se truncan los nombres
      // largos y el tooltip es la unica forma de leerlos completos.
      title={label}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        collapsed && 'justify-center',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground'
      )}
    >
      {/* Barra de acento: en modo colapsado el fondo gris solo no alcanza para
          distinguir el item activo de un simple hover. */}
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-r bg-primary"
        />
      )}
      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
      {badge}
    </Link>
  )
}

// ── Nueva tarea con shortcut C ──────────────────────────────────────────────
function NewTaskButton({ collapsed }: { collapsed: boolean }) {
  const setOpen = useNewTask(s => s.setOpen)
  const { t } = useI18n()

  return (
    <button
      onClick={() => setOpen(true)}
      title={collapsed ? t('nav.newTaskHint') : undefined}
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
          <span className="flex-1 text-left">{t('nav.newTask')}</span>
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
  const { t } = useI18n()
  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform))
  }, [])

  return (
    <button
      onClick={toggle}
      title={collapsed ? t('nav.searchHint') : undefined}
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
          <span className="flex-1 text-left">{t('nav.search')}</span>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-muted text-muted-foreground rounded border border-border">
            {isMac ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </>
      )}
    </button>
  )
}

'use client'

/**
 * Navegacion por pestañas del panel de Configuración.
 * Resalta la pestaña activa segun el pathname.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Settings, Users, UsersRound, FolderKanban, Ticket, Gauge, Clock, BookOpen, Eye } from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'

export function SettingsNav({ workspaceSlug }: { workspaceSlug: string }) {
  const t = useT()
  const pathname = usePathname()
  const base = `/w/${workspaceSlug}/settings`

  const tabs = [
    { href: base, label: t('settings.tabGeneral'), icon: Settings, exact: true },
    { href: `${base}/lobby`, label: t('settings.tabLobby'), icon: Clock },
    { href: `${base}/members`, label: t('settings.tabMembers'), icon: Users },
    { href: `${base}/teams`, label: t('settings.tabTeams'), icon: UsersRound },
    { href: `${base}/departments`, label: t('settings.tabDepartments'), icon: FolderKanban },
    // Accesos va junto a Departamentos a propósito: es la MISMA palanca, vista
    // desde el lado de las personas en vez del lado del departamento.
    { href: `${base}/accesos`, label: 'Accesos', icon: Eye },
    { href: `${base}/invites`, label: t('settings.tabInvites'), icon: Ticket },
    { href: `${base}/performance`, label: t('settings.tabPerformance'), icon: Gauge },
    { href: `${base}/academia`, label: t('settings.tabAcademy'), icon: BookOpen },
  ]

  // Nueve pestañas no caben en una linea y el scroll lateral escondia las
  // ultimas: nadie descubre lo que no ve. Se dejan fluir en varias filas
  // (`flex-wrap`) y se marca la activa con una pastilla en vez de subrayado,
  // porque un subrayado en la fila de arriba se lee como si perteneciera a la
  // de abajo.
  return (
    <nav className="flex flex-wrap items-center gap-1 pb-2 border-b border-border">
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm whitespace-nowrap border transition-colors',
              active
                ? 'border-primary/40 bg-primary/10 text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <tab.icon size={15} className="flex-shrink-0" />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}

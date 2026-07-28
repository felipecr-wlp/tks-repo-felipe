'use client'

/**
 * Navegacion por pestañas del panel de Configuración.
 * Resalta la pestaña activa segun el pathname.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Settings, Users, UsersRound, FolderKanban, Ticket, Gauge, Clock, BookOpen } from 'lucide-react'
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
    { href: `${base}/invites`, label: t('settings.tabInvites'), icon: Ticket },
    { href: `${base}/performance`, label: t('settings.tabPerformance'), icon: Gauge },
    { href: `${base}/academia`, label: t('settings.tabAcademy'), icon: BookOpen },
  ]

  return (
    <nav className="flex items-center gap-1 border-b border-border overflow-x-auto">
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors',
              active
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <tab.icon size={15} />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}

'use client'

/**
 * Herramientas externas configuradas para aparecer en el menu lateral.
 *
 * Se consultan en el cliente para no recargar el layout entero cuando cambia
 * la configuracion de placement. El manifiesto de cada instalacion guarda
 * `{ placement: 'sidebar' | 'dashboard' | 'workarea' }`.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Blocks } from 'lucide-react'

interface SidebarTool {
  id: string
  app_id: string
  name: string
  href: string
}

export function SidebarExternalTools({
  workspaceSlug,
  workspaceId,
}: {
  workspaceSlug: string
  workspaceId: string
}) {
  const pathname = usePathname()
  const [tools, setTools] = useState<SidebarTool[]>([])

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('connector_installs')
      .select('id, app_id, manifest')
      .eq('workspace_id', workspaceId)
      .eq('enabled', true)
      .contains('manifest', { placement: 'sidebar' })
      .then(async ({ data: installs }) => {
        if (!installs || installs.length === 0) { setTools([]); return }
        const appIds = [...new Set(installs.map((i: any) => i.app_id))]
        const { data: apps } = await supabase
          .from('connector_apps')
          .select('id, name')
          .in('id', appIds)
          .eq('kind', 'embed')
        if (!apps) { setTools([]); return }
        const appMap = new Map(apps.map((a: any) => [a.id, a.name]))
        setTools(
          installs
            .filter((i: any) => appMap.has(i.app_id))
            .map((i: any) => ({
              id: i.id,
              app_id: i.app_id,
              name: appMap.get(i.app_id) || i.app_id,
              href: `/w/${workspaceSlug}/apps/${i.app_id}`,
            }))
        )
      })
  }, [workspaceId, workspaceSlug])

  if (tools.length === 0) return null

  return (
    <div className="px-2 pt-2">
      <div className="mb-1 px-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Herramientas
        </span>
      </div>
      {tools.map((tool) => {
        const active = pathname.startsWith(tool.href)
        return (
          <Link
            key={tool.id}
            href={tool.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors',
              active
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            {active && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-r bg-primary"
              />
            )}
            <Blocks size={16} className="flex-shrink-0" />
            <span className="truncate">{tool.name}</span>
          </Link>
        )
      })}
    </div>
  )
}

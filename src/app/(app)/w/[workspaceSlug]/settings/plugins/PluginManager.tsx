'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Hash, Clock, Workflow, Power, ChevronRight, ToggleRight, ToggleLeft, Upload, Store, Package } from 'lucide-react'

const PLUGIN_ICONS: Record<string, React.ReactNode> = {
  hash: <Hash className="w-5 h-5" />,
  clock: <Clock className="w-5 h-5" />,
  workflow: <Workflow className="w-5 h-5" />,
}

const PLUGIN_DESCRIPTIONS: Record<string, string> = {
  'wlo-counter': 'Widget interactivo: contador con botones +1/-1/reset. Ideal para demos del sistema de plugins.',
  'wlo-clock': 'Widget decorativo: reloj digital con hora en tiempo real. Ejemplo de widget con useEffect.',
  'wlo-flows': 'Editor visual de diagramas de flujo con nodos, formas, conexiones, import/export. Complemento completo.',
}

interface CatalogItem { id: string; name: string; icon: string }
interface InstalledItem { id: string; app_id: string; plugin_type: string; enabled: boolean }

interface Props {
  workspaceId: string
  workspaceSlug: string
  catalog: CatalogItem[]
  installed: InstalledItem[]
  isAdmin: boolean
}

export function PluginManager({ workspaceId, workspaceSlug, catalog, installed, isAdmin }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [tab, setTab] = useState<'installed' | 'marketplace'>('installed')

  const installMap = new Map(installed.map(i => [i.app_id, i]))

  async function doInstall(appId: string) {
    setLoading(appId)
    try {
      const r = await fetch('/api/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, app_id: appId, plugin_type: 'widget', enabled: true }),
      })
      if (!r.ok) throw new Error('Error')
      toast.success('Instalado')
      router.refresh()
    } catch { toast.error('Error al instalar') }
    finally { setLoading(null) }
  }

  async function doUninstall(installId: string) {
    setLoading(installId)
    try {
      await fetch(`/api/plugins/${installId}`, { method: 'DELETE' })
      toast.success('Desinstalado')
      router.refresh()
    } catch { toast.error('Error al desinstalar') }
    finally { setLoading(null) }
  }

  async function doUpload() {
    setLoading('upload')
    const el = document.createElement('input')
    el.type = 'file'; el.accept = '.zip'
    el.onchange = async (e: any) => {
      const file = e.target.files?.[0]; if (!file) return
      const fd = new FormData()
      fd.append('file', file)
      fd.append('workspace_id', workspaceId)
      try {
        const r = await fetch('/api/plugins/upload', { method: 'POST', body: fd })
        if (!r.ok) throw new Error((await r.json()).error || 'Error')
        toast.success('Plugin instalado desde ZIP')
        router.refresh()
      } catch (e: any) { toast.error(e.message || 'Error') }
      finally { setLoading(null) }
    }
    el.click()
  }

  const installedPlugins = catalog.filter(c => installMap.has(c.id))
  const marketplacePlugins = catalog.filter(c => !installMap.has(c.id))
  const displayedCatalog = tab === 'installed' ? installedPlugins : marketplacePlugins

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <button onClick={() => setTab('installed')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === 'installed' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <Package className="w-3.5 h-3.5 inline mr-1" />Instalados ({installedPlugins.length})
          </button>
          <button onClick={() => setTab('marketplace')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === 'marketplace' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <Store className="w-3.5 h-3.5 inline mr-1" />Marketplace ({marketplacePlugins.length})
          </button>
        </div>
        {isAdmin && tab === 'installed' && (
          <button onClick={doUpload} disabled={loading === 'upload'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50">
            <Upload className="w-3.5 h-3.5" />{loading === 'upload' ? 'Instalando...' : 'Subir .zip'}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {displayedCatalog.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Store className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">{tab === 'installed' ? 'No hay plugins instalados.' : 'No hay plugins disponibles.'}</p>
            {tab === 'installed' && (
              <button onClick={() => setTab('marketplace')} className="mt-3 text-xs text-primary hover:underline">Explorar Marketplace →</button>
            )}
          </div>
        ) : (
          displayedCatalog.map(app => {
            const inst = installMap.get(app.id)
            const isInstalled = !!inst
            const isEnabled = inst?.enabled ?? false

            const cardInner = (
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                  {PLUGIN_ICONS[app.icon] || <Power className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{app.name}</span>
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">{app.id}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {PLUGIN_DESCRIPTIONS[app.id] || 'Plugin para WLO Workspace.'}
                  </p>
                  {isInstalled && (
                    <span className={`inline-flex items-center gap-1 text-[10px] mt-1 ${isEnabled ? 'text-green-600' : 'text-amber-600'}`}>
                      {isEnabled ? <><ToggleRight className="w-3 h-3" />Activo</> : <><ToggleLeft className="w-3 h-3" />Inactivo</>}
                    </span>
                  )}
                </div>
              </div>
            )

            // Installed tab: clickable card linking to detail
            if (tab === 'installed' && inst) {
              return (
                <Link key={app.id} href={`/w/${workspaceSlug}/settings/plugins/${inst.id}`}
                  className="flex items-center gap-4 p-4 border rounded-xl bg-card hover:bg-accent/30 transition-colors cursor-pointer">
                  {cardInner}
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </Link>
              )
            }

            // Marketplace tab: static card with install button
            return (
              <div key={app.id} className="flex items-center gap-4 p-4 border rounded-xl bg-card">
                {cardInner}
                <button onClick={() => doInstall(app.id)} disabled={loading === app.id}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex-shrink-0">
                  {loading === app.id ? '...' : 'Instalar'}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

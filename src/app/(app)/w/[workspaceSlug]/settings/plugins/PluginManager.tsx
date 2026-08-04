'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Hash, Clock, Workflow, Power, ChevronRight, Upload, Store, Package, Eye, EyeOff, Link as LinkIcon } from 'lucide-react'

const PLUGIN_ICONS: Record<string, React.ReactNode> = {
  hash: <Hash className="w-5 h-5" />, clock: <Clock className="w-5 h-5" />, workflow: <Workflow className="w-5 h-5" />,
}

const PLUGIN_DESCRIPTIONS: Record<string, string> = {
  'wlo-counter': 'Widget interactivo: contador con botones +1/-1/reset.',
  'wlo-clock': 'Widget decorativo: reloj digital con hora en tiempo real.',
  'wlo-flows': 'Editor visual de diagramas de flujo con nodos, formas y conexiones.',
  'wlo-standalone': 'Plugin de ejemplo 100% independiente via iframe.',
}

interface CatalogItem { id: string; name: string; icon: string }
interface InstalledItem { id: string; app_id: string; plugin_type: string; enabled: boolean }

interface Props {
  workspaceId: string; workspaceSlug: string; catalog: CatalogItem[]; installed: InstalledItem[]
  isAdmin: boolean; userEnabled: Record<string, boolean>
}

export function PluginManager({ workspaceId, workspaceSlug, catalog, installed, isAdmin, userEnabled = {} }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [tab, setTab] = useState<'installed' | 'marketplace'>('installed')
  const [localEnabled, setLocalEnabled] = useState<Record<string, boolean>>(userEnabled)
  const [installUrl, setInstallUrl] = useState('')

  const installMap = new Map(installed.map(i => [i.app_id, i]))

  async function doInstall(appId: string) {
    if (!isAdmin) return
    setLoading(appId)
    try {
      const r = await fetch('/api/plugins', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, app_id: appId, plugin_type: 'widget', enabled: true }),
      })
      if (!r.ok) throw new Error('Error')
      toast.success('Instalado')
    router.refresh()
  } catch { toast.error('Error') }
    finally { setLoading(null) }
  }

  async function installFromUrl() {
    if (!installUrl.trim() || !isAdmin) return
    setLoading('url')
    try {
      const r = await fetch('/api/plugins/install-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: installUrl.trim(), workspace_id: workspaceId }),
      })
      if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Error') }
      toast.success('Plugin instalado desde URL')
      setInstallUrl('')
      router.refresh()
    } catch (e: any) { toast.error(e.message) }
    finally { setLoading(null) }
  }

  async function toggleUser(installId: string) {
    const next = !(localEnabled[installId] ?? true)
    setLocalEnabled(prev => ({ ...prev, [installId]: next }))
    await fetch('/api/user-plugins', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_id: installId, enabled: next }),
    })
  }

  async function doUpload() {
    if (!isAdmin) return
    setLoading('upload')
    const el = document.createElement('input'); el.type = 'file'; el.accept = '.zip'
    el.onchange = async (e: any) => {
      const file = e.target.files?.[0]; if (!file) return
      const fd = new FormData(); fd.append('file', file); fd.append('workspace_id', workspaceId)
      try {
        const r = await fetch('/api/plugins/upload', { method: 'POST', body: fd })
        if (!r.ok) throw new Error((await r.json()).error || 'Error')
        toast.success('Plugin instalado')
        router.refresh()
      } catch (e: any) { toast.error(e.message || 'Error') }
      finally { setLoading(null) }
    }
    el.click()
  }

  const installedList = catalog.filter(c => installMap.has(c.id))
  const marketplaceList = catalog.filter(c => !installMap.has(c.id))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <button onClick={() => setTab('installed')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === 'installed' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <Package className="w-3.5 h-3.5 inline mr-1" />Plugins ({installedList.length})
          </button>
          <button onClick={() => setTab('marketplace')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === 'marketplace' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <Store className="w-3.5 h-3.5 inline mr-1" />Marketplace ({marketplaceList.length})
          </button>
        </div>
        {isAdmin && tab === 'marketplace' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 border rounded-lg px-2 py-1 bg-background">
              <LinkIcon className="w-3 h-3 text-muted-foreground" />
              <input
                value={installUrl}
                onChange={e => setInstallUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && installFromUrl()}
                className="text-xs border-0 outline-none bg-transparent w-56"
                placeholder="https://...manifest.json"
              />
              <button onClick={installFromUrl} disabled={loading === 'url'}
                className="px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {loading === 'url' ? '...' : 'Instalar'}
              </button>
            </div>
            <button onClick={doUpload} disabled={loading === 'upload'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50">
              <Upload className="w-3.5 h-3.5" />{loading === 'upload' ? '...' : '.zip'}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {tab === 'installed' && installedList.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">No hay plugins instalados.</p>
            <button onClick={() => setTab('marketplace')} className="mt-3 text-xs text-primary hover:underline">Ir al Marketplace →</button>
          </div>
        ) : tab === 'marketplace' && marketplaceList.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Store className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">Todos los plugins estan instalados.</p>
          </div>
        ) : (
          (tab === 'installed' ? installedList : marketplaceList).map(app => {
            const inst = installMap.get(app.id)
            const ue = inst ? ((localEnabled[inst.id] ?? true)) : false

            const cardInner = (
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                  {PLUGIN_ICONS[app.icon] || <Power className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{app.name}</span>
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">{app.id}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{PLUGIN_DESCRIPTIONS[app.id] || 'Plugin para WLO.'}</p>
                </div>
              </div>
            )

            // Installed: user toggle + config link
            if (tab === 'installed' && inst) {
              return (
                <div key={app.id} className="flex items-center gap-2 p-3 border rounded-xl bg-card hover:bg-accent/20 transition-colors">
                  <Link href={`/w/${workspaceSlug}/settings/plugins/${inst.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                    {cardInner}
                  </Link>
                  <button onClick={(e) => { e.preventDefault(); toggleUser(inst.id) }}
                    className={`p-1.5 rounded-lg transition-colors ${ue ? 'text-green-600 hover:bg-green-50' : 'text-muted-foreground hover:bg-accent'}`}
                    title={ue ? 'Visible para mi' : 'Oculto para mi'}>
                    {ue ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <Link href={`/w/${workspaceSlug}/settings/plugins/${inst.id}`} className="text-muted-foreground hover:text-foreground">
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              )
            }

            // Marketplace: install (admin only) or info
            return (
              <div key={app.id} className="flex items-center gap-2 p-3 border rounded-xl bg-card">
                {cardInner}
                {isAdmin ? (
                  <button onClick={() => doInstall(app.id)} disabled={loading === app.id}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex-shrink-0">
                    {loading === app.id ? '...' : 'Instalar'}
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground flex-shrink-0">Solo admin</span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

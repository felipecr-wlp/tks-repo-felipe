'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Hash, Clock, Workflow, Power, ChevronRight, ToggleRight, ToggleLeft, Upload } from 'lucide-react'

const PLUGIN_ICONS: Record<string, React.ReactNode> = {
  hash: <Hash className="w-5 h-5" />,
  clock: <Clock className="w-5 h-5" />,
  workflow: <Workflow className="w-5 h-5" />,
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

  const installMap = new Map(installed.map(i => [i.app_id, i]))

  async function toggle(appId: string, installId?: string, enable?: boolean) {
    setLoading(appId)
    try {
      if (installId) {
        // Uninstall
        await fetch(`/api/plugins/${installId}`, { method: 'DELETE' })
        toast.success('Plugin desinstalado')
      } else {
        // Install
        const r = await fetch('/api/plugins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: workspaceId, app_id: appId, plugin_type: 'widget', enabled: true }),
        })
        if (!r.ok) throw new Error('Error')
        toast.success('Plugin instalado')
      }
      router.refresh()
    } catch {
      toast.error('Error al cambiar estado')
    } finally {
      setLoading(null)
    }
  }

  async function uploadZip() {
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
        toast.success('Plugin instalado')
        router.refresh()
      } catch (e: any) { toast.error(e.message || 'Error al instalar') }
      finally { setLoading(null) }
    }
    el.click()
  }

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex justify-end">
          <button onClick={uploadZip} disabled={loading === 'upload'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50">
            <Upload className="w-3.5 h-3.5" />{loading === 'upload' ? 'Instalando...' : 'Subir plugin (.zip)'}
          </button>
        </div>
      )}
      {catalog.map(app => {
        const inst = installMap.get(app.id)
        const isInstalled = !!inst
        const isEnabled = inst?.enabled ?? false

  async function uploadZip() {
    const el = document.createElement('input')
    el.type = 'file'; el.accept = '.zip'
    el.onchange = async (e: any) => {
      const file = e.target.files?.[0]; if (!file) return
      setLoading('upload')
      const fd = new FormData()
      fd.append('file', file)
      fd.append('workspace_id', workspaceId)
      try {
        const r = await fetch('/api/plugins/upload', { method: 'POST', body: fd })
        if (!r.ok) throw new Error((await r.json()).error || 'Error')
        toast.success('Plugin instalado')
        router.refresh()
      } catch (e: any) { toast.error(e.message || 'Error al instalar') }
      finally { setLoading(null) }
    }
    el.click()
  }

  return (
          <Link
            key={app.id}
            href={isInstalled ? `/w/${workspaceSlug}/settings/plugins/${inst!.id}` : '#'}
            onClick={e => { if (!isInstalled) e.preventDefault() }}
            className={`flex items-center gap-4 p-4 border rounded-xl bg-card transition-colors ${isInstalled ? 'hover:bg-accent/30 cursor-pointer' : 'opacity-50'}`}
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              {PLUGIN_ICONS[app.icon] || <Power className="w-5 h-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{app.name}</span>
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">{app.id}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                {isInstalled ? (
                  isEnabled ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600"><ToggleRight className="w-3 h-3" /> Activo</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-600"><ToggleLeft className="w-3 h-3" /> Inactivo</span>
                  )
                ) : (
                  <span className="text-xs text-muted-foreground">No instalado</span>
                )}
              </div>
            </div>
            {isInstalled && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            {!isInstalled && isAdmin && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(app.id) }}
                disabled={loading === app.id}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {loading === app.id ? '...' : 'Instalar'}
              </button>
            )}
          </Link>
        )
      })}
      {catalog.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No hay plugins disponibles.</p>
      )}
    </div>
  )
}

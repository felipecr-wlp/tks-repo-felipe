'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, ToggleRight, ToggleLeft, Trash2, Save, Settings, BarChart3, Hash, Clock, Workflow, Power } from 'lucide-react'

const PLUGIN_ICONS: Record<string, React.ReactNode> = {
  hash: <Hash className="w-5 h-5" />,
  clock: <Clock className="w-5 h-5" />,
  workflow: <Workflow className="w-5 h-5" />,
}

interface Props {
  pluginId: string
  workspaceSlug: string
  install: { id: string; app_id: string; manifest: Record<string, any>; enabled: boolean; installed_at: string; updated_at: string }
  catalog: { id: string; name: string; icon: string } | null
  isAdmin: boolean
  stats: { totalInstalls: number; flowCount: number }
}

const SLOTS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'sidebar-workspace', label: 'Menu Workspace' },
  { key: 'sidebar-complementos', label: 'Complementos' },
]

export function PluginDetail({ pluginId, workspaceSlug, install, catalog, isAdmin, stats }: Props) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(install.enabled)
  const [slots, setSlots] = useState<string[]>(install.manifest?.slots ?? ['sidebar-complementos'])
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  const name = catalog?.name ?? install.app_id

  async function saveConfig() {
    setSaving(true)
    try {
      const r = await fetch(`/api/plugins/${pluginId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, manifest: { slots } }),
      })
      if (!r.ok) throw new Error('Error')
      toast.success('Configuracion guardada')
      router.refresh()
    } catch { toast.error('Error al guardar') }
    finally { setSaving(false) }
  }

  async function toggleEnabled() {
    const newState = !enabled
    setEnabled(newState)
    try {
      const r = await fetch(`/api/plugins/${pluginId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newState }),
      })
      if (!r.ok) throw new Error('Error')
    } catch { setEnabled(!newState); toast.error('Error') }
  }

  async function resetData() {
    if (!confirm(`Eliminar todos los datos de "${name}"? Esta accion no se puede deshacer.`)) return
    setResetting(true)
    try {
      if (install.app_id === 'wlo-flows') {
        await fetch(`/api/flows?workspace_id=&reset=true`, { method: 'DELETE' })
      }
      toast.success('Datos eliminados')
    } catch { toast.error('Error al resetear') }
    finally { setResetting(false) }
  }

  async function uninstall() {
    if (!confirm(`Desinstalar "${name}"? Los datos se conservan.`)) return
    try {
      const r = await fetch(`/api/plugins/${pluginId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Error')
      toast.success('Plugin desinstalado')
      router.push(`/w/${workspaceSlug}/settings/plugins`)
    } catch { toast.error('Error al desinstalar') }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Link href={`/w/${workspaceSlug}/settings/plugins`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Volver a Plugins
      </Link>

      <div className="flex items-center gap-4 p-4 border rounded-xl bg-card">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
          {PLUGIN_ICONS[catalog?.icon ?? ''] || <Power className="w-6 h-6" />}
        </div>
        <div>
          <h2 className="text-lg font-semibold">{name}</h2>
          <p className="text-xs text-muted-foreground">{install.app_id}</p>
        </div>
        <div className="flex-1" />
        <button
          onClick={toggleEnabled}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}
        >
          {enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          {enabled ? 'Activo' : 'Inactivo'}
        </button>
      </div>

      {/* Config */}
      <div className="border rounded-xl p-5 bg-card space-y-4">
        <div className="flex items-center gap-2"><Settings className="w-4 h-4 text-muted-foreground" /><h3 className="font-medium text-sm">Donde aparece</h3></div>
        <div className="space-y-2">
          {SLOTS.map(slot => (
            <label key={slot.key} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={slots.includes(slot.key)}
                onChange={e => {
                  if (e.target.checked) setSlots([...slots, slot.key])
                  else setSlots(slots.filter(s => s !== slot.key))
                }}
                className="rounded"
              />
              <span className="text-sm">{slot.label}</span>
            </label>
          ))}
        </div>
        <button onClick={saveConfig} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium disabled:opacity-50">
          <Save className="w-4 h-4" />{saving ? 'Guardando...' : 'Guardar configuracion'}
        </button>
      </div>

      {/* Stats */}
      <div className="border rounded-xl p-5 bg-card space-y-3">
        <div className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-muted-foreground" /><h3 className="font-medium text-sm">Estadisticas</h3></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="text-2xl font-bold">{stats.totalInstalls}</div>
            <div className="text-xs text-muted-foreground">Instalaciones totales</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="text-2xl font-bold">{new Date(install.installed_at).toLocaleDateString('es-MX')}</div>
            <div className="text-xs text-muted-foreground">Instalado desde</div>
          </div>
          {install.app_id === 'wlo-flows' && (
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{stats.flowCount}</div>
              <div className="text-xs text-muted-foreground">Flows creados</div>
            </div>
          )}
        </div>
      </div>

      {/* Danger zone */}
      {isAdmin && (
        <div className="border border-destructive/30 rounded-xl p-5 bg-destructive/5 space-y-3">
          <h3 className="font-medium text-sm text-destructive">Zona de peligro</h3>
          <div className="flex gap-2">
            <button onClick={resetData} disabled={resetting} className="px-4 py-2 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 text-sm font-medium disabled:opacity-50">
              <Trash2 className="w-4 h-4 inline mr-1" />{resetting ? 'Limpiando...' : 'Limpiar datos'}
            </button>
            <button onClick={uninstall} className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm font-medium">
              Desinstalar plugin
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

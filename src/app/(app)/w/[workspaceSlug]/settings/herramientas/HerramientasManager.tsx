'use client'

/**
 * Marketplace de herramientas del workspace (la vista).
 *
 * Dos pestanas, "Instaladas" y "Disponibles", con su cuenta al lado, mas un
 * bloque de solo lectura con lo que WLO trae de fabrica.
 *
 * Decisiones de comportamiento:
 * - El estado se pinta OPTIMISTA (`localInstalled`) y se revierte si el servidor
 *   dice que no. Instalar cambia la barra lateral entera, asi que despues del OK
 *   se llama `router.refresh()` para que el layout vuelva a calcular
 *   `effectiveHidden()` y la pantalla nueva aparezca sin recargar a mano.
 * - Si `isAdmin` viene en false los botones se apagan y sale la etiqueta que lo
 *   explica. Hoy el layout de Configuracion ya no deja entrar a nadie mas, pero
 *   la vista no se apoya en eso: dejar los botones vivos para quien no puede
 *   usarlos seria mentirle, la ruta le responderia 403.
 * - Desinstalar avisa que NO se borran datos. Es la duda que frena a cualquiera
 *   antes de apretar, y contestarla en el mismo boton evita el ticket.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Plus, Trash2, Lock, Package, Store } from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'
import { FEATURE_ICONS } from '@/components/feature-icons'
import type { FeatureKey } from '@/lib/features'
import { EmptyState } from '@/components/ui/EmptyState'
import { confirmDialog } from '@/components/ConfirmDialog'

interface Herramienta {
  key: FeatureKey
  labelKey: string
  description: string
}

type Pestana = 'instaladas' | 'disponibles'

export function HerramientasManager({
  workspaceId,
  isAdmin,
  instalables,
  incluidas,
  installed,
}: {
  workspaceId: string
  isAdmin: boolean
  instalables: Herramienta[]
  incluidas: Herramienta[]
  installed: FeatureKey[]
}) {
  const t = useT()
  const router = useRouter()
  const [localInstalled, setLocalInstalled] = useState<FeatureKey[]>(installed)
  const [busy, setBusy] = useState<FeatureKey | null>(null)
  const [tab, setTab] = useState<Pestana>('instaladas')

  const puestas = instalables.filter((h) => localInstalled.includes(h.key))
  const libres = instalables.filter((h) => !localInstalled.includes(h.key))

  async function toggle(h: Herramienta, install: boolean) {
    if (!isAdmin) return
    if (!install) {
      const ok = await confirmDialog({
        message: `¿Desinstalar ${t(h.labelKey)}? La pantalla desaparece para todo el equipo. Los datos NO se borran: vuelven completos si la reinstalas.`,
        destructive: true,
        confirmLabel: 'Desinstalar',
      })
      if (!ok) return
    }

    setBusy(h.key)
    // Optimista: la tarjeta se mueve de pestana antes de la respuesta.
    const previo = localInstalled
    setLocalInstalled((prev) =>
      install ? [...prev, h.key] : prev.filter((k) => k !== h.key),
    )

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: h.key, install }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('settings.saveError'))

      // El servidor manda: se adopta su lista, no la adivinada.
      setLocalInstalled(data.installed ?? [])
      toast.success(install ? `${t(h.labelKey)} instalada` : `${t(h.labelKey)} desinstalada`)
      // Sin esto la barra lateral se queda como estaba hasta la proxima recarga.
      router.refresh()
    } catch (err) {
      setLocalInstalled(previo)
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setBusy(null)
    }
  }

  function Tarjeta({ h, estado }: { h: Herramienta; estado: 'puesta' | 'libre' | 'fija' }) {
    const Icon = FEATURE_ICONS[h.key]
    return (
      <div className="flex items-start gap-3 bg-card border border-border rounded-xl p-4">
        <div className="shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate">{t(h.labelKey)}</h3>
            {estado === 'puesta' && (
              <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Check size={11} /> Instalada
              </span>
            )}
            {estado === 'fija' && (
              <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                <Lock size={11} /> Incluida
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{h.description}</p>
        </div>

        {estado !== 'fija' && (
          <button
            onClick={() => toggle(h, estado === 'libre')}
            disabled={!isAdmin || busy === h.key}
            title={isAdmin ? undefined : 'Solo un admin del workspace puede instalar o desinstalar'}
            className={
              estado === 'libre'
                ? 'shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
                : 'shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted-foreground text-xs rounded-lg hover:text-destructive hover:border-destructive/40 disabled:opacity-50 disabled:cursor-not-allowed'
            }
          >
            {estado === 'libre' ? <Plus size={13} /> : <Trash2 size={13} />}
            {busy === h.key ? '...' : estado === 'libre' ? 'Instalar' : 'Desinstalar'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Las herramientas encienden pantallas para todo el workspace. Desinstalar apaga la
          pantalla, nunca borra el contenido.
        </p>
        {!isAdmin && (
          <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-muted text-muted-foreground">
            <Lock size={12} /> Solo lectura, se requiere admin
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {(
          [
            ['instaladas', 'Instaladas', puestas.length, Package],
            ['disponibles', 'Disponibles', libres.length, Store],
          ] as const
        ).map(([id, label, count, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={
              tab === id
                ? 'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-foreground border-b-2 border-primary -mb-px'
                : 'inline-flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground border-b-2 border-transparent -mb-px'
            }
          >
            <Icon size={14} />
            {label}
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {count}
            </span>
          </button>
        ))}
      </div>

      {tab === 'instaladas' &&
        (puestas.length === 0 ? (
          <EmptyState
            icon={<Package className="h-5 w-5" />}
            title="Sin herramientas instaladas"
            description="Ve a Disponibles para agregar la primera. Las funciones base de WLO siguen activas, no dependen de esto."
          />
        ) : (
          <div className="space-y-2">
            {puestas.map((h) => (
              <Tarjeta key={h.key} h={h} estado="puesta" />
            ))}
          </div>
        ))}

      {tab === 'disponibles' &&
        (libres.length === 0 ? (
          <EmptyState
            icon={<Store className="h-5 w-5" />}
            title="Ya tienes todo"
            description="No queda ninguna herramienta por instalar en este workspace."
          />
        ) : (
          <div className="space-y-2">
            {libres.map((h) => (
              <Tarjeta key={h.key} h={h} estado="libre" />
            ))}
          </div>
        ))}

      <div className="pt-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Incluidas en WLO
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Vienen de fabrica y no se instalan ni se quitan desde aqui. Para esconderle alguna a una
          persona en concreto se usa Accesos.
        </p>
        <div className="space-y-2">
          {incluidas.map((h) => (
            <Tarjeta key={h.key} h={h} estado="fija" />
          ))}
        </div>
      </div>
    </div>
  )
}

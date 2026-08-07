'use client'

/**
 * Herramientas externas del marketplace (la vista).
 *
 * Una herramienta externa NO es codigo que WLO compile: vive en su propio deploy
 * y su propio repo, en el lenguaje que quiera. Aqui solo se decide si este
 * workspace la usa y con que permisos.
 *
 * La pantalla de instalacion es el corazon de esto y por eso no es un boton
 * directo: primero se listan los permisos que la herramienta pide, uno por uno,
 * con su nivel de riesgo, y cada uno se puede desmarcar. Aceptar sin ver que se
 * acepta es como no tener permisos: el candado existiria en la base de datos y no
 * en la cabeza de quien aprieta.
 *
 * El token sale UNA sola vez, al terminar de instalar. No se puede volver a ver
 * porque en la base solo queda su hash. Si se pierde, se desinstala y se vuelve a
 * instalar, que es exactamente lo que deberia costar.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, Check, Copy, ExternalLink, Lock, Plug, ShieldAlert, Trash2 } from 'lucide-react'
import { confirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'

export interface ScopePedido {
  scope: string
  label: string
  risk: 'bajo' | 'medio' | 'alto'
  granted: boolean
}

export interface AppExterna {
  id: string
  name: string
  description: string | null
  icon: string | null
  kind: string
  status: string
  origin: string | null
  embeddable: boolean
  requested_scopes: ScopePedido[]
  install: {
    id: string
    enabled: boolean
    granted_scopes: string[]
    token_prefix: string | null
    token_expires_at: string | null
    pending_scopes: string[]
  } | null
}

const RIESGO: Record<string, { texto: string; clase: string }> = {
  bajo:  { texto: 'riesgo bajo',  clase: 'bg-muted text-muted-foreground' },
  medio: { texto: 'riesgo medio', clase: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  alto:  { texto: 'riesgo alto',  clase: 'bg-red-500/10 text-red-600 dark:text-red-400' },
}

export function AppsExternasManager({
  workspaceId,
  workspaceSlug,
  isAdmin,
  apps,
}: {
  workspaceId: string
  workspaceSlug: string
  isAdmin: boolean
  apps: AppExterna[]
}) {
  const router = useRouter()
  const [revisando, setRevisando] = useState<AppExterna | null>(null)
  const [marcados, setMarcados] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [tokenNuevo, setTokenNuevo] = useState<{ app: string; token: string } | null>(null)
  const [placement, setPlacement] = useState<string>('workarea')

  function abrirPermisos(app: AppExterna) {
    setRevisando(app)
    setMarcados(app.requested_scopes.map((s) => s.scope))
    // Cargar placement existente del manifest (si ya esta instalada)
    setPlacement((app.install && (app.install as any).manifest?.placement) || 'workarea')
  }

  async function instalar() {
    if (!revisando || !isAdmin) return
    setBusy(true)
    try {
      const yaEsta = revisando.install
      const res = await fetch(
        yaEsta ? `/api/connectors/installs/${yaEsta.id}` : '/api/connectors/installs',
        {
          method: yaEsta ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            yaEsta
              ? { granted_scopes: marcados, manifest: { placement } }
              : { workspace_id: workspaceId, app_id: revisando.id, granted_scopes: marcados, manifest: { placement } },
          ),
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo instalar')

      const nombre = revisando.name
      setRevisando(null)
      if (data.token) setTokenNuevo({ app: nombre, token: data.token })
      else toast.success(`Permisos actualizados para ${nombre}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(false)
    }
  }

  async function desinstalar(app: AppExterna) {
    if (!app.install || !isAdmin) return
    const ok = await confirmDialog({
      message: `¿Quitar ${app.name}? Su token deja de servir en el acto y la herramienta pierde el acceso a este workspace. Lo que ya creo aqui NO se borra.`,
      destructive: true,
      confirmLabel: 'Quitar',
    })
    if (!ok) return

    setBusy(true)
    try {
      const res = await fetch(`/api/connectors/installs/${app.install.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('No se pudo quitar')
      toast.success(`${app.name} fuera de este workspace`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(false)
    }
  }

  if (apps.length === 0) {
    return (
      <EmptyState
        icon={<Plug className="h-5 w-5" />}
        title="Todavia no hay herramientas del equipo"
        description="Aqui apareceran las que cada quien publique con su propio deploy. WLO no compila su codigo: solo guarda a donde apunta y que permisos pidio."
      />
    )
  }

  return (
    <div className="space-y-3">
      {apps.map((app) => {
        const inst = app.install
        return (
          <div key={app.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                <Plug size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-foreground truncate">{app.name}</h3>
                  {inst && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <Check size={11} /> Instalada
                    </span>
                  )}
                  {inst && inst.pending_scopes.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <AlertTriangle size={11} /> Pide {inst.pending_scopes.length} permiso(s) nuevo(s)
                    </span>
                  )}
                </div>
                {app.description && (
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{app.description}</p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground font-mono truncate">{app.origin}</p>
                {app.kind === 'embed' && !app.embeddable && (
                  <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                    Se abre en pestana aparte: su dominio no esta en la lista de los que WLO puede
                    mostrar por dentro.
                  </p>
                )}
              </div>

              <div className="shrink-0 flex items-center gap-2">
                {inst && app.embeddable && (
                  <a
                    href={`/w/${workspaceSlug}/apps/${app.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border text-xs rounded-lg hover:bg-muted"
                  >
                    <ExternalLink size={13} /> Abrir
                  </a>
                )}
                <button
                  onClick={() => abrirPermisos(app)}
                  disabled={!isAdmin || busy}
                  title={isAdmin ? undefined : 'Solo un admin del workspace puede instalar'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {inst ? 'Ver permisos' : 'Instalar'}
                </button>
                {inst && (
                  <button
                    onClick={() => desinstalar(app)}
                    disabled={!isAdmin || busy}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-border text-muted-foreground text-xs rounded-lg hover:text-destructive hover:border-destructive/40 disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* Pantalla de permisos: lo que se acepta, antes de aceptarlo. */}
      {revisando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-foreground">{revisando.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Esta herramienta vive en <span className="font-mono">{revisando.origin}</span> y pide
              lo siguiente sobre este workspace. Lo que dejes sin marcar, no lo va a poder hacer.
            </p>

            <div className="mt-4 space-y-2">
              {revisando.requested_scopes.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No pide ningun permiso sobre tus datos. Solo se abre.
                </p>
              )}
              {revisando.requested_scopes.map((s) => (
                <label
                  key={s.scope}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={marcados.includes(s.scope)}
                    onChange={(e) =>
                      setMarcados((prev) =>
                        e.target.checked ? [...prev, s.scope] : prev.filter((x) => x !== s.scope),
                      )
                    }
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-foreground">{s.label}</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded ${RIESGO[s.risk].clase}`}>
                        {RIESGO[s.risk].texto}
                      </span>
                    </span>
                    <span className="block text-[11px] text-muted-foreground font-mono mt-0.5">
                      {s.scope}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {revisando.install && (
              <div className="mt-4">
                <span className="text-xs font-medium text-foreground">Donde aparece</span>
                <div className="mt-1.5 grid gap-1.5 grid-cols-3">
                  {[
                    { key: 'workarea', label: 'Workarea', desc: 'Solo al abrir' },
                    { key: 'sidebar', label: 'Menu lateral', desc: 'Acceso rapido' },
                    { key: 'dashboard', label: 'Dashboard', desc: 'Widget en inicio' },
                  ].map(o => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setPlacement(o.key)}
                      className={`rounded-lg border px-3 py-2 text-left transition ${
                        placement === o.key ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border hover:bg-muted'
                      }`}
                    >
                      <span className="block text-[11px] font-medium text-foreground">{o.label}</span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">{o.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {marcados.some((s) => revisando.requested_scopes.find((r) => r.scope === s)?.risk === 'alto') && (
              <p className="mt-3 flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
                <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                Hay permisos de riesgo alto marcados. Concedelos solo si conoces a quien mantiene la
                herramienta.
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setRevisando(null)}
                className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={instalar}
                disabled={busy}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? 'Guardando...' : revisando.install ? 'Guardar permisos' : 'Aceptar e instalar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* El token, una sola vez. */}
      {tokenNuevo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg p-5">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Lock size={16} /> Token de {tokenNuevo.app}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Copialo ahora. No se vuelve a mostrar: en la base solo queda su huella, no el token.
              Es de esta instalacion, no tuyo, asi que sigue sirviendo aunque tu cuenta cambie, y
              muere cuando se quita la herramienta.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted rounded-lg px-3 py-2 break-all font-mono">
                {tokenNuevo.token}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(tokenNuevo.token)
                  toast.success('Token copiado')
                }}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 border border-border text-xs rounded-lg hover:bg-muted"
              >
                <Copy size={13} /> Copiar
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setTokenNuevo(null)}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              >
                Ya lo copie
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

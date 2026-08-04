'use client'

/**
 * Revision del catalogo de herramientas externas (la vista).
 *
 * Aprobar es lo que separa "alguien subio un link" de "esto se puede instalar en
 * cualquier workspace". Por eso esta pantalla no la ve un admin de workspace: la
 * ve el mando de la organizacion, y el servidor lo vuelve a exigir en
 * PATCH /api/connectors/apps/[appId].
 *
 * Se puede CORREGIR antes de aprobar (URL, ruta de embebido, permisos que pide)
 * porque revisar sin poder corregir obliga a rechazar por una coma y termina en
 * que nadie propone nada. Lo que NO pasa: quitar o agregar permisos aqui no toca
 * a quien ya la tiene instalada. Los workspaces conservan lo que aceptaron y lo
 * nuevo les aparece como pendiente. Pedir mas no se concede solo.
 *
 * Las dos advertencias que se pintan y no son decorativas:
 *   - Una herramienta 'embed' cuyo origen no esta en la allowlist del CSP se
 *     aprueba igual y despues NO carga. Sin este aviso eso se descubre el dia que
 *     alguien la instala y ve un recuadro en blanco.
 *   - Un permiso que no existe en el catalogo se ignora en todas las rutas. Sin
 *     el aviso, quien revisa creeria que concedio algo que nadie va a reconocer.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, Check, Clock, Package, Pencil, ShieldAlert, Undo2 } from 'lucide-react'
import { confirmDialog } from '@/components/ConfirmDialog'
import { SCOPE_CATALOG } from '@/lib/connectors/scopes'

export interface RevisionScope {
  scope: string
  label: string
  risk: 'bajo' | 'medio' | 'alto'
}

export interface RevisionApp {
  id: string
  name: string
  description: string | null
  base_url: string
  origin: string | null
  kind: string
  status: string
  embed_path: string | null
  created_at: string
  requested_scopes: RevisionScope[]
  scopes_desconocidos: string[]
  embeddable: boolean
  instalaciones: number
  propuesta_por: string | null
}

const ESTADO: Record<string, { texto: string; clase: string }> = {
  draft: { texto: 'En revision', clase: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  approved: { texto: 'Aprobada', clase: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  retired: { texto: 'Retirada', clase: 'bg-muted text-muted-foreground' },
}

const RIESGO: Record<string, string> = {
  bajo: 'bg-muted text-muted-foreground',
  medio: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  alto: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

export function RevisionAppsManager({ apps }: { apps: RevisionApp[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [editando, setEditando] = useState<RevisionApp | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [embedPath, setEmbedPath] = useState('')
  const [scopes, setScopes] = useState<string[]>([])

  async function patch(appId: string, cuerpo: Record<string, unknown>, exito: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/connectors/apps/${appId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'No se pudo actualizar')
      toast.success(exito)
      router.refresh()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function aprobar(app: RevisionApp) {
    const alto = app.requested_scopes.filter((s) => s.risk === 'alto')
    if (alto.length > 0) {
      const ok = await confirmDialog({
        message:
          `${app.name} pide ${alto.length} permiso(s) de riesgo alto (${alto.map((s) => s.label).join(', ')}). ` +
          'Aprobarla la deja disponible para que cualquier admin de workspace la instale. ¿Seguir?',
        confirmLabel: 'Aprobar',
      })
      if (!ok) return
    }
    await patch(app.id, { status: 'approved' }, `${app.name} aprobada y disponible en el catalogo`)
  }

  async function retirar(app: RevisionApp) {
    const ok = await confirmDialog({
      message:
        app.instalaciones > 0
          ? `${app.name} esta instalada en ${app.instalaciones} workspace(s). Retirarla la saca del catalogo para nuevas instalaciones. Las que ya existen NO se desinstalan solas.`
          : `Retirar ${app.name} del catalogo. Nadie mas la va a poder instalar.`,
      destructive: true,
      confirmLabel: 'Retirar',
    })
    if (!ok) return
    await patch(app.id, { status: 'retired' }, `${app.name} retirada del catalogo`)
  }

  function abrirEdicion(app: RevisionApp) {
    setEditando(app)
    setBaseUrl(app.base_url)
    setEmbedPath(app.embed_path ?? '')
    setScopes(app.requested_scopes.map((s) => s.scope))
  }

  async function guardarEdicion() {
    if (!editando) return
    const ok = await patch(
      editando.id,
      {
        base_url: baseUrl.trim(),
        embed_path: editando.kind === 'embed' ? (embedPath.trim() || null) : null,
        requested_scopes: scopes,
      },
      `${editando.name} corregida`,
    )
    if (ok) setEditando(null)
  }

  const pendientes = apps.filter((a) => a.status === 'draft')
  const resto = apps.filter((a) => a.status !== 'draft')

  function tarjeta(app: RevisionApp) {
    const estado = ESTADO[app.status] ?? ESTADO.draft
    return (
      <div key={app.id} className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
            <Package size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-foreground truncate">{app.name}</h3>
              <span className={`text-[11px] px-1.5 py-0.5 rounded ${estado.clase}`}>{estado.texto}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {app.kind === 'embed' ? 'pantalla' : 'conector'}
              </span>
              {app.instalaciones > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  instalada en {app.instalaciones}
                </span>
              )}
            </div>
            {app.description && (
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{app.description}</p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground font-mono truncate">
              {app.origin ?? app.base_url}
              {app.kind === 'embed' && app.embed_path ? app.embed_path : ''}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              <Clock size={10} className="inline mr-1 -mt-0.5" />
              {new Date(app.created_at).toLocaleDateString('es-MX')}
              {app.propuesta_por ? ` · propuesta por ${app.propuesta_por}` : ''}
              {' · '}
              <span className="font-mono">{app.id}</span>
            </p>

            {app.requested_scopes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {app.requested_scopes.map((s) => (
                  <span
                    key={s.scope}
                    className={`text-[10px] px-1.5 py-0.5 rounded ${RIESGO[s.risk]}`}
                    title={s.scope}
                  >
                    {s.label}
                  </span>
                ))}
              </div>
            )}

            {app.kind === 'embed' && !app.embeddable && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                Su origen no esta en la allowlist del CSP. Se puede aprobar, pero no va a cargar por
                dentro: hay que agregarlo en `embed-origins.json`, que es un cambio de codigo.
              </p>
            )}

            {app.scopes_desconocidos.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                <ShieldAlert size={12} className="shrink-0 mt-0.5" />
                Pide permisos que no existen: {app.scopes_desconocidos.join(', ')}. Se ignoran en todas
                las rutas, asi que la herramienta va a fallar creyendo que los tiene.
              </p>
            )}
          </div>

          <div className="shrink-0 flex flex-col items-stretch gap-1.5">
            <button
              onClick={() => abrirEdicion(app)}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 border border-border text-xs rounded-lg hover:bg-muted disabled:opacity-50"
            >
              <Pencil size={12} /> Corregir
            </button>
            {app.status !== 'approved' ? (
              <button
                onClick={() => aprobar(app)}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                <Check size={12} /> Aprobar
              </button>
            ) : (
              <button
                onClick={() => retirar(app)}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 border border-border text-muted-foreground text-xs rounded-lg hover:text-destructive hover:border-destructive/40 disabled:opacity-50"
              >
                <Undo2 size={12} /> Retirar
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {pendientes.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">
            {pendientes.length} esperando revision. En borrador no se listan en el marketplace ni se
            pueden instalar, aunque alguien mande la peticion a mano.
          </p>
          {pendientes.map(tarjeta)}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nada esperando revision. Lo que el equipo proponga aparece aqui antes de existir para nadie
          mas.
        </p>
      )}

      {resto.length > 0 && (
        <details className="pt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            Ya revisadas ({resto.length})
          </summary>
          <div className="mt-3 space-y-3">{resto.map(tarjeta)}</div>
        </details>
      )}

      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-foreground">Corregir {editando.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Cambiar los permisos aqui NO toca a quien ya la tiene instalada: cada workspace
              conserva lo que acepto y lo nuevo le aparece como pendiente.
            </p>

            <label className="mt-4 block">
              <span className="text-xs font-medium text-foreground">URL del deploy</span>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            {editando.kind === 'embed' && (
              <label className="mt-3 block">
                <span className="text-xs font-medium text-foreground">Ruta que se abre</span>
                <input
                  value={embedPath}
                  onChange={(e) => setEmbedPath(e.target.value)}
                  placeholder="/embed"
                  className="mt-1 w-full px-3 py-2 text-sm font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
            )}

            <div className="mt-3">
              <span className="text-xs font-medium text-foreground">Permisos que declara pedir</span>
              <div className="mt-1.5 space-y-1">
                {SCOPE_CATALOG.map((s) => (
                  <label
                    key={s.scope}
                    className="flex items-start gap-2.5 p-2 rounded-lg border border-border cursor-pointer hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={scopes.includes(s.scope)}
                      onChange={(e) =>
                        setScopes((prev) =>
                          e.target.checked ? [...prev, s.scope] : prev.filter((x) => x !== s.scope),
                        )
                      }
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-foreground">{s.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${RIESGO[s.risk]}`}>
                          riesgo {s.risk}
                        </span>
                      </span>
                      <span className="block text-[10px] text-muted-foreground font-mono">{s.scope}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setEditando(null)}
                className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={guardarEdicion}
                disabled={busy}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

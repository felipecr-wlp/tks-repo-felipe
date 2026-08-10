'use client'

/**
 * Panel de control de Conectores (cliente). Cuatro pestanas que hacen CRUD sobre
 * el registro via /api/connectors/*. Sin guion largo, espanol con tildes, iconos
 * lucide (nunca emojis).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Blocks, KeyRound, Webhook, ScrollText, Plus, Trash2, Copy, Check,
  ShieldCheck, Power, AlertTriangle, Activity, RefreshCw, Wifi, WifiOff,
  ArrowRight, CheckCircle2, XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { scopesForApp, type ConnectorApp } from '@/lib/connectors/scopes'

const APPS: { id: ConnectorApp; name: string }[] = [
  { id: 'wli', name: 'WLI Marketing OS' },
  { id: 'wlo', name: 'WLO Workspace' },
  { id: 'wlm', name: 'WLM Measure' },
]
const appName = (id: string) => APPS.find((a) => a.id === id)?.name ?? id

type Tab = 'complementos' | 'keys' | 'webhooks' | 'auditoria' | 'diagnostico'

interface KeyRow {
  id: string; name: string; target_app: string; token_prefix: string
  scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null
}
interface InstallRow {
  id: string; app_id: string; manifest: Record<string, unknown>; enabled: boolean; installed_at: string
}
interface WebhookRow {
  id: string; source_app: string; event: string; target_url: string; enabled: boolean; created_at: string
}
interface LogRow {
  id: number; caller_app: string | null; target_app: string | null; action: string | null
  scope: string | null; status: number | null; created_at: string
}

export function ConnectorsPanel({ workspaceId }: { workspaceId: string; workspaceSlug: string }) {
  const [tab, setTab] = useState<Tab>('complementos')

  const tabs: { id: Tab; label: string; icon: typeof Blocks }[] = [
    { id: 'complementos', label: 'Complementos', icon: Blocks },
    { id: 'keys', label: 'Keys', icon: KeyRound },
    { id: 'webhooks', label: 'Webhooks', icon: Webhook },
    { id: 'auditoria', label: 'Auditoria', icon: ScrollText },
    { id: 'diagnostico', label: 'Diagnostico', icon: Activity },
  ]

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-foreground">Conectores</h1>
        <p className="text-sm text-muted-foreground">
          El centro de mando del ecosistema. Autoriza que apps se conectan, con que
          permisos y por que via. Todo queda auditado y toda key se revoca en un clic.
        </p>
      </header>

      <nav className="flex flex-wrap items-center gap-1 pb-2 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm whitespace-nowrap border transition-colors',
              tab === t.id
                ? 'border-primary/40 bg-primary/10 text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            <t.icon size={15} className="flex-shrink-0" />
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'complementos' && <ComplementosTab workspaceId={workspaceId} />}
      {tab === 'keys' && <KeysTab workspaceId={workspaceId} />}
      {tab === 'webhooks' && <WebhooksTab workspaceId={workspaceId} />}
      {tab === 'auditoria' && <AuditoriaTab workspaceId={workspaceId} />}
      {tab === 'diagnostico' && <DiagnosticoTab workspaceId={workspaceId} />}
    </div>
  )
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-border bg-card p-4', className)}>{children}</div>
}
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? 'Copiado' : 'Copiar'}
    </button>
  )
}

// ── Complementos ──────────────────────────────────────────────────────────────
function ComplementosTab({ workspaceId }: { workspaceId: string }) {
  const [installs, setInstalls] = useState<InstallRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch(`/api/connectors/installs?workspace_id=${workspaceId}`)
    const json = await res.json()
    setInstalls(json.installs ?? [])
    setLoading(false)
  }, [workspaceId])
  useEffect(() => { load() }, [load])

  const installOf = (appId: string) => installs.find((i) => i.app_id === appId)

  const install = async (appId: ConnectorApp) => {
    const manifest = { id: appId, name: appName(appId), app: appId }
    await fetch('/api/connectors/installs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, app_id: appId, manifest, enabled: true }),
    })
    load()
  }
  const toggle = async (row: InstallRow) => {
    await fetch(`/api/connectors/installs/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !row.enabled }),
    })
    load()
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando complementos...</p>

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {APPS.map((app) => {
        const row = installOf(app.id)
        const scopes = scopesForApp(app.id)
        return (
          <Card key={app.id}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-medium text-foreground">{app.name}</h3>
                <p className="text-xs text-muted-foreground">{scopes.length} acciones disponibles</p>
              </div>
              {row ? (
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full border',
                  row.enabled ? 'border-emerald-500/40 text-emerald-500' : 'border-border text-muted-foreground',
                )}>
                  {row.enabled ? 'Activo' : 'Pausado'}
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                  Sin instalar
                </span>
              )}
            </div>
            <ul className="mt-3 space-y-1">
              {scopes.map((s) => (
                <li key={s.scope} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck size={12} className="flex-shrink-0" />
                  <span className="font-mono">{s.scope}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              {row ? (
                <button
                  onClick={() => toggle(row)}
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-accent"
                >
                  <Power size={14} /> {row.enabled ? 'Pausar' : 'Activar'}
                </button>
              ) : (
                <button
                  onClick={() => install(app.id)}
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90"
                >
                  <Plus size={14} /> Instalar
                </button>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ── Keys ──────────────────────────────────────────────────────────────────────
function KeysTab({ workspaceId }: { workspaceId: string }) {
  const [keys, setKeys] = useState<KeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [targetApp, setTargetApp] = useState<ConnectorApp>('wli')
  const [selScopes, setSelScopes] = useState<string[]>([])

  const load = useCallback(async () => {
    const res = await fetch(`/api/connectors/keys?workspace_id=${workspaceId}`)
    const json = await res.json()
    setKeys(json.keys ?? [])
    setLoading(false)
  }, [workspaceId])
  useEffect(() => { load() }, [load])

  const create = async () => {
    const res = await fetch('/api/connectors/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, name, target_app: targetApp, scopes: selScopes }),
    })
    const json = await res.json()
    if (json.token) setNewToken(json.token)
    setCreating(false); setName(''); setSelScopes([])
    load()
  }
  const revoke = async (id: string) => {
    await fetch(`/api/connectors/keys/${id}`, { method: 'DELETE' })
    load()
  }

  const appScopes = scopesForApp(targetApp)

  return (
    <div className="space-y-4">
      {newToken && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-emerald-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Copia el token ahora. No se vuelve a mostrar.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="text-xs bg-background border border-border rounded px-2 py-1 break-all">{newToken}</code>
                <CopyBtn text={newToken} />
              </div>
            </div>
            <button onClick={() => setNewToken(null)} className="text-xs text-muted-foreground hover:text-foreground">Ocultar</button>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Tokens que autorizan a una app a llamar a otra, con scopes acotados.</p>
        {!creating && (
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90">
            <Plus size={14} /> Crear key
          </button>
        )}
      </div>

      {creating && (
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted-foreground">Nombre</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="WLO -> WLI (emailer)"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">App destino</span>
              <select value={targetApp} onChange={(e) => { setTargetApp(e.target.value as ConnectorApp); setSelScopes([]) }}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
                {APPS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3">
            <span className="text-sm text-muted-foreground">Scopes autorizados</span>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {appScopes.map((s) => (
                <label key={s.scope} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selScopes.includes(s.scope)}
                    onChange={(e) => setSelScopes((prev) => e.target.checked ? [...prev, s.scope] : prev.filter((x) => x !== s.scope))} />
                  <span className="font-mono text-xs">{s.scope}</span>
                  {s.risk === 'alto' && <span className="text-xs text-amber-500">riesgo alto</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button onClick={create} disabled={!name.trim()}
              className="text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
              Crear
            </button>
            <button onClick={() => { setCreating(false); setName(''); setSelScopes([]) }}
              className="text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-accent">Cancelar</button>
          </div>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando keys...</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aun no hay keys.</p>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <Card key={k.id} className={cn('flex items-center justify-between', k.revoked_at && 'opacity-50')}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{k.name}</span>
                  <span className="text-xs text-muted-foreground">hacia {appName(k.target_app)}</span>
                  {k.revoked_at && <span className="text-xs text-red-500">revocada</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <code className="text-xs text-muted-foreground">{k.token_prefix}...</code>
                  {k.scopes.map((s) => (
                    <span key={s} className="text-xs px-1.5 py-0.5 rounded bg-accent text-muted-foreground font-mono">{s}</span>
                  ))}
                </div>
              </div>
              {!k.revoked_at && (
                <button onClick={() => revoke(k.id)} className="inline-flex items-center gap-1 text-sm text-red-500 hover:text-red-400">
                  <Trash2 size={14} /> Revocar
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Webhooks ──────────────────────────────────────────────────────────────────
function WebhooksTab({ workspaceId }: { workspaceId: string }) {
  const [hooks, setHooks] = useState<WebhookRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [sourceApp, setSourceApp] = useState<ConnectorApp>('wli')
  const [event, setEvent] = useState('')
  const [targetUrl, setTargetUrl] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/connectors/webhooks?workspace_id=${workspaceId}`)
    const json = await res.json()
    setHooks(json.webhooks ?? [])
    setLoading(false)
  }, [workspaceId])
  useEffect(() => { load() }, [load])

  const create = async () => {
    const res = await fetch('/api/connectors/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, source_app: sourceApp, event, target_url: targetUrl }),
    })
    const json = await res.json()
    if (json.secret) setSecret(json.secret)
    setCreating(false); setEvent(''); setTargetUrl('')
    load()
  }
  const remove = async (id: string) => {
    await fetch(`/api/connectors/webhooks/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="space-y-4">
      {secret && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <p className="text-sm font-medium text-foreground">Secreto del webhook. Copialo para configurar el emisor.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="text-xs bg-background border border-border rounded px-2 py-1 break-all">{secret}</code>
            <CopyBtn text={secret} />
            <button onClick={() => setSecret(null)} className="text-xs text-muted-foreground hover:text-foreground">Ocultar</button>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Cuando pase un evento en una app, arranca algo en otra. Firmado con HMAC.</p>
        {!creating && (
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90">
            <Plus size={14} /> Nueva suscripcion
          </button>
        )}
      </div>

      {creating && (
        <Card>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="text-muted-foreground">App que emite</span>
              <select value={sourceApp} onChange={(e) => setSourceApp(e.target.value as ConnectorApp)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
                {APPS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Evento</span>
              <input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="lead.created"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">URL destino</span>
              <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://..."
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button onClick={create} disabled={!event.trim() || !targetUrl.trim()}
              className="text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">Crear</button>
            <button onClick={() => setCreating(false)} className="text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-accent">Cancelar</button>
          </div>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando webhooks...</p>
      ) : hooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aun no hay suscripciones.</p>
      ) : (
        <div className="space-y-2">
          {hooks.map((h) => (
            <Card key={h.id} className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-foreground">{h.event}</span>
                  <span className="text-xs text-muted-foreground">desde {appName(h.source_app)}</span>
                </div>
                <p className="text-xs text-muted-foreground break-all">{h.target_url}</p>
              </div>
              <button onClick={() => remove(h.id)} className="inline-flex items-center gap-1 text-sm text-red-500 hover:text-red-400">
                <Trash2 size={14} /> Eliminar
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Diagnostico ───────────────────────────────────────────────────────────────
interface DiagnosticoReport {
  checkedAt: string
  apps: Record<string, DiagnosticoApp>
}
interface DiagnosticoApp {
  meta: { id: string; name: string; description: string; urlEsperada: string | null }
  connection: {
    ok: boolean; configurado: boolean; url: string | null; tokenPresente: boolean
    latenciaMs: number | null; status: number | null; error: string | null; detalle: string | null
  }
  install: {
    id: string; app_id: string; enabled: boolean
    granted_scopes: string[] | null; installed_at: string | null
  } | null
  scopes: {
    scope: string; label: string; risk: string; estado: 'disponible' | 'reservado'
    direccion: 'entrante' | 'saliente'; action: string | null; desplegado: boolean; nota: string
  }[]
  manual: {
    direccion: 'entrante' | 'saliente'; action: string; scope: string | null
    ruta: string; cuerpo: string; respuesta: string; nota: string
  }[]
}

const ORDEN_APPS = ['wli', 'wlo', 'wlm']

function DiagnosticoTab({ workspaceId }: { workspaceId: string }) {
  const [report, setReport] = useState<DiagnosticoReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRunning(true); setError(null)
    try {
      const res = await fetch(`/api/connectors/diagnostico?workspace_id=${workspaceId}`)
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'No se pudo correr el diagnostico'); setReport(null) }
      else setReport(json as DiagnosticoReport)
    } catch {
      setError('No se pudo contactar el servidor.')
    } finally {
      setLoading(false); setRunning(false)
    }
  }, [workspaceId])
  useEffect(() => { load() }, [load])

  const estadoChip = (estado: 'disponible' | 'reservado') =>
    estado === 'disponible'
      ? 'bg-emerald-500/10 text-emerald-600'
      : 'bg-amber-500/10 text-amber-600'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Prueba la conexion con cada app, analiza los permisos que expone y el
          despliegue de su comunicacion. Nada se escribe: es puro diagnostico.
        </p>
        <button
          onClick={load}
          disabled={running}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw size={14} className={cn(running && 'animate-spin')} />
          {running ? 'Probando...' : 'Ejecutar de nuevo'}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Corriendo el diagnostico...</p>
      ) : error ? (
        <Card className="border-red-500/30">
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      ) : report ? (
        ORDEN_APPS.map((id) => {
          const app = report.apps[id]
          if (!app) return null
          const conn = app.connection
          const badge = conn.ok
            ? { texto: 'Operativa', clase: 'bg-emerald-500/10 text-emerald-600', Icon: Wifi }
            : conn.configurado
              ? { texto: 'Falló', clase: 'bg-red-500/10 text-red-600', Icon: WifiOff }
              : { texto: 'Sin configurar', clase: 'bg-amber-500/10 text-amber-600', Icon: WifiOff }

          return (
            <Card key={id} className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium text-foreground">{app.meta.name}</h3>
                  <p className="text-xs text-muted-foreground">{app.meta.description}</p>
                </div>
                <span className={cn('inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border', badge.clase)}>
                  <badge.Icon size={12} /> {badge.texto}
                </span>
              </div>

              {/* Conexion */}
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Conexión</span>
                <div className="mt-1 space-y-1 text-xs">
                  {conn.ok && (
                    <p className="text-emerald-600 flex items-center gap-1.5">
                      <CheckCircle2 size={13} />
                      {conn.detalle}
                      {conn.latenciaMs != null && <span className="text-muted-foreground">({conn.latenciaMs} ms)</span>}
                    </p>
                  )}
                  {!conn.ok && (
                    <p className={conn.configurado ? 'text-red-600' : 'text-amber-600'}>{conn.error}</p>
                  )}
                  {!conn.ok && conn.detalle && (
                    <p className="text-muted-foreground">{conn.detalle}</p>
                  )}
                  {conn.url && (
                    <code className="block bg-muted rounded px-2 py-1 font-mono text-[11px] break-all">{conn.url}</code>
                  )}
                  {!conn.url && app.meta.urlEsperada && !conn.configurado && (
                    <code className="block bg-muted rounded px-2 py-1 font-mono text-[11px] break-all">{app.meta.urlEsperada}</code>
                  )}
                </div>
              </div>

              {/* Instalacion */}
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Instalación</span>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  {app.install ? (
                    <span className={cn('px-2 py-0.5 rounded-full border', app.install.enabled ? 'border-emerald-500/40 text-emerald-500' : 'border-border text-muted-foreground')}>
                      {app.install.enabled ? 'Instalado y activo' : 'Instalado pero pausado'}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full border border-border text-muted-foreground">Sin instalar</span>
                  )}
                  {(app.install?.granted_scopes ?? []).map((s) => (
                    <span key={s} className="text-xs px-1.5 py-0.5 rounded bg-accent text-muted-foreground font-mono">{s}</span>
                  ))}
                </div>
              </div>

              {/* Permisos y despliegue */}
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Permisos y despliegue</span>
                <div className="mt-1.5 space-y-1.5">
                  {app.scopes.map((s) => (
                    <div key={s.scope} className="rounded-lg border border-border p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{s.label}</span>
                        <code className="text-[11px] font-mono text-muted-foreground">{s.scope}</code>
                        <span className={cn('text-[10px] px-1 py-0.5 rounded', estadoChip(s.estado))}>{s.estado}</span>
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                          {s.direccion} <ArrowRight size={10} />
                        </span>
                        {s.desplegado ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
                            <CheckCircle2 size={10} /> Desplegado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded bg-red-500/10 text-red-600">
                            <XCircle size={10} /> Sin acción
                          </span>
                        )}
                        {s.action && <code className="text-[10px] font-mono text-muted-foreground">{s.action}</code>}
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{s.nota}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Manual de comunicacion */}
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Manual de comunicación</span>
                {app.manual.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sin canales documentados. Configure las variables de entorno de esta app en el servidor.
                  </p>
                ) : (
                  <div className="mt-1.5 space-y-2">
                    {app.manual.map((c) => (
                      <div key={c.ruta + c.action} className="rounded-lg border border-border p-2.5 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase">{c.direccion}</span>
                          <code className="text-[11px] font-mono text-foreground">{c.action}</code>
                          {c.scope && <code className="text-[10px] font-mono text-muted-foreground">{c.scope}</code>}
                        </div>
                        <code className="block text-[11px] font-mono text-muted-foreground break-all">{c.ruta}</code>
                        <div className="grid gap-1 sm:grid-cols-2">
                          <div>
                            <p className="text-[10px] text-muted-foreground">Cuerpo</p>
                            <code className="block text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5 break-all">{c.cuerpo}</code>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">Respuesta</p>
                            <code className="block text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5 break-all">{c.respuesta}</code>
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{c.nota}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )
        })
      ) : null}
    </div>
  )
}

// ── Auditoria ─────────────────────────────────────────────────────────────────
function AuditoriaTab({ workspaceId }: { workspaceId: string }) {
  const [rows, setRows] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/connectors/log?workspace_id=${workspaceId}&limit=200`)
      .then((r) => r.json())
      .then((j) => { setRows(j.log ?? []); setLoading(false) })
  }, [workspaceId])

  const statusColor = (s: number | null) =>
    s === 200 ? 'text-emerald-500' : s && s >= 500 ? 'text-red-500' : 'text-amber-500'

  if (loading) return <p className="text-sm text-muted-foreground">Cargando bitacora...</p>
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Aun no hay llamadas registradas.</p>

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Cuando</th>
            <th className="px-3 py-2 font-medium">Origen</th>
            <th className="px-3 py-2 font-medium">Destino</th>
            <th className="px-3 py-2 font-medium">Accion</th>
            <th className="px-3 py-2 font-medium">Scope</th>
            <th className="px-3 py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/50">
              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString('es-MX')}</td>
              <td className="px-3 py-2">{r.caller_app ? appName(r.caller_app) : '-'}</td>
              <td className="px-3 py-2">{r.target_app ? appName(r.target_app) : '-'}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.action ?? '-'}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.scope ?? '-'}</td>
              <td className={cn('px-3 py-2 font-medium', statusColor(r.status))}>{r.status ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

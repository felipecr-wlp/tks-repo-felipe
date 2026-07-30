'use client'

/**
 * Panel de control de Conectores (cliente). Cuatro pestanas que hacen CRUD sobre
 * el registro via /api/connectors/*. Sin guion largo, espanol con tildes, iconos
 * lucide (nunca emojis).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Blocks, KeyRound, Webhook, ScrollText, Plus, Trash2, Copy, Check,
  ShieldCheck, Power, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { scopesForApp, type ConnectorApp } from '@/lib/connectors/scopes'

const APPS: { id: ConnectorApp; name: string }[] = [
  { id: 'wli', name: 'WLI Marketing OS' },
  { id: 'wlo', name: 'WLO Workspace' },
  { id: 'wlm', name: 'WLM Measure' },
]
const appName = (id: string) => APPS.find((a) => a.id === id)?.name ?? id

type Tab = 'complementos' | 'keys' | 'webhooks' | 'auditoria'

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

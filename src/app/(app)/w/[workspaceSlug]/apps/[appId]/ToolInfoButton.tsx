'use client'

import { useState } from 'react'
import {
  Info, X, ExternalLink, ShieldAlert, ShieldCheck, Clock, Key, Unlock,
  RefreshCw, Wifi, WifiOff, ArrowRight, CheckCircle2, XCircle,
} from 'lucide-react'

interface ScopeInfo {
  scope: string
  label: string
  risk: 'bajo' | 'medio' | 'alto'
  granted: boolean
}

interface ScopeAnalysis {
  scope: string
  label: string
  risk: string
  estado: 'disponible' | 'reservado'
  direccion: 'entrante' | 'saliente'
  action: string | null
  desplegado: boolean
  nota: string
}

interface ToolInfo {
  name: string
  description: string | null
  baseUrl: string
  kind: string
  status: string
  embedPath: string | null
  embeddable: boolean
  installId: string
  enabled: boolean
  tokenPrefix: string | null
  tokenExpires: string | null
  scopes: ScopeInfo[]
  pendingScopes: string[]
  requestedCount: number
  grantedCount: number
  scopeAnalysis: ScopeAnalysis[]
  workspaceId: string
}

const RIESGO: Record<string, { clase: string }> = {
  bajo: { clase: 'bg-muted text-muted-foreground' },
  medio: { clase: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  alto: { clase: 'bg-red-500/10 text-red-600 dark:text-red-400' },
}

const ESTADO: Record<string, { texto: string; clase: string }> = {
  draft: { texto: 'Borrador', clase: 'bg-amber-500/10 text-amber-600' },
  approved: { texto: 'Aprobada', clase: 'bg-emerald-500/10 text-emerald-600' },
  retired: { texto: 'Retirada', clase: 'bg-muted text-muted-foreground' },
}

export function ToolInfoButton({ tool }: { tool: ToolInfo }) {
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<Record<string, {
    ok: boolean; configurado: boolean; latenciaMs: number | null
    error: string | null; detalle: string | null
  }> | null>(null)

  const runCheck = async () => {
    setChecking(true); setCheckError(null); setCheckResult(null)
    try {
      const res = await fetch(`/api/connectors/diagnostico?workspace_id=${tool.workspaceId}`)
      const json = await res.json()
      if (!res.ok) setCheckError(json.error ?? 'No se pudo correr el diagnostico')
      else {
        const apps: Record<string, { connection: { ok: boolean; configurado: boolean; latenciaMs: number | null; error: string | null; detalle: string | null } }> = json.apps ?? {}
        setCheckResult(Object.fromEntries(
          Object.entries(apps).map(([id, a]) => [id, a.connection]),
        ))
      }
    } catch {
      setCheckError('No se pudo contactar el servidor.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Info size={13} />
        Detalles
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-card border border-border rounded-xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <h3 className="text-sm font-semibold text-foreground">{tool.name}</h3>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Estado y tipo */}
              <div className="flex items-center gap-2">
                <span className={`text-[11px] px-1.5 py-0.5 rounded ${ESTADO[tool.status]?.clase ?? ''}`}>
                  {ESTADO[tool.status]?.texto ?? tool.status}
                </span>
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {tool.kind === 'embed' ? 'Pantalla' : 'Conector'}
                </span>
                {tool.embeddable ? (
                  <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
                    <ShieldCheck size={10} /> CSP ok
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                    <ShieldAlert size={10} /> CSP pendiente
                  </span>
                )}
              </div>

              {tool.description && (
                <p className="text-xs text-muted-foreground leading-relaxed">{tool.description}</p>
              )}

              {/* URL */}
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">URL</span>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 text-[11px] bg-muted rounded-lg px-3 py-2 break-all font-mono">{tool.baseUrl}</code>
                  <a
                    href={tool.baseUrl + (tool.embedPath ?? '')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-2 border border-border rounded-lg text-xs hover:bg-muted"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
                {tool.embedPath && (
                  <p className="mt-1 text-[11px] text-muted-foreground">Ruta embed: <code className="font-mono">{tool.embedPath}</code></p>
                )}
              </div>

              {/* Instalacion */}
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Instalacion</span>
                <div className="mt-1 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ID</span>
                    <code className="font-mono text-[11px]">{tool.installId.slice(0, 8)}...</code>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Estado</span>
                    <span className={tool.enabled ? 'text-emerald-600' : 'text-muted-foreground'}>
                      {tool.enabled ? 'Activa' : 'Apagada'}
                    </span>
                  </div>
                  {tool.tokenPrefix && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Token</span>
                      <code className="font-mono text-[11px]">{tool.tokenPrefix}...</code>
                    </div>
                  )}
                  {tool.tokenExpires && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expira</span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {new Date(tool.tokenExpires).toLocaleDateString('es-MX')}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Permisos */}
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Permisos</span>
                <div className="mt-1 text-xs text-muted-foreground mb-2">
                  {tool.grantedCount} de {tool.requestedCount} concedidos
                </div>
                {tool.scopes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No pide permisos sobre los datos del workspace.</p>
                ) : (
                  <div className="space-y-1">
                    {tool.scopes.map(s => (
                      <div
                        key={s.scope}
                        className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs ${
                          s.granted ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {s.granted ? <Unlock size={12} className="text-emerald-600 shrink-0" /> : <Key size={12} className="text-amber-600 shrink-0" />}
                          <span className="truncate">{s.label}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`text-[10px] px-1 py-0.5 rounded ${RIESGO[s.risk]?.clase ?? ''}`}>
                            {s.risk}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {s.granted ? 'Concedido' : 'Pendiente'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {tool.pendingScopes.length > 0 && (
                  <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                    Hay {tool.pendingScopes.length} permiso(s) pendiente(s). La herramienta los pidio pero este workspace no se los ha concedido.
                  </p>
                )}
              </div>

              {/* Despliegue de la comunicacion por permiso */}
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Despliegue de la comunicación</span>
                {tool.scopeAnalysis.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">La herramienta no pide permisos sobre el workspace.</p>
                ) : (
                  <div className="mt-1.5 space-y-1.5">
                    {tool.scopeAnalysis.map((s) => (
                      <div key={s.scope} className="rounded-lg border border-border p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-foreground">{s.label}</span>
                          <code className="text-[10px] font-mono text-muted-foreground">{s.scope}</code>
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
                        </div>
                        {s.action && (
                          <code className="mt-1 block text-[10px] font-mono text-muted-foreground">{s.action}</code>
                        )}
                        <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{s.nota}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Diagnostico de conexion */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Diagnóstico de conexión</span>
                  <button
                    onClick={runCheck}
                    disabled={checking}
                    className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
                  >
                    <RefreshCw size={11} className={checking ? 'animate-spin' : ''} />
                    {checking ? 'Probando...' : 'Probar conexión'}
                  </button>
                </div>
                {checkError ? (
                  <p className="mt-2 text-xs text-red-600">{checkError}</p>
                ) : checkResult ? (
                  <div className="mt-2 space-y-1.5">
                    {(['wli', 'wlo', 'wlm'] as const).map((id) => {
                      const c = checkResult[id]
                      if (!c) return null
                      const NOMBRES: Record<string, string> = {
                        wli: 'WLI Marketing OS',
                        wlo: 'WLO Workspace',
                        wlm: 'WLM Measure',
                      }
                      return (
                        <div key={id} className="flex items-start justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs">
                          <div className="min-w-0">
                            <span className="font-medium text-foreground">{NOMBRES[id]}</span>
                            <p className="text-[11px] text-muted-foreground break-words">
                              {c.ok
                                ? c.detalle
                                : c.configurado
                                  ? c.error
                                  : c.error}
                            </p>
                          </div>
                          <span className={`inline-flex items-center gap-1 shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                            c.ok
                              ? 'bg-emerald-500/10 text-emerald-600'
                              : c.configurado
                                ? 'bg-red-500/10 text-red-600'
                                : 'bg-amber-500/10 text-amber-600'
                          }`}>
                            {c.ok ? <Wifi size={10} /> : <WifiOff size={10} />}
                            {c.ok
                              ? c.latenciaMs != null ? `OK ${c.latenciaMs} ms` : 'OK'
                              : c.configurado ? 'Falló' : 'Sin configurar'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Prueba si WLO alcanza a cada app del ecosistema y si la conexión está configurada.
                  </p>
                )}
              </div>

              {!tool.embeddable && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
                  <ShieldAlert size={14} className="shrink-0 mt-0.5 text-amber-600" />
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
                    El dominio de esta herramienta no esta en la lista del CSP de WLO. Se puede abrir en pestana aparte, pero no va a cargar dentro de este marco hasta que se agregue.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

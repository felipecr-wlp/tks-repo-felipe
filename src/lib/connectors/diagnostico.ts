import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { callConnector, type OutboundApp } from '@/lib/connectors/outbound'
import { scopesForApp, scopeDef, type ConnectorApp } from '@/lib/connectors/scopes'
import { WLO_ACTIONS, getAction } from '@/lib/connectors/actions'

/**
 * Modulo de diagnostico de conectores.
 *
 * Responde tres preguntas que antes obligaban a abrir los logs del servidor:
 *
 *  1. CONEXION: la app remota contesta? WLO llama a WLI/WLM con el token que solo
 *     vive en el entorno, y aqui se prueba con `callConnector` a la accion `ping`,
 *     sin pasar workspace ni admin para que el test sea independiente de si el
 *     complemento esta instalado. El SSRF de la casa se queda en outbound.ts; este
 *     modulo jamas hace fetch() a una URL escrita por una persona.
 *
 *  2. PERMISOS: que scopes expone cada app y en que estado. Un scope `reservado`
 *     se puede conceder (la API no lo filtra) pero no tiene accion detras, y ese
 *     es exactamente el fallo silencioso que este modulo hace visible.
 *
 *  3. DESPLIEGUE: por cada permiso, la direccion de la comunicacion (entrante si
 *     WLO la sirve, saliente si WLO la consume) y si el contrato esta implementado.
 *     Hay una asimetria que vale la pena explicar: el scope `emailer:read_sequences`
 *     esta reservado para herramientas, pero la comunicacion WLO -> WLI de listar
 *     secuencias SI esta desplegada y se usa todos los dias desde las
 *     automatizaciones. Permiso reservado no significa canal muerto.
 */

type Admin = ReturnType<typeof createAdminClient>

export interface DiagnosticoAppMeta {
  id: ConnectorApp
  name: string
  description: string
  urlEnvVar: string
  tokenEnvVar: string
  urlEsperada: string | null
}

export const APPS_DIAGNOSTICO: DiagnosticoAppMeta[] = [
  {
    id: 'wli',
    name: 'WLI Marketing OS',
    description: 'Emailer, secuencias y campanas.',
    urlEnvVar: 'WLI_CONNECTOR_URL',
    tokenEnvVar: 'WLI_CONNECTOR_TOKEN',
    urlEsperada: 'https://wli-marketing.vercel.app',
  },
  {
    id: 'wlo',
    name: 'WLO Workspace',
    description: 'Hub, flujos y automatizaciones.',
    urlEnvVar: '',
    tokenEnvVar: '',
    urlEsperada: null,
  },
  {
    id: 'wlm',
    name: 'WLM Measure',
    description: 'Estimacion y bids.',
    urlEnvVar: 'WLM_CONNECTOR_URL',
    tokenEnvVar: 'WLM_CONNECTOR_TOKEN',
    urlEsperada: null,
  },
]

export const appMeta = (id: ConnectorApp): DiagnosticoAppMeta =>
  APPS_DIAGNOSTICO.find((m) => m.id === id) ?? APPS_DIAGNOSTICO[0]

/**
 * Acciones SALIENTES conocidas (WLO llama a la app remota). Son las que estan
 * escritas en el codigo de WLO hoy; las que no estan aqui no existen todavia.
 * La accion remota se invoca en `POST <urlRemota>/api/connectors/call/<accion>`.
 */
const ACCIONES_SALIENTES: Record<
  string,
  { action: string; cuerpo: string; respuesta: string; nota: string }[]
> = {
  'emailer:read_sequences': [
    {
      action: 'emailer/list_sequences',
      cuerpo: '{ "solo_activas": true }',
      respuesta: '{ "sequences": [ { "id": "...", "name": "..." } ] }',
      nota: 'WLO la expone al navegador en GET /api/connectors/wli/sequences?workspace_id=..., para elegir secuencias en un select sin que el token salga del servidor.',
    },
  ],
  'emailer:enroll_contact': [
    {
      action: 'emailer/enroll_contact',
      cuerpo: '{ "sequence_id": "...", "email": "a@b.com", "attributes": { "origen": "automatizacion wlo" } }',
      respuesta: '{ "enrolled": true }',
      nota: 'La usa el motor de automatizaciones de WLO. Envía correo a una persona real, por eso exige que el complemento este instalado y el destinatario sea explicito.',
    },
  ],
}

/** Ejemplos de cuerpo y respuesta de las acciones ENTRANTES de WLO. */
const EJEMPLOS_ENTRANTES: Record<string, { cuerpo: string; respuesta: string; nota: string }> = {
  ping: {
    cuerpo: '{ "echo": "hola" }',
    respuesta: '{ "pong": true, "echo": "hola" }',
    nota: 'Prueba de extremo a extremo sin efectos secundarios.',
  },
  'notes/create': {
    cuerpo: '{ "workspace_id": "...", "title": "Titulo", "visibility": "workspace" }',
    respuesta: '{ "note_id": "..." }',
    nota: 'Crea una nota en el workspace.',
  },
  'workspace/read': {
    cuerpo: '{}',
    respuesta: '{ "workspace": { "id": "...", "name": "...", "slug": "..." } }',
    nota: 'Datos basicos del workspace, sin exponer miembros.',
  },
  'workspace/members': {
    cuerpo: '{}',
    respuesta: '{ "members": [ { "id": "...", "name": "...", "role": "member" } ] }',
    nota: 'Lista de personas del workspace para poblar selectores.',
  },
}

export type DireccionComunicacion = 'entrante' | 'saliente'

export interface AnalisisScope {
  scope: string
  label: string
  app: ConnectorApp
  risk: string
  estado: 'disponible' | 'reservado'
  direccion: DireccionComunicacion
  action: string | null
  desplegado: boolean
  nota: string
}

/**
 * Por cada permiso decide la direccion de la comunicacion y si hay contrato
 * implementado detras. La fuente es el codigo, no el catalogo: un scope puede
 * estar `reservado` (para herramientas) y aun asi tener su canal desplegado en
 * el sentido inverso (WLO consumiendo a WLI).
 */
export function analizarScope(scope: string): AnalisisScope | null {
  const def = scopeDef(scope)
  if (!def) return null

  if (def.app === 'wlo') {
    const acciones = Object.entries(WLO_ACTIONS)
      .filter(([, a]) => a.scope === scope)
      .map(([k]) => k)
    const desplegado = acciones.length > 0
    return {
      scope,
      label: def.label,
      app: def.app,
      risk: def.risk,
      estado: def.estado,
      direccion: 'entrante',
      action: acciones[0] ?? null,
      desplegado,
      nota: desplegado
        ? 'WLO la sirve en /api/connectors/call con una key que tenga este scope.'
        : 'No hay accion implementada en WLO_ACTIONS. Conceder el permiso hoy no da acceso a nada.',
    }
  }

  const salientes = ACCIONES_SALIENTES[scope] ?? []
  const desplegado = salientes.length > 0
  return {
    scope,
    label: def.label,
    app: def.app,
    risk: def.risk,
    estado: def.estado,
    direccion: 'saliente',
    action: salientes[0]?.action ?? null,
    desplegado,
    nota: desplegado
      ? 'WLO ya llama a la app con esta accion, pero el scope sigue reservado para herramientas del marketplace.'
      : 'Sin accion conocida en el codigo de WLO. Pendiente de implementar.',
  }
}

export interface CanalManual {
  direccion: DireccionComunicacion
  action: string
  scope: string | null
  ruta: string
  cuerpo: string
  respuesta: string
  nota: string
}

/** Manual de comunicacion de una app: que canales existen y como se llaman. */
export function manualComunicacion(app: ConnectorApp): CanalManual[] {
  if (app === 'wlo') {
    return Object.entries(WLO_ACTIONS).map(([action, def]) => {
      const ej = EJEMPLOS_ENTRANTES[action]
      return {
        direccion: 'entrante',
        action,
        scope: def.scope,
        ruta: `POST /api/connectors/call/${action}`,
        cuerpo: ej?.cuerpo ?? '{}',
        respuesta: ej?.respuesta ?? '{ "ok": true, "data": ... }',
        nota: ej?.nota ?? 'Accion entrante de WLO.',
      }
    })
  }

  const url = process.env[appMeta(app).urlEnvVar]?.trim() ?? appMeta(app).urlEsperada ?? 'https://<url-de-la-app>'
  const canales: CanalManual[] = []
  for (const [scope, acciones] of Object.entries(ACCIONES_SALIENTES)) {
    if (scopeDef(scope)?.app !== app) continue
    for (const a of acciones) {
      canales.push({
        direccion: 'saliente',
        action: a.action,
        scope,
        ruta: `POST ${url}/api/connectors/call/${a.action}`,
        cuerpo: a.cuerpo,
        respuesta: a.respuesta,
        nota: a.nota,
      })
    }
  }
  return canales
}

export interface ConexionResult {
  ok: boolean
  configurado: boolean
  url: string | null
  tokenPresente: boolean
  latenciaMs: number | null
  status: number | null
  error: string | null
  detalle: string | null
}

/**
 * Prueba de conexion a la app. WLO se prueba local (el ping del registro);
 * WLI/WLM se prueban saliendo a la red con `callConnector`, que ya resuelve el
 * DNS, aplica timeout y distingue "no configurado" (503) de "caido" (502/504).
 */
export async function probarConexion(meta: DiagnosticoAppMeta): Promise<ConexionResult> {
  if (meta.id === 'wlo') {
    const ok = Boolean(getAction('ping'))
    return {
      ok,
      configurado: true,
      url: null,
      tokenPresente: true,
      latenciaMs: null,
      status: ok ? 200 : 500,
      error: ok ? null : 'No esta registrada la accion ping en WLO_ACTIONS.',
      detalle: ok ? 'WLO es el hub local. El ping responde sin salir a la red.' : null,
    }
  }

  const url = process.env[meta.urlEnvVar]?.trim() ?? null
  const tokenPresente = Boolean(process.env[meta.tokenEnvVar])
  if (!url || !tokenPresente) {
    return {
      ok: false,
      configurado: false,
      url,
      tokenPresente,
      latenciaMs: null,
      status: null,
      error: `Falta configurar ${meta.urlEnvVar} y ${meta.tokenEnvVar} en el servidor.`,
      detalle: appMeta(meta.id).urlEsperada
        ? `La URL esperada es ${appMeta(meta.id).urlEsperada}. Se configura en Vercel > Settings > Environment Variables.`
        : 'Se configura en Vercel > Settings > Environment Variables.',
    }
  }

  const inicio = performance.now()
  const r = await callConnector({
    app: meta.id as OutboundApp,
    action: 'ping',
    payload: { echo: 'diagnostico' },
  })
  const latenciaMs = Math.round(performance.now() - inicio)

  return {
    ok: r.ok,
    configurado: true,
    url,
    tokenPresente: true,
    latenciaMs,
    status: r.status,
    error: r.error,
    detalle: r.ok
      ? 'El ping remoto respondio. El canal WLO -> app esta operativo.'
      : r.status === 404
        ? 'La app responde pero no implementa la accion ping del contrato.'
        : null,
  }
}

export interface DiagnosticoApp {
  meta: DiagnosticoAppMeta
  connection: ConexionResult
  install: {
    id: string
    app_id: string
    enabled: boolean
    granted_scopes: string[] | null
    installed_at: string | null
  } | null
  scopes: AnalisisScope[]
  manual: CanalManual[]
}

export interface DiagnosticoReporte {
  checkedAt: string
  apps: Record<ConnectorApp, DiagnosticoApp>
}

/**
 * Arma el reporte completo para un workspace. Quien llama (la ruta) ya cerro la
 * compuerta de admin; aqui solo se leen datos, no se escribe nada.
 */
export async function buildDiagnostico(admin: Admin, workspaceId: string): Promise<DiagnosticoReporte> {
  const { data: installs } = (await admin
    .from('connector_installs')
    .select('id, app_id, enabled, granted_scopes, installed_at')
    .eq('workspace_id', workspaceId)) as {
    data: {
      id: string
      app_id: string
      enabled: boolean
      granted_scopes: string[] | null
      installed_at: string | null
    }[] | null
  }

  const apps = {} as Record<ConnectorApp, DiagnosticoApp>
  for (const meta of APPS_DIAGNOSTICO) {
    apps[meta.id] = {
      meta,
      connection: await probarConexion(meta),
      install:
        (installs ?? []).find((i) => i.app_id === meta.id) ?? null,
      scopes: scopesForApp(meta.id)
        .map((s) => analizarScope(s.scope))
        .filter((s): s is AnalisisScope => s !== null),
      manual: manualComunicacion(meta.id),
    }
  }

  return { checkedAt: new Date().toISOString(), apps }
}

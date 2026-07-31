import 'server-only'

/**
 * Llamadas SALIENTES de WLO hacia otra app del ecosistema (hoy WLI).
 *
 * Hasta ahora el contrato de conectores solo existia en una direccion: WLO sabia
 * RECIBIR llamadas (/api/connectors/call/[...action] + WLO_ACTIONS), pero no
 * sabia hacerlas. Por eso una automatizacion de WLO no podia tocar el Emailer de
 * WLI aunque el scope `emailer:enroll_contact` llevaba meses en el catalogo.
 *
 * Dos decisiones que definen este archivo:
 *
 *  1. LA HABILITACION Y EL SECRETO VIVEN EN SITIOS DISTINTOS. Que un workspace
 *     pueda usar WLI se decide en `connector_installs` (fila por workspace, la
 *     prende un admin desde Configuracion). El TOKEN con el que se llama vive en
 *     variables de entorno del servidor, NUNCA en la base. Si el token viviera en
 *     el manifiesto del install, cualquier admin del workspace podria leerlo por
 *     la API del panel, y una key de conector abre el Emailer entero. Separarlos
 *     significa que prender el conector es una decision de producto y tener la
 *     llave es una decision de infraestructura.
 *
 *  2. NUNCA LANZA. Estas llamadas cuelgan de automatizaciones, que son best
 *     effort por diseño: si el Emailer esta caido, mover una tarea de columna
 *     tiene que seguir funcionando. Devuelve un resultado explicito y el que
 *     llama decide si le importa.
 */

/** Apps a las que WLO puede llamar hacia afuera. */
export type OutboundApp = 'wli' | 'wlm'

export interface OutboundResult {
  ok: boolean
  status: number
  /** Cuerpo `data` de la respuesta cuando ok, null cuando no. */
  data: unknown
  /** Mensaje legible para bitacora o para la UI. Null cuando ok. */
  error: string | null
}

interface AppConfig {
  baseUrl: string | null
  token: string | null
}

/**
 * Resuelve base y token desde el entorno. Se lee en cada llamada y no se cachea
 * en modulo: en serverless el modulo sobrevive entre invocaciones y una key
 * rotada seguiria viva en memoria hasta que el contenedor muriera.
 */
function appConfig(app: OutboundApp): AppConfig {
  if (app === 'wli') {
    return {
      baseUrl: process.env.WLI_CONNECTOR_URL?.replace(/\/+$/, '') ?? null,
      token: process.env.WLI_CONNECTOR_TOKEN ?? null,
    }
  }
  return {
    baseUrl: process.env.WLM_CONNECTOR_URL?.replace(/\/+$/, '') ?? null,
    token: process.env.WLM_CONNECTOR_TOKEN ?? null,
  }
}

/**
 * Comprueba que el workspace tenga el complemento instalado y encendido.
 * Se consulta aparte del entorno a proposito: tener la llave no autoriza a usarla
 * en cualquier workspace.
 */
export async function connectorEnabled(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  workspaceId: string,
  app: OutboundApp,
): Promise<boolean> {
  try {
    const { data } = (await admin
      .from('connector_installs')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('app_id', app)
      .eq('enabled', true)
      .maybeSingle()) as { data: { id: string } | null }
    return !!data
  } catch {
    return false
  }
}

/**
 * Invoca una accion en otra app. `action` es la ruta del contrato, por ejemplo
 * 'emailer/enroll_contact'.
 *
 * `admin` y `workspaceId` son opcionales: si vienen, se verifica el install y se
 * deja la llamada anotada en connector_call_log del lado de WLO. Sin ellos la
 * llamada se hace igual (util para un ping de diagnostico desde el panel).
 */
export async function callConnector(opts: {
  app: OutboundApp
  action: string
  payload: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin?: any
  workspaceId?: string
  /** Corta la espera. Una automatizacion no puede quedarse colgada de otra app. */
  timeoutMs?: number
}): Promise<OutboundResult> {
  const { app, action, payload, admin, workspaceId, timeoutMs = 8000 } = opts

  const registrar = (status: number, error: string | null) => {
    if (!admin) return
    void admin
      .from('connector_call_log')
      .insert({
        caller_app: 'wlo',
        action: `-> ${app}/${action}`,
        scope: null,
        status,
        key_id: null,
      })
      .then(
        () => {},
        () => {},
      )
    if (error) console.error('[connector saliente]', app, action, status, error)
  }

  if (workspaceId && admin) {
    const habilitado = await connectorEnabled(admin, workspaceId, app)
    if (!habilitado) {
      const error = `El complemento ${app.toUpperCase()} no esta instalado en este espacio de trabajo.`
      registrar(409, error)
      return { ok: false, status: 409, data: null, error }
    }
  }

  const { baseUrl, token } = appConfig(app)
  if (!baseUrl || !token) {
    // Falta configuracion del servidor, no del usuario. Se distingue con 503 para
    // que el mensaje de la UI no acuse al que configuro la automatizacion.
    const error = `Falta configurar la conexion con ${app.toUpperCase()} en el servidor.`
    registrar(503, error)
    return { ok: false, status: 503, data: null, error }
  }

  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), timeoutMs)

  try {
    const res = await fetch(`${baseUrl}/api/connectors/call/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Pavific-App': 'wlo',
      },
      body: JSON.stringify(payload ?? {}),
      signal: control.signal,
      cache: 'no-store',
    })

    const cuerpo = (await res.json().catch(() => null)) as
      | { ok?: boolean; data?: unknown; error?: string }
      | null

    if (!res.ok || cuerpo?.ok === false) {
      const error = cuerpo?.error ?? `La llamada a ${app.toUpperCase()} fallo (${res.status})`
      registrar(res.status, error)
      return { ok: false, status: res.status, data: null, error }
    }

    registrar(200, null)
    return { ok: true, status: 200, data: cuerpo?.data ?? null, error: null }
  } catch (e) {
    const abortado = e instanceof Error && e.name === 'AbortError'
    const error = abortado
      ? `${app.toUpperCase()} no respondio a tiempo.`
      : `No se pudo contactar a ${app.toUpperCase()}.`
    registrar(abortado ? 504 : 502, error)
    return { ok: false, status: abortado ? 504 : 502, data: null, error }
  } finally {
    clearTimeout(reloj)
  }
}

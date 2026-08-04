/**
 * Catalogo de scopes del ecosistema de conectores. Es la fuente de verdad de "que
 * puede exponer cada app y a que nivel". Nada se expone si no esta aqui.
 *
 * Convencion de nombre: `recurso:verbo`. El owner autoriza scopes por key desde el
 * panel de Configuracion -> Conectores. Una key solo puede ejecutar acciones cuyo
 * scope este en su arreglo de scopes.
 *
 * riesgo: guia al panel para pedir confirmacion extra en los de riesgo alto.
 */

export type ConnectorApp = 'wli' | 'wlo' | 'wlm'
export type ScopeRisk = 'bajo' | 'medio' | 'alto'

/**
 * Si HOY existe un endpoint que una herramienta pueda llamar con este scope.
 *
 *   disponible = hay una accion implementada detras. Se puede pedir y usar.
 *   reservado  = el nombre esta apartado y el permiso se concede de verdad,
 *                pero no hay nada que llamar todavia.
 *
 * Este campo existe porque el catalogo corria muy por delante de la
 * implementacion y nadie lo decia. `emailer:enroll_contact` estuvo meses aqui
 * sin una sola linea detras (ver la cabecera de `outbound.ts`). Quien construia
 * una herramienta marcaba el permiso, pasaba la revision, se instalaba con el
 * permiso concedido, llamaba a la API y recibia un error, sin forma de saber que
 * el problema no era suyo. Un catalogo que promete quince cosas y cumple una es
 * un fallo silencioso, y de los caros: se descubre despues de construir.
 *
 * Lo hace cumplir `tests/scopes-disponibles.test.ts` contra WLO_ACTIONS, asi que
 * no puede quedarse desactualizado en silencio.
 */
export type ScopeEstado = 'disponible' | 'reservado'

export interface ScopeDef {
  scope: string
  app: ConnectorApp
  label: string
  risk: ScopeRisk
  estado: ScopeEstado
}

export const SCOPE_CATALOG: ScopeDef[] = [
  // WLI (marketing OS). Ninguno esta disponible para una herramienta del
  // marketplace: WLO no los sirve, y el registro propio de WLI todavia no
  // existe (ver la cabecera de este archivo, "WLI y WLM tendran su propio
  // registro"). Lo que si funciona hoy es al reves, WLO llamando a WLI desde
  // una automatizacion, y eso no pasa por estos permisos.
  { scope: 'emailer:read_sequences', app: 'wli', label: 'Leer las secuencias del Emailer', risk: 'bajo', estado: 'reservado' },
  { scope: 'emailer:enroll_contact', app: 'wli', label: 'Enrolar contacto en secuencia', risk: 'medio', estado: 'reservado' },
  { scope: 'emailer:send_campaign',  app: 'wli', label: 'Disparar una campana',           risk: 'alto', estado: 'reservado' },
  { scope: 'leads:create',           app: 'wli', label: 'Crear LEAD en Pipedrive',         risk: 'medio', estado: 'reservado' },
  { scope: 'capi:send_event',        app: 'wli', label: 'Enviar evento a Meta CAPI',       risk: 'medio', estado: 'reservado' },
  { scope: 'jobber:read_summary',    app: 'wli', label: 'Leer resumen de Jobber',          risk: 'bajo', estado: 'reservado' },
  { scope: 'tracking:ingest',        app: 'wli', label: 'Ingestar evento de tracking',     risk: 'bajo', estado: 'reservado' },
  // WLO (workspace / hub)
  { scope: 'tasks:create',           app: 'wlo', label: 'Crear tarea',                     risk: 'bajo', estado: 'reservado' },
  { scope: 'notes:create',           app: 'wlo', label: 'Crear nota',                      risk: 'bajo', estado: 'disponible' },
  { scope: 'automation:trigger',     app: 'wlo', label: 'Disparar una automatizacion',     risk: 'medio', estado: 'reservado' },
  // Flujos. `flows:read` NUNCA alcanza un flujo privado ni uno compartido a una
  // persona: una herramienta del marketplace no es nadie del equipo, asi que no
  // hereda lo que a esa persona le compartieron. Solo ve lo que el workspace
  // entero ya podia ver. Sin esa linea, instalar una herramienta seria la puerta
  // trasera del candado de privacidad de flujos.
  { scope: 'flows:read',             app: 'wlo', label: 'Leer los flujos abiertos al workspace', risk: 'medio', estado: 'reservado' },
  // Escribir es riesgo alto y a proposito: un flujo creado por una herramienta
  // nace privado y solo puede tocar lo que ella misma creo, nunca el trabajo de
  // una persona.
  { scope: 'flows:write',            app: 'wlo', label: 'Crear y editar sus propios flujos',     risk: 'alto', estado: 'reservado' },
  // WLM (measure / estimacion). Mismo caso que WLI: su registro no existe aun.
  { scope: 'projects:create',        app: 'wlm', label: 'Crear proyecto de estimacion',    risk: 'bajo', estado: 'reservado' },
  { scope: 'bid:review',             app: 'wlm', label: 'Correr calculo de bid',           risk: 'bajo', estado: 'reservado' },
  { scope: 'bid:get',                app: 'wlm', label: 'Leer un bid',                      risk: 'bajo', estado: 'reservado' },
]

export const ALL_SCOPES: string[] = SCOPE_CATALOG.map((s) => s.scope)

/**
 * Los que una herramienta puede pedir Y usar hoy. El formulario de publicar solo
 * deja marcar estos: pedir un permiso que no tiene endpoint detras no protege de
 * nada y garantiza que alguien construya contra el vacio.
 *
 * Esto NO afloja la validacion del servidor, que sigue aceptando cualquier scope
 * conocido: las apps ya registradas con un scope reservado se quedan como estan,
 * y conceder un permiso sin accion detras no da acceso a nada.
 */
export const SCOPES_DISPONIBLES: string[] = SCOPE_CATALOG
  .filter((s) => s.estado === 'disponible')
  .map((s) => s.scope)

export function isKnownScope(scope: string): boolean {
  return ALL_SCOPES.includes(scope)
}

export function scopesForApp(app: ConnectorApp): ScopeDef[] {
  return SCOPE_CATALOG.filter((s) => s.app === app)
}

export function scopeDef(scope: string): ScopeDef | undefined {
  return SCOPE_CATALOG.find((s) => s.scope === scope)
}

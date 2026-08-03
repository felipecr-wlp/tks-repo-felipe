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

export interface ScopeDef {
  scope: string
  app: ConnectorApp
  label: string
  risk: ScopeRisk
}

export const SCOPE_CATALOG: ScopeDef[] = [
  // WLI (marketing OS)
  { scope: 'emailer:read_sequences', app: 'wli', label: 'Leer las secuencias del Emailer', risk: 'bajo' },
  { scope: 'emailer:enroll_contact', app: 'wli', label: 'Enrolar contacto en secuencia', risk: 'medio' },
  { scope: 'emailer:send_campaign',  app: 'wli', label: 'Disparar una campana',           risk: 'alto'  },
  { scope: 'leads:create',           app: 'wli', label: 'Crear LEAD en Pipedrive',         risk: 'medio' },
  { scope: 'capi:send_event',        app: 'wli', label: 'Enviar evento a Meta CAPI',       risk: 'medio' },
  { scope: 'jobber:read_summary',    app: 'wli', label: 'Leer resumen de Jobber',          risk: 'bajo'  },
  { scope: 'tracking:ingest',        app: 'wli', label: 'Ingestar evento de tracking',     risk: 'bajo'  },
  // WLO (workspace / hub)
  { scope: 'tasks:create',           app: 'wlo', label: 'Crear tarea',                     risk: 'bajo'  },
  { scope: 'notes:create',           app: 'wlo', label: 'Crear nota',                      risk: 'bajo'  },
  { scope: 'automation:trigger',     app: 'wlo', label: 'Disparar una automatizacion',     risk: 'medio' },
  // Flujos. `flows:read` NUNCA alcanza un flujo privado ni uno compartido a una
  // persona: una herramienta del marketplace no es nadie del equipo, asi que no
  // hereda lo que a esa persona le compartieron. Solo ve lo que el workspace
  // entero ya podia ver. Sin esa linea, instalar una herramienta seria la puerta
  // trasera del candado de privacidad de flujos.
  { scope: 'flows:read',             app: 'wlo', label: 'Leer los flujos abiertos al workspace', risk: 'medio' },
  // Escribir es riesgo alto y a proposito: un flujo creado por una herramienta
  // nace privado y solo puede tocar lo que ella misma creo, nunca el trabajo de
  // una persona.
  { scope: 'flows:write',            app: 'wlo', label: 'Crear y editar sus propios flujos',     risk: 'alto'  },
  // WLM (measure / estimacion)
  { scope: 'projects:create',        app: 'wlm', label: 'Crear proyecto de estimacion',    risk: 'bajo'  },
  { scope: 'bid:review',             app: 'wlm', label: 'Correr calculo de bid',           risk: 'bajo'  },
  { scope: 'bid:get',                app: 'wlm', label: 'Leer un bid',                      risk: 'bajo'  },
]

export const ALL_SCOPES: string[] = SCOPE_CATALOG.map((s) => s.scope)

export function isKnownScope(scope: string): boolean {
  return ALL_SCOPES.includes(scope)
}

export function scopesForApp(app: ConnectorApp): ScopeDef[] {
  return SCOPE_CATALOG.filter((s) => s.app === app)
}

export function scopeDef(scope: string): ScopeDef | undefined {
  return SCOPE_CATALOG.find((s) => s.scope === scope)
}

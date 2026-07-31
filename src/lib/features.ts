/**
 * Catalogo unico de funciones (pantallas) del workspace.
 *
 * Una sola fuente de verdad para tres cosas que antes vivian sueltas:
 *   1. Que se dibuja en la barra lateral y en que orden.
 *   2. Que puede esconderse por persona (panel de admin) .
 *   3. Que ruta hay que bloquear cuando alguien no tiene la funcion.
 *
 * Decisiones que no son cosmeticas:
 * - Se guarda una LISTA DE OCULTAS (deny-list), no de permitidas. Asi una
 *   pantalla nueva le aparece a todos sin tener que registrarla persona por
 *   persona, y nadie queda encerrado por un olvido.
 * - `locked` marca lo que no se puede apagar (Inicio). Sin punto de entrada la
 *   sesion queda en un callejon sin salida.
 * - `primary` decide que se ve de entrada en la barra. Lo demas vive detras de
 *   "Ver mas": la lista larga confundia y casi nadie usaba la mitad.
 * - `segment` es lo que hace REAL el bloqueo: la ruta se compara contra el, no
 *   basta con esconder el boton (cualquiera pega la URL).
 */

export type FeatureKey =
  | 'inbox'
  | 'my-tasks'
  | 'home'
  | 'general'
  | 'guia'
  | 'academia'
  | 'calendar'
  | 'reportes'
  | 'notes'
  | 'whiteboards'
  | 'flows'
  | 'goals'
  | 'analytics'
  | 'tracking'
  | 'projects'
  | 'cv'

export type FeatureGroup = 'principal' | 'workspace'

export interface FeatureDef {
  key: FeatureKey
  /** Segmento bajo /w/{slug}. Cadena vacia = la raiz del workspace. */
  segment: string
  /** Clave del diccionario i18n para el nombre visible. */
  labelKey: string
  /** Texto de apoyo para el panel de admin (solo español, es interno). */
  description: string
  group: FeatureGroup
  /** Se muestra siempre en la barra. El resto va al bloque "Ver mas". */
  primary?: boolean
  /** No se puede desactivar. */
  locked?: boolean
}

export const FEATURES: FeatureDef[] = [
  {
    key: 'inbox',
    segment: 'inbox',
    labelKey: 'nav.inbox',
    description: 'Notificaciones y menciones dirigidas a la persona.',
    group: 'principal',
    primary: true,
  },
  {
    key: 'my-tasks',
    segment: 'my-tasks',
    labelKey: 'nav.myTasks',
    description: 'Vista personal con todas sus tareas asignadas.',
    group: 'principal',
    primary: true,
  },
  {
    key: 'home',
    segment: '',
    labelKey: 'nav.home',
    description: 'Portada del workspace. No se puede desactivar.',
    group: 'workspace',
    primary: true,
    locked: true,
  },
  {
    key: 'general',
    segment: 'general',
    labelKey: 'nav.general',
    description: 'Chat abierto a todos los equipos del workspace.',
    group: 'workspace',
    primary: true,
  },
  {
    key: 'reportes',
    segment: 'reportes',
    labelKey: 'nav.dailyReports',
    description: 'Reporte diario de actividades de cada persona.',
    group: 'workspace',
    primary: true,
  },
  {
    key: 'notes',
    segment: 'notes',
    labelKey: 'nav.notes',
    description: 'Documentos, procedimientos y notas por departamento.',
    group: 'workspace',
    primary: true,
  },
  {
    key: 'calendar',
    segment: 'calendar',
    labelKey: 'nav.calendar',
    description: 'Calendario de tareas y vencimientos del workspace.',
    group: 'workspace',
    primary: true,
  },
  {
    key: 'whiteboards',
    segment: 'whiteboards',
    labelKey: 'nav.whiteboards',
    description: 'Pizarras para diagramar y planear en conjunto.',
    group: 'workspace',
  },
  {
    key: 'flows',
    segment: 'flows',
    labelKey: 'nav.flows',
    description: 'Diagramas de flujo y automatizaciones del proceso de trabajo.',
    group: 'workspace',
    // Es un modulo nuevo: si arranca detras de "Ver mas" nadie lo encuentra.
    // Cuando deje de ser novedad se puede bajar al bloque secundario.
    primary: true,
  },
  {
    key: 'guia',
    segment: 'guia',
    labelKey: 'nav.guide',
    description: 'Guia de uso de la plataforma para gente nueva.',
    group: 'workspace',
  },
  {
    key: 'academia',
    segment: 'academia',
    labelKey: 'nav.academy',
    description: 'Capacitaciones y material de formacion interno.',
    group: 'workspace',
  },
  {
    key: 'goals',
    segment: 'goals',
    labelKey: 'nav.goals',
    description: 'Metas y objetivos con su avance.',
    group: 'workspace',
  },
  {
    key: 'analytics',
    segment: 'analytics',
    labelKey: 'nav.analytics',
    description: 'Reportes de productividad y carga de trabajo.',
    group: 'workspace',
  },
  {
    key: 'tracking',
    segment: 'tracking',
    labelKey: 'nav.tracking',
    description: 'Registro de tiempo dedicado a cada tarea.',
    group: 'workspace',
  },
  {
    key: 'projects',
    segment: 'projects',
    labelKey: 'nav.opportunities',
    description: 'Bolsa interna de oportunidades y proyectos abiertos.',
    group: 'workspace',
  },
  {
    key: 'cv',
    segment: 'cv',
    labelKey: 'nav.myCv',
    description: 'Perfil profesional interno de cada persona.',
    group: 'workspace',
  },
]

/** Indice por clave, para no recorrer el arreglo en cada consulta. */
const BY_KEY = new Map<string, FeatureDef>(FEATURES.map((f) => [f.key, f]))

export function getFeature(key: string): FeatureDef | undefined {
  return BY_KEY.get(key)
}

/** Solo lo que un admin puede apagar (todo menos lo bloqueado). */
export const TOGGLEABLE_FEATURES = FEATURES.filter((f) => !f.locked)

/**
 * Limpia lo que venga de la base: claves desconocidas (de una funcion que ya no
 * existe) y bloqueadas se descartan, para que un residuo no apague nada.
 */
export function normalizeHidden(raw: unknown): FeatureKey[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<FeatureKey>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const def = BY_KEY.get(item)
    if (def && !def.locked) out.add(def.key)
  }
  return [...out]
}

/**
 * Que funcion corresponde a una ruta ya dentro del workspace.
 * `pathname` es la ruta completa (ej. /w/wlo/notes/abc) y `base` el prefijo
 * (/w/wlo). Devuelve undefined si la ruta no pertenece a ninguna funcion del
 * catalogo (equipos, ajustes, etc.), que se gobiernan por su propio permiso.
 */
export function featureForPath(pathname: string, base: string): FeatureDef | undefined {
  if (!pathname.startsWith(base)) return undefined
  const rest = pathname.slice(base.length).replace(/^\/+/, '')
  if (rest === '') return BY_KEY.get('home')
  const first = rest.split('/')[0]
  // La raiz solo hace match exacto; si no, se tragaria todas las subrutas.
  const def = FEATURES.find((f) => f.segment !== '' && f.segment === first)
  return def
}

/** ¿La persona puede entrar a esta ruta? */
export function canAccessPath(pathname: string, base: string, hidden: string[]): boolean {
  if (hidden.length === 0) return true
  const def = featureForPath(pathname, base)
  if (!def || def.locked) return true
  return !hidden.includes(def.key)
}

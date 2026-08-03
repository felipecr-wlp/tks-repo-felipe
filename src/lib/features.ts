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
 *
 * ── Herramientas instalables (marketplace) ──────────────────────────────────
 * Hay funciones que no le sirven a todos los workspaces y que por lo tanto no
 * deben aparecerle a todos. Esas llevan `installable: true` y se gobiernan al
 * reves que el resto:
 *
 *   hidden_features (workspace_members)  deny-list POR PERSONA. Lo normal: una
 *       pantalla nueva le aparece a todos y el admin la esconde a quien no la usa.
 *   installed_features (workspaces)      allow-list POR WORKSPACE. Una
 *       herramienta instalable NO existe hasta que alguien la instala.
 *
 * Las dos listas se juntan en `effectiveHidden()`, que devuelve una sola
 * deny-list. Asi la barra lateral, la paleta de comandos y el bloqueo de ruta
 * siguen recibiendo exactamente lo mismo que antes y no se enteran de que existe
 * un marketplace: una regla nueva, cero pantallas tocadas.
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
  | 'contenidos'
  | 'marketplace'

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
  /**
   * Herramienta del marketplace: no existe para el workspace hasta que alguien
   * la instala. Una funcion instalable NUNCA puede estar `locked`: seria una
   * pantalla obligatoria que no esta instalada.
   */
  installable?: boolean
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
    installable: true,
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
    installable: true,
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
    installable: true,
  },
  {
    key: 'goals',
    segment: 'goals',
    labelKey: 'nav.goals',
    description: 'Metas y objetivos con su avance.',
    group: 'workspace',
    installable: true,
  },
  {
    key: 'analytics',
    segment: 'analytics',
    labelKey: 'nav.analytics',
    description: 'Reportes de productividad y carga de trabajo.',
    group: 'workspace',
    installable: true,
  },
  {
    key: 'tracking',
    segment: 'tracking',
    labelKey: 'nav.tracking',
    description: 'Registro de tiempo dedicado a cada tarea.',
    group: 'workspace',
    installable: true,
  },
  {
    key: 'projects',
    segment: 'projects',
    labelKey: 'nav.opportunities',
    description: 'Bolsa interna de oportunidades y proyectos abiertos.',
    group: 'workspace',
    installable: true,
  },
  {
    key: 'cv',
    segment: 'cv',
    labelKey: 'nav.myCv',
    description: 'Perfil profesional interno de cada persona.',
    group: 'workspace',
    installable: true,
  },
  {
    key: 'contenidos',
    segment: 'contenidos',
    labelKey: 'nav.contentPlanner',
    description:
      'Galeria de contenido por publicar: aprobar, calificar y pedir correcciones. Se instala desde el marketplace.',
    group: 'workspace',
    // Instalable: solo aparece en los workspaces que hacen contenido. Si esta
    // instalada se muestra de entrada, porque una herramienta que se instalo a
    // proposito y queda escondida detras de "Ver mas" no la encuentra nadie.
    primary: true,
    installable: true,
  },
  {
    key: 'marketplace',
    segment: 'marketplace',
    labelKey: 'nav.marketplace',
    description:
      'Catalogo de herramientas del workspace: que pantallas estan instaladas y cuales se pueden agregar.',
    group: 'workspace',
    // NO instalable, a proposito, y la razon vale la pena: una herramienta
    // instalable arranca apagada. Si el marketplace fuera instalable, un
    // workspace nuevo no tendria por donde instalar nada. La puerta no puede
    // estar del lado de adentro.
    //
    // Tampoco `primary`: vive en "Ver mas". No es una pantalla de trabajo
    // diario, se entra cuando falta algo.
    //
    // Es la MISMA vista que Configuracion > Herramientas, servida sin el gate de
    // admin. Instalar y desinstalar siguen exigiendo admin en la ruta; lo que
    // esto abre es el catalogo, para que el equipo pueda ver que existe y pedirlo
    // en vez de no enterarse.
  },
]

/** Indice por clave, para no recorrer el arreglo en cada consulta. */
const BY_KEY = new Map<string, FeatureDef>(FEATURES.map((f) => [f.key, f]))

export function getFeature(key: string): FeatureDef | undefined {
  return BY_KEY.get(key)
}

/** Solo lo que un admin puede apagar (todo menos lo bloqueado). */
export const TOGGLEABLE_FEATURES = FEATURES.filter((f) => !f.locked)

/** Lo que se puede instalar y desinstalar por workspace (el marketplace). */
export const INSTALLABLE_FEATURES = FEATURES.filter((f) => f.installable && !f.locked)

const INSTALLABLE_KEYS = new Set<string>(INSTALLABLE_FEATURES.map((f) => f.key))

export function isInstallable(key: string): boolean {
  return INSTALLABLE_KEYS.has(key)
}

/**
 * Limpia lo que venga de `workspaces.installed_features`: se descarta lo que no
 * sea una herramienta instalable del catalogo actual. Asi el residuo de una
 * herramienta retirada no revive una pantalla que ya no existe.
 */
export function normalizeInstalled(raw: unknown): FeatureKey[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<FeatureKey>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const def = BY_KEY.get(item)
    if (def && def.installable && !def.locked) out.add(def.key)
  }
  return [...out]
}

/**
 * Une las dos reglas en una sola deny-list: lo que el admin le escondio a esta
 * persona MAS toda herramienta instalable que este workspace no instalo.
 *
 * Es lo unico que hay que llamar al montar el workspace. El resultado se le pasa
 * tal cual a la barra, a la paleta y a `canAccessPath`, que siguen viendo una
 * lista de ocultas y nada mas.
 *
 * Por defecto NO instalado: si `installed` viene vacio (workspace que nunca
 * abrio el marketplace) la herramienta queda escondida. Es deliberado, y es el
 * unico caso donde el default es esconder: una herramienta instalable que
 * apareciera sola dejaria de ser instalable.
 */
export function effectiveHidden(hidden: string[], installed: string[]): FeatureKey[] {
  const out = new Set<FeatureKey>(normalizeHidden(hidden))
  const puestas = new Set(normalizeInstalled(installed))
  for (const f of INSTALLABLE_FEATURES) {
    if (!puestas.has(f.key)) out.add(f.key)
  }
  return [...out]
}

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

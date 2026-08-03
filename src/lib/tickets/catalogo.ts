/**
 * Catalogo de las solicitudes: tipos, urgencias y como se ve cada estado.
 *
 * Vive en codigo y no en la base, igual que el catalogo de redes sociales del
 * planificador de contenido. Agregar un tipo de solicitud no deberia exigir una
 * migracion, y una clave vieja que sobre en una fila antigua se ignora al leer
 * (`tipoDeSolicitud()` cae a 'otro' en vez de romper la pantalla).
 */
import type { EstadoSolicitud } from './flujo-solicitud'

export interface TipoSolicitud {
  key: string
  label: string
  /** Nombre de icono lucide. */
  icon: string
  /** Que ejemplos poner en el formulario, para que la gente sepa que cabe aqui. */
  ejemplo: string
}

/**
 * Los tipos salieron de lo que la gente ya pide por chat, no de una taxonomia
 * inventada. Si un tipo nunca se usa, sobra; si todo cae en 'otro', falta uno.
 */
export const TIPOS_SOLICITUD: TipoSolicitud[] = [
  {
    key: 'software',
    label: 'Mejora de software',
    icon: 'Wrench',
    ejemplo: 'Algo del sistema funciona mal o podría funcionar mejor',
  },
  {
    key: 'desarrollo',
    label: 'Desarrollo nuevo',
    icon: 'Code2',
    ejemplo: 'Una función, pantalla o automatización que hoy no existe',
  },
  {
    key: 'compra',
    label: 'Compra o licencia',
    icon: 'ShoppingCart',
    ejemplo: 'Herramienta, suscripción, equipo o material',
  },
  {
    key: 'acceso',
    label: 'Acceso o permiso',
    icon: 'KeyRound',
    ejemplo: 'Entrar a un sistema, una carpeta o una cuenta',
  },
  {
    key: 'diseno',
    label: 'Diseño o contenido',
    icon: 'PenTool',
    ejemplo: 'Piezas gráficas, copy, video, material de campaña',
  },
  {
    key: 'proceso',
    label: 'Proceso o documento',
    icon: 'FileText',
    ejemplo: 'Un SOP, una política, un formato que hace falta',
  },
  {
    key: 'soporte',
    label: 'Soporte',
    icon: 'LifeBuoy',
    ejemplo: 'Algo se rompió y hace falta ayuda para hoy',
  },
  {
    key: 'otro',
    label: 'Otro',
    icon: 'CircleHelp',
    ejemplo: 'Lo que no cabe arriba. Explícalo en la descripción',
  },
]

const TIPOS_POR_KEY = new Map(TIPOS_SOLICITUD.map((t) => [t.key, t]))

export function tipoDeSolicitud(key: string | null | undefined): TipoSolicitud {
  return (key ? TIPOS_POR_KEY.get(key) : undefined) ?? TIPOS_POR_KEY.get('otro')!
}

export function esTipoValido(key: string): boolean {
  return TIPOS_POR_KEY.has(key)
}

// ── Urgencia ─────────────────────────────────────────────────────────────────
// Cuatro niveles y no cinco: con cinco, el de en medio se vuelve el basurero de
// quien no quiere decidir. Aqui 'normal' es el default explicito y 'urgente'
// pide una fecha, para que urgente signifique algo.

export type Prioridad = 'baja' | 'normal' | 'alta' | 'urgente'

export const PRIORIDADES: { key: Prioridad; label: string; clase: string }[] = [
  { key: 'baja',    label: 'Baja',    clase: 'text-muted-foreground' },
  { key: 'normal',  label: 'Normal',  clase: 'text-foreground' },
  { key: 'alta',    label: 'Alta',    clase: 'text-amber-600 dark:text-amber-400' },
  { key: 'urgente', label: 'Urgente', clase: 'text-red-600 dark:text-red-400' },
]

const PRIORIDADES_VALIDAS = new Set(PRIORIDADES.map((p) => p.key))

export function esPrioridadValida(v: string): v is Prioridad {
  return PRIORIDADES_VALIDAS.has(v as Prioridad)
}

/** Para ordenar el tablero: primero lo urgente. */
export const PESO_PRIORIDAD: Record<Prioridad, number> = {
  urgente: 0,
  alta: 1,
  normal: 2,
  baja: 3,
}

// ── Estados ──────────────────────────────────────────────────────────────────
// El texto de `explica` no es decoracion: es la unica forma de que quien abre la
// pantalla por primera vez entienda que se espera de el sin que nadie se lo
// cuente.

export interface EstadoInfo {
  key: EstadoSolicitud
  label: string
  explica: string
  /** Clases del chip. */
  clase: string
  /** Si aparece como columna del tablero abierto. */
  columna: boolean
}

export const ESTADOS: EstadoInfo[] = [
  {
    key: 'solicitado',
    label: 'Solicitado',
    explica: 'Esperando que alguien con mando decida si se canaliza.',
    clase: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    columna: true,
  },
  {
    key: 'canalizado',
    label: 'Canalizado',
    explica: 'Aceptado y con responsable. Todavía no arranca.',
    clase: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
    columna: true,
  },
  {
    key: 'en_proceso',
    label: 'En proceso',
    explica: 'Alguien está trabajando en esto ahora.',
    clase: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    columna: true,
  },
  {
    key: 'resuelto',
    label: 'Resuelto',
    explica: 'Terminado, con nota de qué se hizo.',
    clase: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    columna: true,
  },
  {
    key: 'rechazado',
    label: 'Rechazado',
    explica: 'No procede, con el motivo escrito.',
    clase: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    columna: false,
  },
  {
    key: 'cancelado',
    label: 'Cancelado',
    explica: 'Quien la pidió se retractó.',
    clase: 'bg-muted text-muted-foreground border-border',
    columna: false,
  },
]

const ESTADOS_POR_KEY = new Map(ESTADOS.map((e) => [e.key, e]))

export function estadoInfo(key: EstadoSolicitud): EstadoInfo {
  return ESTADOS_POR_KEY.get(key) ?? ESTADOS[0]
}

export function esEstadoValido(v: string): v is EstadoSolicitud {
  return ESTADOS_POR_KEY.has(v as EstadoSolicitud)
}

/** Columnas del tablero, en orden de avance. */
export const COLUMNAS = ESTADOS.filter((e) => e.columna)

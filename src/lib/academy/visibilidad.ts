/**
 * Quien ve que en la Academia. Logica pura, sin red: la decision de "puede o
 * no puede ver esto" se prueba de verdad, no se confia a un if repartido por
 * cuatro pantallas.
 *
 * TRES MODOS, y la columna `audience` los distingue:
 *
 *   'todos'    -> cualquiera del workspace.
 *   'perfiles' -> quien tenga alguna de las etiquetas listadas (foreman,
 *                 concreto, asfalto...). Es lo que se usa el 90% del tiempo:
 *                 "esto es para las cuadrillas de concreto".
 *   'personas' -> solo los nombrados uno por uno.
 *
 * POR QUE `audience` Y NO SOLO LA LISTA. Con solo la lista, "es para todos" y
 * "todavia no le he dado acceso a nadie" se ven identicos (cero filas), y un
 * video recien subido quedaria invisible sin que nadie entienda por que. La
 * columna dice la INTENCION; la lista solo dice a quien.
 *
 * EL ADMIN SIEMPRE VE TODO. No es un privilegio, es una necesidad operativa:
 * quien gobierna la academia tiene que poder revisar lo que publica antes de
 * que lo vea nadie, y arreglar lo que este roto.
 */

export type Audiencia = 'todos' | 'perfiles' | 'personas'

export interface ConAudiencia {
  audience: Audiencia
  audience_profiles: string[]
  status: 'draft' | 'live'
}

export interface Espectador {
  /** Etiquetas de perfil de la persona (foreman, concreto...). */
  perfiles: readonly string[]
  /** Ids de video a los que fue nombrada explicitamente. */
  nombradaEn: ReadonlySet<string>
  esAdmin: boolean
}

/** Normaliza para comparar: sin acentos, sin espacios sobrantes, minusculas. */
export function claveDePerfil(x: string): string {
  return x
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * ¿Esta persona puede ver este contenido?
 *
 * @param id  id del contenido, para el modo 'personas'
 */
export function puedeVer(
  contenido: ConAudiencia,
  id: string,
  quien: Espectador,
): boolean {
  // El admin ve todo, incluidos los borradores: si no, no podria revisar antes
  // de publicar.
  if (quien.esAdmin) return true

  // Un borrador no existe para quien no lo gobierna, sin importar la audiencia.
  if (contenido.status !== 'live') return false

  switch (contenido.audience) {
    case 'todos':
      return true
    case 'personas':
      return quien.nombradaEn.has(id)
    case 'perfiles': {
      // Lista vacia = nadie. Es deliberado y es lo contrario del default de la
      // tabla: si alguien ELIGE "por perfiles" y no marca ninguno, no ha
      // terminado de configurarlo, y ante la duda no se enseña. La alternativa
      // (lista vacia = todos) convertiria un descuido en una fuga.
      if (contenido.audience_profiles.length === 0) return false
      const mios = new Set(quien.perfiles.map(claveDePerfil))
      return contenido.audience_profiles.some((p) => mios.has(claveDePerfil(p)))
    }
    default:
      // Valor desconocido (una migracion futura, un dato corrupto): se niega.
      // Fallar cerrado, nunca abierto.
      return false
  }
}

/** Filtra una lista dejando solo lo que esta persona puede ver. */
export function filtrarVisibles<T extends ConAudiencia & { id: string }>(
  items: readonly T[],
  quien: Espectador,
): T[] {
  return items.filter((x) => puedeVer(x, x.id, quien))
}

/** Texto corto para la UI del panel: "Todos", "3 perfiles", "5 personas". */
export function describirAudiencia(
  contenido: ConAudiencia,
  nNombradas: number,
): string {
  if (contenido.audience === 'todos') return 'Todos'
  if (contenido.audience === 'perfiles') {
    const n = contenido.audience_profiles.length
    return n === 0 ? 'Perfiles (ninguno: nadie lo ve)' : `${n} perfil${n === 1 ? '' : 'es'}`
  }
  return nNombradas === 0
    ? 'Personas (ninguna: nadie lo ve)'
    : `${nNombradas} persona${nNombradas === 1 ? '' : 's'}`
}

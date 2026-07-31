/**
 * Deteccion de actividades DUPLICADAS dentro de un reporte diario.
 *
 * ── El problema real ────────────────────────────────────────────────────────
 * El reporte se llena por tres puertas: la persona escribe a mano, le cuenta a
 * BITACORA, y BITACORA propone lo que ya cerro en el tablero. Nada de eso se
 * hablaba entre si, asi que el mismo trabajo terminaba anotado dos y tres veces
 * con palabras distintas:
 *
 *   "Cerre la campaña de julio de Google Ads"
 *   "Termine de cerrar la campaña de Google Ads de julio"
 *
 * Para una base de datos son dos filas distintas. Para quien lee el reporte es
 * la misma cosa contada dos veces, y para un supervisor que suma minutos es
 * trabajo inflado. Ese es el costo que este archivo corta.
 *
 * ── Por que se compara en TypeScript y no en Postgres ──────────────────────
 * Postgres trae `pg_trgm` y resolveria la similitud en el indice. Se descarto:
 *
 *   1. Un dia de una persona tiene 5 a 20 actividades. Comparar 20 cadenas en
 *      memoria es microsegundos; no justifica una extension ni un indice.
 *   2. `pg_trgm` compara caracteres crudos. Aqui hace falta quitar acentos,
 *      muletillas ("ya", "por fin") y conjugaciones, o "cerre" y "termine de
 *      cerrar" nunca se parecen lo suficiente. Esa normalizacion en SQL seria
 *      una funcion inmutable propia, mas dificil de leer y de cambiar.
 *   3. Esto tiene que correr TAMBIEN antes de insertar, sobre texto que aun no
 *      esta en la base.
 *
 * ── Por que dos medidas y no una ───────────────────────────────────────────
 * Jaccard de palabras entiende el reordenamiento ("campaña de julio de Google
 * Ads" vs "campaña de Google Ads de julio") pero se cae con las variaciones de
 * una misma raiz. Dice de bigramas de caracteres si atrapa "cerre" contra
 * "cerrar", pero premia de mas a dos frases largas cualquiera por compartir
 * terminaciones. Juntas se cubren el hueco de la otra.
 */

/** Muletillas y conectores que no distinguen una actividad de otra. */
const VACIAS = new Set([
  'a', 'al', 'ante', 'con', 'contra', 'de', 'del', 'desde', 'e', 'el', 'en', 'entre',
  'hacia', 'hasta', 'la', 'las', 'lo', 'los', 'mas', 'me', 'mi', 'mis', 'para', 'pero',
  'por', 'que', 'se', 'segun', 'sin', 'sobre', 'su', 'sus', 'tras', 'un', 'una', 'unos',
  'unas', 'y', 'o', 'u', 'ya', 'fin', 'todo', 'toda', 'todos', 'todas', 'muy', 'tambien',
  'le', 'les', 'este', 'esta', 'esto', 'ese', 'esa', 'eso', 'hoy', 'dia', 'ahora',
  'ademas', 'luego', 'despues', 'antes', 'donde', 'cuando', 'como', 'porque',
])

/**
 * Verbos que en la practica significan lo mismo al reportar. Se colapsan a una
 * raiz comun para que "termine de cerrar" y "cerre" no cuenten como dos cosas.
 * No es un lematizador: es una lista corta de lo que de verdad aparece en un
 * reporte de trabajo, que se puede leer y corregir de un vistazo.
 */
const SINONIMOS: Record<string, string> = {
  termin: 'cerr', finaliz: 'cerr', complet: 'cerr', acab: 'cerr', concluy: 'cerr',
  cerr: 'cerr', clausur: 'cerr',
  empez: 'inici', comenz: 'inici', arranc: 'inici', inici: 'inici',
  avanz: 'avanz', continu: 'avanz', segui: 'avanz', progres: 'avanz',
  revis: 'revis', valid: 'revis', verific: 'revis', chec: 'revis', audit: 'revis',
  arregl: 'corrig', corrig: 'corrig', repar: 'corrig', soluciona: 'corrig', resolv: 'corrig',
  cre: 'cre', arm: 'cre', constru: 'cre', hic: 'cre', hac: 'cre', elabor: 'cre',
  envi: 'envi', mand: 'envi', remit: 'envi',
  junt: 'reunion', reuni: 'reunion', llamad: 'reunion', call: 'reunion',
  actualiz: 'actualiz', modific: 'actualiz', ajust: 'actualiz', cambi: 'actualiz',
  // `publiq` va aparte de `public` porque el corte a 6 letras parte "publique"
  // en "publiq", que nunca empezaria por "public".
  public: 'public', publiq: 'public', lanz: 'public', deploy: 'public', subi: 'public',
}

/**
 * Quita acentos y deja solo letras, numeros y espacios.
 *
 * La ñ se protege con un centinela ANTES de descomponer. Sin eso, "campaña"
 * quedaria como "campana", que es otra palabra: el reporte de una campaña de
 * marketing y el de una campana de iglesia se verian iguales para el
 * comparador. Se usa un centinela en vez de una clase de caracteres que excluya
 * la tilde combinante porque escribir marcas combinantes sueltas en el codigo
 * fuente es fragil: cualquier editor que renormalice el archivo las mueve de
 * lugar y la expresion deja de hacer lo que dice.
 */
const CENTINELA_ENYE = String.fromCharCode(1)

function limpiar(texto: string): string {
  return texto
    .toLowerCase()
    // El centinela se construye con fromCharCode y se aplica con split/join en
    // vez de con una expresion regular, para que el fuente no lleve un caracter
    // de control escrito literalmente: es invisible al revisar el codigo y
    // cualquier herramienta que toque el archivo se lo puede comer.
    .split('ñ')
    .join(CENTINELA_ENYE)
    .normalize('NFD')
    // p{M} = toda marca combinante, o sea los acentos ya separados de su letra.
    .replace(/\p{M}/gu, '')
    .split(CENTINELA_ENYE)
    .join('ñ')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Recorta la terminacion flexiva. Deliberadamente burdo: se queda con la raiz de
 * hasta 6 letras, que para el español basta para juntar "cerre / cerraron /
 * cerrando" sin necesitar un stemmer completo como dependencia.
 */
function raiz(palabra: string): string {
  const base = palabra.length > 6 ? palabra.slice(0, 6) : palabra
  for (const [prefijo, canon] of Object.entries(SINONIMOS)) {
    if (base.startsWith(prefijo)) return canon
  }
  return base
}

/** Tokens significativos de una actividad, ya normalizados. */
export function tokenizar(texto: string): Set<string> {
  const out = new Set<string>()
  for (const palabra of limpiar(texto).split(' ')) {
    if (palabra.length < 2) continue
    if (VACIAS.has(palabra)) continue
    out.add(raiz(palabra))
  }
  return out
}

/** Interseccion sobre union. Mide cuanto se solapa el VOCABULARIO. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let comunes = 0
  for (const t of a) if (b.has(t)) comunes++
  return comunes / (a.size + b.size - comunes)
}

/** Bigramas de caracteres del texto normalizado. Atrapa variantes de una raiz. */
function bigramas(texto: string): Set<string> {
  const limpio = limpiar(texto).replace(/ /g, '')
  const out = new Set<string>()
  for (let i = 0; i < limpio.length - 1; i++) out.add(limpio.slice(i, i + 2))
  return out
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let comunes = 0
  for (const g of a) if (b.has(g)) comunes++
  return (2 * comunes) / (a.size + b.size)
}

/**
 * Que tan parecidas son dos actividades, de 0 a 1.
 *
 * El peso 60/40 favorece a Jaccard porque el falso positivo caro es marcar como
 * duplicado dos trabajos DISTINTOS sobre el mismo tema ("revise la campaña de
 * Google" vs "revise la campaña de Meta"): ahi los bigramas se parecen mucho y
 * el vocabulario no, y quien tiene razon es el vocabulario.
 */
export function similitud(a: string, b: string): number {
  const porPalabras = jaccard(tokenizar(a), tokenizar(b))
  const porLetras = dice(bigramas(a), bigramas(b))
  return 0.6 * porPalabras + 0.4 * porLetras
}

/**
 * Umbral de DUPLICADO. Calibrado a mano contra reportes reales: por debajo de
 * 0.62 empiezan a colarse pares que solo comparten el tema, y por encima de 0.75
 * se escapan los reformulados de verdad.
 *
 * Este numero nunca borra nada por si solo. Solo decide si se le avisa a la
 * persona; la ultima palabra siempre es suya.
 */
export const UMBRAL_DUPLICADO = 0.68

/** Por debajo del duplicado pero digno de mencionar al revisar el dia completo. */
export const UMBRAL_PARECIDO = 0.5

export interface EntradaComparable {
  id: string
  content: string
  category: string
  task_id?: string | null
  minutes?: number | null
}

export interface Coincidencia {
  entry: EntradaComparable
  score: number
  /** Por que se marco. Sirve para explicarselo a la persona en vez de solo afirmarlo. */
  motivo: 'misma_tarea' | 'texto_casi_igual' | 'texto_parecido'
}

/**
 * Busca en `existentes` algo que ya diga lo mismo que `texto`.
 *
 * Devuelve la MEJOR coincidencia, no todas: al momento de registrar, la persona
 * necesita una pregunta concreta ("¿es lo mismo que esto?"), no una lista.
 */
export function buscarDuplicado(
  texto: string,
  existentes: EntradaComparable[],
  taskId?: string | null,
): Coincidencia | null {
  let mejor: Coincidencia | null = null

  for (const entry of existentes) {
    // Misma tarea del tablero es la señal mas fuerte que hay: no depende de como
    // se redacto. Aun asi se exige un minimo de parecido en el texto, porque una
    // tarea grande si puede tener dos avances distintos en el mismo dia
    // ("arme el brief" y "presente el brief al equipo").
    const score = similitud(texto, entry.content)
    if (taskId && entry.task_id && entry.task_id === taskId && score >= UMBRAL_PARECIDO) {
      const cand: Coincidencia = { entry, score: Math.max(score, UMBRAL_DUPLICADO), motivo: 'misma_tarea' }
      if (!mejor || cand.score > mejor.score) mejor = cand
      continue
    }

    if (score >= UMBRAL_DUPLICADO) {
      const cand: Coincidencia = { entry, score, motivo: 'texto_casi_igual' }
      if (!mejor || cand.score > mejor.score) mejor = cand
    }
  }

  return mejor
}

export interface ParDuplicado {
  a: EntradaComparable
  b: EntradaComparable
  score: number
  motivo: Coincidencia['motivo']
}

/**
 * Revisa un conjunto de actividades y devuelve los pares sospechosos, del mas
 * parecido al menos.
 *
 * Es O(n^2), y esta bien: un dia son 20 actividades como mucho y una semana de
 * una persona rara vez pasa de 100. Un indice invertido aqui seria complejidad
 * sin beneficio medible.
 */
export function revisarDuplicados(entradas: EntradaComparable[]): ParDuplicado[] {
  const pares: ParDuplicado[] = []

  for (let i = 0; i < entradas.length; i++) {
    for (let j = i + 1; j < entradas.length; j++) {
      const a = entradas[i]
      const b = entradas[j]
      const score = similitud(a.content, b.content)

      const mismaTarea = !!a.task_id && a.task_id === b.task_id
      if (mismaTarea && score >= UMBRAL_PARECIDO) {
        pares.push({ a, b, score: Math.max(score, UMBRAL_DUPLICADO), motivo: 'misma_tarea' })
        continue
      }
      if (score >= UMBRAL_DUPLICADO) {
        pares.push({ a, b, score, motivo: 'texto_casi_igual' })
        continue
      }
      if (score >= UMBRAL_PARECIDO) {
        pares.push({ a, b, score, motivo: 'texto_parecido' })
      }
    }
  }

  return pares.sort((x, y) => y.score - x.score)
}

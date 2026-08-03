/**
 * Catalogo unificado de la Academia: los cursos oficiales (codigo) mas los
 * cursos escritos por el equipo (BD, ya aprobados).
 *
 * POR QUE EXISTE ESTE ARCHIVO. Hasta ahora el catalogo era `COURSE_BY_ID`, un
 * objeto sincrono construido al importar `courses.ts`. Con cursos en BD la
 * lectura pasa a ser asincrona, y cambiar diez lugares a la vez es justo la
 * clase de cambio que rompe algo en silencio. Asi que este modulo NO sustituye
 * al objeto: lo envuelve.
 *
 * LA REGLA QUE LO HACE BARATO. Todo curso del equipo empieza por 'eq-' (lo
 * obliga un CHECK en la BD) y ningun curso oficial empieza por 'eq-'. Entonces
 * el id SOLO dice de donde viene, sin consultar nada:
 *
 *   - id sin 'eq-'  -> curso oficial, se resuelve EN MEMORIA, cero queries.
 *     Los 12 cursos que ya existen no pagan ni un milisegundo por esta feature.
 *   - id con 'eq-'  -> curso del equipo, se va a la BD.
 *
 * Y el origen no se guarda en ninguna columna: se DERIVA del id. Una columna
 * `es_oficial` seria un segundo lugar donde la verdad puede desincronizarse.
 *
 * ESTADOS: el resto de la Academia entiende 'live' | 'draft' | 'soon'. Un curso
 * del equipo solo entra al catalogo publico cuando esta 'published', y entonces
 * se presenta como 'live'. Los demas estados no existen para quien no es su
 * autor ni admin.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { COURSES, COURSE_BY_ID } from './courses'
import type { Course, CourseLang, Module } from './types'

/** Prefijo obligatorio de todo curso escrito por el equipo. */
export const PREFIJO_EQUIPO = 'eq-'

/** Estados posibles de un curso del equipo (espejo del CHECK en la BD). */
export type EstadoCursoEquipo =
  | 'draft'
  | 'pending_review'
  | 'published'
  | 'rejected'
  | 'archived'

/** Fila cruda de academy_custom_courses. */
export interface CursoEquipoRow {
  id: string
  course_id: string
  author_id: string | null
  status: EstadoCursoEquipo
  title: string
  subtitle: string
  track: string
  icon: string
  accent: string
  lang: CourseLang
  cert_name: string
  modules: unknown
  submitted_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

/**
 * True si el curso lo escribio el equipo (no viene de courses.ts).
 *
 * Sirve para ETIQUETARLO en la interfaz. Que un curso del equipo se pueda
 * confundir con uno oficial seria el peor resultado posible de esta feature:
 * la autoridad de un curso viene de saber quien responde por el.
 */
export function esCursoDeEquipo(courseId: string): boolean {
  return courseId.startsWith(PREFIJO_EQUIPO)
}

/**
 * Convierte una fila de BD al mismo `Course` que consume toda la Academia.
 *
 * Los modulos se NORMALIZAN, no se confia en el jsonb. La BD garantiza que es
 * un array, no que cada elemento tenga forma de modulo. Un modulo sin `id`
 * romperia el guardado de progreso (academy_progress.module_id) y uno sin
 * `lessons` reventaria el renderer para TODO el que abra el curso. Se descartan
 * los invalidos en vez de tumbar la pagina entera: la validacion estricta vive
 * en el API al enviar a revision, asi que aqui esto no deberia dispararse nunca.
 */
export function filaACurso(row: CursoEquipoRow): Course {
  return {
    id: row.course_id,
    status: row.status === 'published' ? 'live' : 'draft',
    lang: row.lang,
    icon: row.icon,
    accent: row.accent,
    track: row.track,
    title: row.title,
    subtitle: row.subtitle,
    certName: row.cert_name || row.title,
    modules: normalizarModulos(row.modules),
  }
}

/** Deja solo los modulos que el resto de la Academia puede manejar. */
export function normalizarModulos(raw: unknown): Module[] {
  if (!Array.isArray(raw)) return []
  const vistos = new Set<string>()
  const out: Module[] = []
  for (const m of raw as Array<Partial<Module>>) {
    if (!m || typeof m !== 'object') continue
    const id = typeof m.id === 'string' ? m.id.trim() : ''
    // Sin id no hay donde colgar el progreso; repetido, dos modulos comparten
    // la misma fila de progreso y uno se marca completo al terminar el otro.
    if (!id || vistos.has(id)) continue
    if (!Array.isArray(m.lessons)) continue
    vistos.add(id)
    out.push({
      id,
      num: typeof m.num === 'string' ? m.num : String(out.length + 1).padStart(2, '0'),
      icon: typeof m.icon === 'string' && m.icon ? m.icon : 'book-open',
      dur: typeof m.dur === 'string' ? m.dur : '',
      title: typeof m.title === 'string' ? m.title : '',
      tag: typeof m.tag === 'string' ? m.tag : '',
      objectives: Array.isArray(m.objectives) ? m.objectives : undefined,
      lessons: m.lessons,
      quiz: Array.isArray(m.quiz) ? m.quiz : [],
    })
  }
  return out
}

/**
 * Resuelve UN curso por id, oficial o del equipo.
 *
 * `incluirBorradores` es para el editor y la cola de revision: ahi si hace
 * falta abrir un curso que todavia no esta publicado. Por defecto NO, para que
 * ninguna ruta normal pueda mostrar por accidente algo sin aprobar.
 */
export async function resolverCurso(
  courseId: string,
  opts?: { incluirBorradores?: boolean },
): Promise<Course | null> {
  if (!esCursoDeEquipo(courseId)) return COURSE_BY_ID[courseId] ?? null

  const admin = createAdminClient()
  let q = admin.from('academy_custom_courses').select('*').eq('course_id', courseId)
  if (!opts?.incluirBorradores) q = q.eq('status', 'published')
  const { data } = (await q.maybeSingle()) as { data: CursoEquipoRow | null }
  return data ? filaACurso(data) : null
}

/**
 * Catalogo completo visible para cualquiera: los oficiales + los aprobados.
 *
 * Los del equipo van DESPUES de los oficiales a proposito. No es jerarquia de
 * calidad, es previsibilidad: la biblioteca no se reordena sola cada vez que
 * alguien publica algo.
 */
export async function listarCursosVisibles(): Promise<Course[]> {
  const admin = createAdminClient()
  const { data, error } = (await admin
    .from('academy_custom_courses')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: true })) as {
    data: CursoEquipoRow[] | null
    error: unknown
  }

  // Si la consulta falla, la Academia oficial NO se cae con ella.
  if (error) {
    console.error('[academy catalog] no se pudieron leer los cursos del equipo:', error)
    return COURSES
  }
  return [...COURSES, ...(data ?? []).map(filaACurso)]
}

/** Los cursos que escribio una persona, en cualquier estado ("mis cursos"). */
export async function listarCursosDeAutor(userId: string): Promise<CursoEquipoRow[]> {
  const admin = createAdminClient()
  const { data } = (await admin
    .from('academy_custom_courses')
    .select('*')
    .eq('author_id', userId)
    .order('updated_at', { ascending: false })) as { data: CursoEquipoRow[] | null }
  return data ?? []
}

/** Autor resuelto para las vistas de admin. */
export type AutorCurso = {
  id: string
  display_name: string | null
  avatar_url: string | null
  email: string | null
}

/**
 * Lo que la pantalla de revision necesita, ni una columna mas.
 *
 * Es un Pick y no `CursoEquipoRow` entero a proposito: el tipo describe lo que
 * el SELECT realmente trae. Declarar la fila completa cuando se piden 15
 * columnas hace que TypeScript avale leer `published_at` y que en tiempo de
 * ejecucion valga `undefined`, sin un solo error.
 */
export type CursoParaRevisar = Pick<
  CursoEquipoRow,
  | 'id'
  | 'course_id'
  | 'author_id'
  | 'status'
  | 'title'
  | 'subtitle'
  | 'track'
  | 'icon'
  | 'accent'
  | 'lang'
  | 'cert_name'
  | 'modules'
  | 'review_note'
  | 'submitted_at'
  | 'updated_at'
> & { autor: AutorCurso | null }

/**
 * Cursos del equipo en los estados que le importan a un mando, con su autor.
 *
 * Orden ascendente por `submitted_at`, igual que las solicitudes de acceso: lo
 * que lleva mas tiempo esperando va primero. Quien escribio un curso y lleva
 * una semana sin respuesta no vuelve a escribir otro.
 *
 * Se pide por estados y no solo "pendientes" porque la pantalla de revision
 * tambien tiene que dejar REABRIR y ARCHIVAR lo ya publicado. Si lo publicado
 * no se ve ahi, la unica forma de corregir un curso vivo seria adivinar su id.
 *
 * El embed nombra la constraint (`..._author_id_fkey`) porque esta tabla tiene
 * DOS llaves foraneas a profiles y PostgREST responde HTTP 300 a un embed
 * ambiguo.
 */
export async function listarCursosDeEquipoParaAdmin(
  estados: EstadoCursoEquipo[],
): Promise<CursoParaRevisar[]> {
  if (estados.length === 0) return []
  const admin = createAdminClient()
  const { data } = (await admin
    .from('academy_custom_courses')
    .select(
      'id, course_id, author_id, status, title, subtitle, track, icon, accent, lang, cert_name, modules, review_note, submitted_at, updated_at, autor:profiles!academy_custom_courses_author_id_fkey ( id, display_name, avatar_url, email )',
    )
    .in('status', estados)
    .order('submitted_at', { ascending: true })) as { data: CursoParaRevisar[] | null }
  return data ?? []
}

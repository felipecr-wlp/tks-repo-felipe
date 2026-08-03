/**
 * PATCH  /api/academy/courses/[id]   -> guardar, enviar a revision, aprobar,
 *                                       rechazar, reabrir o archivar
 * DELETE /api/academy/courses/[id]   -> el autor borra su propio BORRADOR
 *
 * TODA la autorizacion de esta feature vive en la tabla TRANSICIONES de
 * `@/lib/academy/flujo-curso`, NO aqui. Este archivo hace el trabajo sucio
 * (leer, escribir, avisar) pero no decide quien puede que: solo pregunta.
 * Esta separado a proposito por dos razones: si las reglas estuvieran
 * repartidas en ifs por el route handler, agregar una accion nueva obligaria
 * a acordarse de todas las anteriores, y de eso no se acuerda nadie; y siendo
 * una funcion pura, un tripwire puede interrogarla sin levantar Next ni la
 * base. Una accion sin fila en esa tabla simplemente no existe.
 *
 * LA REGLA QUE SOSTIENE LA AUTORIZACION: un curso PUBLICADO no lo puede editar
 * su autor. Si pudiera, la aprobacion seria teatro: bastaria con publicar algo
 * inocuo y despues cambiarlo por otra cosa. Para modificarlo, un admin lo
 * REABRE (vuelve a borrador y sale de la biblioteca) y despues vuelve a
 * aprobarlo. Reabrir no destruye nada: el progreso y los accesos estan en
 * tablas aparte y siguen ahi cuando se republica.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { createNotification } from '@/lib/activity'
import { isOrgAdmin } from '@/lib/team-access'
import { validarCurso } from '@/lib/academy/validar-curso'
import { TRANSICIONES, evaluarAccion, type AccionCurso } from '@/lib/academy/flujo-curso'
import type { CursoEquipoRow } from '@/lib/academy/catalog'
import type { Database, Json } from '@/lib/supabase/types'

/** Solo las columnas que existen: un typo en el nombre no compila. */
type PatchCurso = Database['public']['Tables']['academy_custom_courses']['Update']

/**
 * Forma de un modulo, declarada de verdad y no `passthrough()`.
 *
 * Tentacion: los modulos son contenido libre, asi que dejar pasar cualquier
 * objeto parece practico. No lo es. Esto se guarda en una columna JSON y se
 * RENDERIZA despues; lo que entre sin forma sale sin forma, y el dia que el
 * editor mande una llave con otro nombre (`questions` en vez de `quiz`) nada
 * falla aqui: el curso se guarda, se publica, y el modulo simplemente no tiene
 * examen. Zod descarta por omision las llaves que no estan declaradas, asi que
 * declararlas es lo que hace que un typo se note al guardar y no seis semanas
 * despues. Los limites son generosos a proposito: frenan el abuso, no la
 * escritura.
 */
const bloqueSchema = z
  .object({
    type: z.string().trim().max(20),
    v: z.union([z.string().max(20000), z.array(z.string().max(4000)).max(200)]).optional(),
    head: z.array(z.string().max(400)).max(20).optional(),
    rows: z.array(z.array(z.string().max(2000)).max(20)).max(200).optional(),
    style: z.string().trim().max(20).optional(),
    ci: z.string().trim().max(40).optional(),
    lab: z.string().trim().max(120).optional(),
  })
  .strict()

const preguntaSchema = z
  .object({
    q: z.string().max(1000),
    opts: z.array(z.string().max(600)).max(10),
    a: z.number().int(),
    ex: z.string().max(2000).optional(),
  })
  .strict()

// Se acepta lo malformado y lo incompleto A PROPOSITO: un borrador a medias
// tiene que poder guardarse. Quien decide si el curso esta listo es
// `validarCurso`, y solo al enviarlo a revision. Este esquema define la FORMA;
// la calidad se juzga despues.
const moduloSchema = z
  .object({
    id: z.string().trim().max(60).optional(),
    num: z.string().trim().max(10).optional(),
    icon: z.string().trim().max(40).optional(),
    dur: z.string().trim().max(40).optional(),
    title: z.string().trim().max(200).optional(),
    tag: z.string().trim().max(60).optional(),
    objectives: z.array(z.string().max(600)).max(20).optional(),
    lessons: z
      .array(
        z.object({ t: z.string().max(200).optional(), blocks: z.array(bloqueSchema).max(200).optional() }).strict(),
      )
      .max(40)
      .optional(),
    quiz: z.array(preguntaSchema).max(40).optional(),
  })
  .strict()

const schema = z.object({
  action: z.enum(['guardar', 'enviar', 'retirar', 'aprobar', 'rechazar', 'reabrir', 'archivar']),
  workspaceId: z.string().uuid().optional().nullable(),
  nota: z.string().trim().max(1000).optional().nullable(),
  // Solo se leen cuando la accion es 'guardar'.
  title: z.string().trim().min(3).max(120).optional(),
  subtitle: z.string().trim().max(240).optional(),
  track: z.string().trim().max(60).optional(),
  icon: z.string().trim().max(40).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  lang: z.enum(['es', 'en']).optional(),
  certName: z.string().trim().max(160).optional(),
  modules: z.array(moduloSchema).max(60).optional(),
})
  // Estricto por la misma razon que los bloques y las preguntas de abajo, y con
  // un caso ya vivido: el panel de revision mandaba la nota del rechazo en un
  // campo llamado `note`. Zod la descartaba sin decir nada y el API respondia
  // "hace falta explicar el motivo" a un revisor que acababa de escribirlo. Con
  // .strict() eso es un 422 que NOMBRA el campo sobrante, en el primer intento.
  .strict()

/** Lo unico que este handler necesita leer del curso. Nada mas. */
const COLUMNAS = 'id, course_id, author_id, status, title, subtitle, modules'
type CursoParaDecidir = Pick<
  CursoEquipoRow,
  'id' | 'course_id' | 'author_id' | 'status' | 'title' | 'subtitle' | 'modules'
>

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  // Sin esto, un id basura no da 404: Postgres revienta con 22P02 y sale un 500
  // opaco, que ademas es un boton para generar 500s a voluntad.
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Identificador inválido' }, { status: 422 })
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()
  const { data: curso } = (await admin
    .from('academy_custom_courses')
    .select(COLUMNAS)
    .eq('id', params.id)
    .maybeSingle()) as { data: CursoParaDecidir | null }
  if (!curso) return NextResponse.json({ error: 'Curso no encontrado' }, { status: 404 })

  const accion = parsed.data.action as AccionCurso
  const regla = TRANSICIONES[accion]
  const nota = parsed.data.nota?.trim() || null

  // Quien puede, desde que estado y con que nota: TODO lo decide la tabla de
  // transiciones, en una funcion pura que un tripwire puede interrogar.
  // Un admin NO entra por la puerta del autor: si pudiera guardar por el, el
  // curso diria "escrito por X" con texto que X no escribio.
  const veredicto = evaluarAccion({
    accion,
    estadoActual: curso.status,
    esAutor: curso.author_id === user.id,
    esAdmin: await isOrgAdmin(user.id),
    tieneNota: Boolean(nota),
  })
  if (!veredicto.ok) {
    return NextResponse.json({ error: veredicto.error }, { status: veredicto.estado })
  }

  // Contenido.
  const contenido = {
    title: parsed.data.title ?? curso.title,
    subtitle: parsed.data.subtitle ?? curso.subtitle,
    modules: (parsed.data.modules ?? curso.modules) as unknown,
  }
  if (regla.validaContenido) {
    const problemas = validarCurso(contenido)
    if (problemas.length > 0) {
      return NextResponse.json(
        { error: 'El curso todavía no está listo', problemas },
        { status: 422 },
      )
    }
  }

  const ahora = new Date().toISOString()
  const patch: PatchCurso = { updated_at: ahora }
  if (regla.hacia) patch.status = regla.hacia

  if (accion === 'guardar') {
    if (parsed.data.title !== undefined) patch.title = parsed.data.title
    if (parsed.data.subtitle !== undefined) patch.subtitle = parsed.data.subtitle
    if (parsed.data.track !== undefined) patch.track = parsed.data.track
    if (parsed.data.icon !== undefined) patch.icon = parsed.data.icon
    if (parsed.data.accent !== undefined) patch.accent = parsed.data.accent
    if (parsed.data.lang !== undefined) patch.lang = parsed.data.lang
    if (parsed.data.certName !== undefined) patch.cert_name = parsed.data.certName
    if (parsed.data.modules !== undefined) patch.modules = parsed.data.modules as unknown as Json
  }
  if (accion === 'enviar') {
    patch.submitted_at = ahora
    patch.review_note = null // el motivo del rechazo anterior ya no aplica
  }
  if (accion === 'aprobar' || accion === 'rechazar') {
    patch.reviewed_by = user.id
    patch.reviewed_at = ahora
    patch.review_note = nota
  }
  if (accion === 'aprobar') patch.published_at = ahora
  if (accion === 'reabrir') {
    patch.published_at = null
    patch.review_note = nota
  }

  // ORDEN: al aprobar, primero se le da acceso al autor y luego se publica. Al
  // reves, si el acceso fallara el curso quedaria publicado y su propio autor no
  // podria abrirlo. En este orden el peor caso es que tenga acceso a algo que
  // todavia no esta publicado, que no le hace daño a nadie.
  if (accion === 'aprobar' && curso.author_id) {
    const { error: accErr } = await admin
      .from('academy_access')
      .upsert(
        { profile_id: curso.author_id, course_id: curso.course_id, granted_by: user.id },
        { onConflict: 'profile_id,course_id' },
      )
    if (accErr) {
      console.error('[academy courses PATCH] acceso autor:', accErr)
      return NextResponse.json({ error: 'No se pudo dar acceso al autor' }, { status: 500 })
    }
  }

  const { error } = await admin.from('academy_custom_courses').update(patch).eq('id', curso.id)
  if (error) {
    console.error('[academy courses PATCH] error:', error)
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 })
  }

  await avisar(accion, curso, user.id, parsed.data.workspaceId ?? null, admin)

  return NextResponse.json({ ok: true, status: regla.hacia ?? curso.status })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Identificador inválido' }, { status: 422 })
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: curso } = (await admin
    .from('academy_custom_courses')
    .select('id, author_id, status')
    .eq('id', params.id)
    .maybeSingle()) as { data: Pick<CursoEquipoRow, 'id' | 'author_id' | 'status'> | null }
  if (!curso) return NextResponse.json({ error: 'Curso no encontrado' }, { status: 404 })
  if (curso.author_id !== user.id) {
    return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
  }
  // Solo borradores. Un curso publicado (o esperando revision) ya no es un
  // papel personal: hay gente estudiandolo o alguien a punto de revisarlo. Para
  // sacarlo de circulacion esta 'archivar', que no borra el historial.
  if (curso.status !== 'draft') {
    return NextResponse.json(
      { error: 'Solo se puede borrar un borrador. Si ya se publicó, pide que lo archiven.' },
      { status: 409 },
    )
  }

  const { error } = await admin.from('academy_custom_courses').delete().eq('id', curso.id)
  if (error) {
    console.error('[academy courses DELETE] error:', error)
    return NextResponse.json({ error: 'No se pudo borrar' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

/**
 * Avisa a quien corresponda. Best-effort: que falle una notificacion no puede
 * deshacer una aprobacion que ya ocurrio.
 */
async function avisar(
  accion: AccionCurso,
  curso: CursoParaDecidir,
  actorId: string,
  workspaceId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
) {
  if (!workspaceId) return
  try {
    if (accion === 'enviar') {
      // A los mandos: hay algo esperando decision.
      const { data: admins } = await admin
        .from('profiles')
        .select('id')
        .in('org_role', ['owner', 'admin'])
      for (const a of (admins ?? []) as Array<{ id: string }>) {
        if (a.id === actorId) continue
        await createNotification({
          recipient_id: a.id,
          subject_id: actorId,
          type: 'academy_course_submitted',
          object_type: 'academy_course',
          object_title: curso.title,
          workspace_id: workspaceId,
        })
      }
      return
    }
    const tipos: Partial<Record<AccionCurso, string>> = {
      aprobar: 'academy_course_published',
      rechazar: 'academy_course_rejected',
      reabrir: 'academy_course_reopened',
      archivar: 'academy_course_archived',
    }
    const type = tipos[accion]
    if (!type || !curso.author_id || curso.author_id === actorId) return
    await createNotification({
      recipient_id: curso.author_id,
      subject_id: actorId,
      type,
      object_type: 'academy_course',
      object_title: curso.title,
      workspace_id: workspaceId,
    })
  } catch {
    /* best-effort */
  }
}

/**
 * GET  /api/academy/courses    -> mis cursos (los que yo escribi, en cualquier estado)
 * POST /api/academy/courses    -> crea un borrador vacio y devuelve su id
 *
 * Cualquiera que este dentro puede ESCRIBIR un curso. Publicarlo es otra cosa:
 * eso pasa por revision de un admin/owner (ver [id]/route.ts). Separar las dos
 * puertas es justo el punto de la feature. Si escribir requiriera permiso, se
 * repetiria el cuello de botella que se quiso quitar: el contenido dejaria de
 * depender de saber programar para depender de que alguien te habilite.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { listarCursosDeAutor } from '@/lib/academy/catalog'
import { idDesdeTitulo, RE_COURSE_ID } from '@/lib/academy/validar-curso'

const schema = z.object({
  title: z.string().trim().min(3).max(120),
  subtitle: z.string().trim().max(240).optional(),
  track: z.string().trim().max(60).optional(),
  icon: z.string().trim().max(40).optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido')
    .optional(),
  lang: z.enum(['es', 'en']).optional(),
})

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  return NextResponse.json({ ok: true, courses: await listarCursosDeAutor(user.id) })
}

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })
  }

  const base = idDesdeTitulo(parsed.data.title)
  if (!base) {
    return NextResponse.json(
      { error: 'El título necesita al menos dos letras o números para poder generar una dirección.' },
      { status: 422 },
    )
  }

  const admin = createAdminClient()

  // Buscar un id libre. El unique de la BD es la garantia; esto solo evita que
  // la persona choque con un 409 por un titulo parecido al de alguien mas.
  // `base` sale de idDesdeTitulo, que hoy solo emite [a-z0-9-], asi que no
  // deberia traer comodines. Se escapa igual: la seguridad de esta linea no
  // puede depender de recordar como se comporta OTRA funcion. Si algun dia
  // idDesdeTitulo deja pasar un "_", aqui no se convierte en un LIKE que
  // machaca de mas.
  const escapado = base.replace(/[%_]/g, m => `\\${m}`)
  const { data: ocupados } = (await admin
    .from('academy_custom_courses')
    .select('course_id')
    .like('course_id', `${escapado}%`)) as { data: Array<{ course_id: string }> | null }
  const tomados = new Set((ocupados ?? []).map((r) => r.course_id))
  let courseId = base
  for (let n = 2; tomados.has(courseId) && n < 100; n++) {
    const cand = `${base}-${n}`
    courseId = RE_COURSE_ID.test(cand) ? cand : `${base.slice(0, 36)}-${n}`
  }
  if (tomados.has(courseId) || !RE_COURSE_ID.test(courseId)) {
    return NextResponse.json(
      { error: 'No se pudo generar una dirección libre para ese título. Cámbialo un poco.' },
      { status: 409 },
    )
  }

  const { data: creado, error } = await admin
    .from('academy_custom_courses')
    .insert({
      course_id: courseId,
      author_id: user.id,
      status: 'draft',
      title: parsed.data.title,
      subtitle: parsed.data.subtitle ?? '',
      track: parsed.data.track || 'Equipo',
      icon: parsed.data.icon || 'book-open',
      accent: parsed.data.accent || '#6366F1',
      lang: parsed.data.lang ?? 'es',
      cert_name: parsed.data.title,
      modules: [],
    })
    .select('id, course_id')
    .single()

  if (error || !creado) {
    console.error('[academy courses POST] error:', error)
    return NextResponse.json({ error: 'No se pudo crear el curso' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, course: creado }, { status: 201 })
}

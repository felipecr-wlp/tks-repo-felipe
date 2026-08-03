/**
 * POST /api/academy/grant
 *   Concede o revoca acceso a uno o varios cursos de forma directa (sin pasar
 *   por una solicitud), para asignacion por persona/rol. Solo admin/owner.
 *   Acepta:
 *     { profileId, courseId, action }           -> un curso (compat)
 *     { profileId, courseIds: [...], action }    -> varios cursos (bulk)
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isOrgAdmin } from '@/lib/academy/data'
import { resolverCurso } from '@/lib/academy/catalog'

const schema = z
  .object({
    profileId: z.string().uuid(),
    courseId: z.string().min(1).max(64).optional(),
    courseIds: z.array(z.string().min(1).max(64)).min(1).max(64).optional(),
    action: z.enum(['grant', 'revoke']),
  })
  .refine((d) => d.courseId || (d.courseIds && d.courseIds.length > 0), {
    message: 'Falta courseId o courseIds',
  })

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!(await isOrgAdmin(user.id))) {
    return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const { profileId, action } = parsed.data
  // Normaliza a lista, deduplica y valida que cada curso exista.
  const ids = Array.from(new Set(parsed.data.courseIds ?? [parsed.data.courseId!]))
  const resueltos = await Promise.all(
    ids.map(async (id) => [id, await resolverCurso(id)] as const),
  )
  const unknown = resueltos.filter(([, curso]) => !curso).map(([id]) => id)
  if (unknown.length > 0) {
    return NextResponse.json({ error: `Curso no encontrado: ${unknown.join(', ')}` }, { status: 404 })
  }

  const admin = createAdminClient()

  if (action === 'grant') {
    const rows = ids.map((course_id) => ({ profile_id: profileId, course_id, granted_by: user.id }))
    const { error } = await admin
      .from('academy_access')
      .upsert(rows, { onConflict: 'profile_id,course_id' })
    if (error) {
      console.error('[academy grant] error:', error)
      return NextResponse.json({ error: 'No se pudo conceder' }, { status: 500 })
    }
  } else {
    const { error } = await admin
      .from('academy_access')
      .delete()
      .eq('profile_id', profileId)
      .in('course_id', ids)
    if (error) {
      console.error('[academy revoke] error:', error)
      return NextResponse.json({ error: 'No se pudo revocar' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, count: ids.length })
}

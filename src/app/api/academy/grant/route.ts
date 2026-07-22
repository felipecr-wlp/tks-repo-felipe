/**
 * POST /api/academy/grant  { profileId, courseId, action: 'grant' | 'revoke' }
 *   Solo admin/owner de la org. Concede o revoca acceso a un curso de forma
 *   directa (sin pasar por una solicitud), para asignacion por perfil.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isOrgAdmin } from '@/lib/academy/data'
import { COURSE_BY_ID } from '@/lib/academy/courses'

const schema = z.object({
  profileId: z.string().uuid(),
  courseId: z.string().min(1).max(64),
  action: z.enum(['grant', 'revoke']),
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
  if (!COURSE_BY_ID[parsed.data.courseId]) {
    return NextResponse.json({ error: 'Curso no encontrado' }, { status: 404 })
  }

  const admin = createAdminClient()

  if (parsed.data.action === 'grant') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from('academy_access')
      .upsert(
        { profile_id: parsed.data.profileId, course_id: parsed.data.courseId, granted_by: user.id },
        { onConflict: 'profile_id,course_id' },
      )
    if (error) {
      console.error('[academy grant] error:', error)
      return NextResponse.json({ error: 'No se pudo conceder' }, { status: 500 })
    }
  } else {
    const { error } = await admin
      .from('academy_access')
      .delete()
      .eq('profile_id', parsed.data.profileId)
      .eq('course_id', parsed.data.courseId)
    if (error) {
      console.error('[academy revoke] error:', error)
      return NextResponse.json({ error: 'No se pudo revocar' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

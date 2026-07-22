/**
 * POST /api/academy/progress  { courseId, moduleId, score }
 *   El usuario guarda su avance en un modulo (tras aprobar el quiz). Requiere
 *   tener acceso al curso. `completed` se deriva: score >= 70 aprueba el modulo.
 *   Upsert idempotente por (profile_id, course_id, module_id).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canAccessCourse } from '@/lib/academy/data'
import { COURSE_BY_ID } from '@/lib/academy/courses'

const PASS_SCORE = 70

const schema = z.object({
  courseId: z.string().min(1).max(64),
  moduleId: z.string().min(1).max(64),
  score: z.number().int().min(0).max(100),
})

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const course = COURSE_BY_ID[parsed.data.courseId]
  if (!course) return NextResponse.json({ error: 'Curso no encontrado' }, { status: 404 })
  if (!course.modules.some((m) => m.id === parsed.data.moduleId)) {
    return NextResponse.json({ error: 'Módulo no encontrado' }, { status: 404 })
  }

  if (!(await canAccessCourse(user.id, course.id))) {
    return NextResponse.json({ error: 'Sin acceso al curso' }, { status: 403 })
  }

  const admin = createAdminClient()
  const completed = parsed.data.score >= PASS_SCORE

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('academy_progress')
    .upsert(
      {
        profile_id: user.id,
        course_id: course.id,
        module_id: parsed.data.moduleId,
        score: parsed.data.score,
        completed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id,course_id,module_id' },
    )

  if (error) {
    console.error('[academy progress] error:', error)
    return NextResponse.json({ error: 'No se pudo guardar el avance' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, completed })
}

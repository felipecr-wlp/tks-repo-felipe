/**
 * POST /api/academy/certificate  { courseId }
 *   Emite el certificado del curso al usuario SI completo todos los modulos
 *   (progress.completed = true en cada uno). El puntaje del certificado es el
 *   promedio de los modulos. Idempotente: si ya existe, lo devuelve.
 *   Codigo unico: WLP-<PREFIJO>-<score>-<anio>.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canAccessCourse } from '@/lib/academy/data'
import { COURSE_BY_ID } from '@/lib/academy/courses'

const schema = z.object({ courseId: z.string().min(1).max(64) })

function coursePrefix(courseId: string): string {
  return courseId.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'CRS'
}

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

  if (!(await canAccessCourse(user.id, course.id))) {
    return NextResponse.json({ error: 'Sin acceso al curso' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Si ya tiene certificado, devolverlo.
  const { data: existing } = await admin
    .from('academy_certificates')
    .select('*')
    .eq('profile_id', user.id)
    .eq('course_id', course.id)
    .maybeSingle()
  if (existing) return NextResponse.json({ ok: true, certificate: existing, alreadyIssued: true })

  // Verificar que TODOS los modulos esten completos.
  const { data: progress } = (await admin
    .from('academy_progress')
    .select('module_id, score, completed')
    .eq('profile_id', user.id)
    .eq('course_id', course.id)) as {
    data: Array<{ module_id: string; score: number; completed: boolean }> | null
  }
  const done = new Map((progress ?? []).filter((p) => p.completed).map((p) => [p.module_id, p.score]))
  const allDone = course.modules.every((m) => done.has(m.id))
  if (!allDone) {
    return NextResponse.json(
      { error: 'Debes completar todos los módulos antes de certificarte' },
      { status: 422 },
    )
  }

  const scores = course.modules.map((m) => done.get(m.id) ?? 0)
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  const year = new Date().getFullYear()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  const code = `WLP-${coursePrefix(course.id)}-${avg}-${year}-${rand}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cert, error } = await (admin as any)
    .from('academy_certificates')
    .insert({ profile_id: user.id, course_id: course.id, code, score: avg })
    .select('*')
    .single()

  if (error || !cert) {
    console.error('[academy certificate] error:', error)
    return NextResponse.json({ error: 'No se pudo emitir el certificado' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, certificate: cert }, { status: 201 })
}

/**
 * POST /api/academy/access  { courseId, note?, workspaceId? }
 *   El usuario autenticado SOLICITA acceso a un curso. Crea una fila pendiente
 *   en academy_access_requests (idempotente: si ya hay una pendiente, la
 *   devuelve). Notifica a los admins de la org (best-effort).
 *
 * No concede acceso: eso lo hace un admin al aprobar (PATCH .../[requestId]).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { createNotification } from '@/lib/activity'
import { resolverCurso } from '@/lib/academy/catalog'

const schema = z.object({
  courseId: z.string().min(1).max(64),
  note: z.string().max(500).optional().nullable(),
  workspaceId: z.string().uuid().optional().nullable(),
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

  const course = await resolverCurso(parsed.data.courseId)
  if (!course) return NextResponse.json({ error: 'Curso no encontrado' }, { status: 404 })

  const admin = createAdminClient()

  // Si ya tiene acceso, no tiene sentido solicitar.
  const { data: existingAccess } = await admin
    .from('academy_access')
    .select('id')
    .eq('profile_id', user.id)
    .eq('course_id', course.id)
    .maybeSingle()
  if (existingAccess) {
    return NextResponse.json({ ok: true, status: 'approved', alreadyGranted: true })
  }

  // Solicitud pendiente idempotente (indice unico parcial en la BD).
  const { data: pending } = await admin
    .from('academy_access_requests')
    .select('id, status')
    .eq('profile_id', user.id)
    .eq('course_id', course.id)
    .eq('status', 'pending')
    .maybeSingle()
  if (pending) {
    return NextResponse.json({ ok: true, status: 'pending', requestId: pending.id })
  }

  const { data: created, error } = await admin
    .from('academy_access_requests')
    .insert({
      profile_id: user.id,
      course_id: course.id,
      status: 'pending',
      note: parsed.data.note ?? null,
    })
    .select('id')
    .single()

  if (error || !created) {
    console.error('[academy access POST] error:', error)
    return NextResponse.json({ error: 'No se pudo crear la solicitud' }, { status: 500 })
  }

  // Notificar a los admins de la org (best-effort, no rompe el flujo).
  const wsId = parsed.data.workspaceId
  if (wsId) {
    try {
      const { data: admins } = await admin
        .from('profiles')
        .select('id')
        .in('org_role', ['owner', 'admin'])
      for (const a of (admins ?? []) as Array<{ id: string }>) {
        if (a.id === user.id) continue
        await createNotification({
          recipient_id: a.id,
          subject_id: user.id,
          type: 'academy_access_requested',
          object_type: 'academy_course',
          object_title: course.title,
          workspace_id: wsId,
        })
      }
    } catch {
      /* best-effort */
    }
  }

  return NextResponse.json({ ok: true, status: 'pending', requestId: created.id }, { status: 201 })
}

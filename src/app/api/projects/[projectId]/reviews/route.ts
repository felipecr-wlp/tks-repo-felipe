/**
 * POST /api/projects/[projectId]/reviews: calificar a un compañero (ANONIMO).
 * GET  /api/projects/[projectId]/reviews: compañeros que puedo calificar + cuales ya califique.
 *
 * Anonimato por diseno:
 *   - El RLS de project_reviews impide que el EVALUADO lea las filas crudas.
 *   - Solo el autor ve las suyas (para no duplicar) y org owner/admin (moderacion).
 *   - La reputacion del evaluado se expone SOLO agregada, con k-anonimato (>= 3
 *     reviews), via la funcion profile_reputation() (ver /api/cv/[profileId]).
 *
 * Admin client + verificacion en handler (evita IDOR).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'

const rating = z.number().int().min(1).max(5)
const schema = z.object({
  reviewee_id:   z.string().uuid(),
  collaboration: rating,
  quality:       rating,
  reliability:   rating,
  communication: rating,
  comment:       z.string().max(1000).trim().nullable().optional(),
}).strict()

// ─── POST: calificar a un companero ────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  if (parsed.data.reviewee_id === user.id) {
    return NextResponse.json({ error: 'No puedes calificarte a ti mismo' }, { status: 422 })
  }

  const admin = createAdminClient()

  type ProjRow = { id: string; name: string; workspace_id: string; status: string }
  const { data: project } = await admin
    .from('projects')
    .select('id, name, workspace_id, status')
    .eq('id', params.projectId)
    .maybeSingle() as { data: ProjRow | null }
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })

  // La evaluacion de pares se habilita SOLO cuando el proyecto esta completado.
  if (project.status !== 'completed') {
    return NextResponse.json({ error: 'Solo se puede calificar cuando el proyecto esta completado' }, { status: 409 })
  }

  // Ambos deben ser miembros del proyecto
  const { data: members } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', project.id)
    .in('profile_id', [user.id, parsed.data.reviewee_id]) as { data: { profile_id: string }[] | null }
  const ids = new Set((members ?? []).map(m => m.profile_id))
  if (!ids.has(user.id)) return NextResponse.json({ error: 'No eres miembro de este proyecto' }, { status: 403 })
  if (!ids.has(parsed.data.reviewee_id)) return NextResponse.json({ error: 'El evaluado no es miembro del proyecto' }, { status: 422 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: review, error } = await (admin as any)
    .from('project_reviews')
    .insert({
      project_id:    project.id,
      workspace_id:  project.workspace_id,
      reviewer_id:   user.id,
      reviewee_id:   parsed.data.reviewee_id,
      collaboration: parsed.data.collaboration,
      quality:       parsed.data.quality,
      reliability:   parsed.data.reliability,
      communication: parsed.data.communication,
      comment:       parsed.data.comment ?? null,
    })
    .select('id')
    .single() as { data: { id: string } | null; error: { code?: string } | null }

  if (error?.code === '23505') {
    return NextResponse.json({ error: 'Ya calificaste a este compañero en este proyecto' }, { status: 409 })
  }
  if (error || !review) {
    console.error('[reviews POST] insert error:', error)
    return NextResponse.json({ error: 'Error al guardar la calificación' }, { status: 500 })
  }

  // Actividad SIN revelar al evaluado (anonimato): object es el proyecto, no la persona.
  logActivity({
    verb: ActivityVerbs.REVIEW_SUBMITTED,
    subject_id: user.id,
    object_type: 'project',
    object_id: project.id,
    object_title: project.name,
    workspace_id: project.workspace_id,
    project_id: project.id,
  }).catch(console.error)

  return NextResponse.json({ id: review.id }, { status: 201 })
}

// GET: compañeros a calificar + cuales ya califique
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  // El solicitante debe ser miembro del proyecto
  const { data: me } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', params.projectId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { profile_id: string } | null }
  if (!me) return NextResponse.json({ error: 'No eres miembro de este proyecto' }, { status: 403 })

  const { data: proj } = await admin
    .from('projects')
    .select('status')
    .eq('id', params.projectId)
    .maybeSingle() as { data: { status: string } | null }
  const canReview = proj?.status === 'completed'

  type MemberRow = { profile_id: string; profile: { id: string; display_name: string | null; avatar_url: string | null } | null }
  const { data: members } = await admin
    .from('project_members')
    .select('profile_id, profile:profiles!project_members_profile_id_fkey(id, display_name, avatar_url)')
    .eq('project_id', params.projectId)
    .neq('profile_id', user.id) as { data: MemberRow[] | null }

  // Cuales ya califique (solo MIS reviews; nunca las que otros me dieron)
  const { data: mine } = await admin
    .from('project_reviews')
    .select('reviewee_id')
    .eq('project_id', params.projectId)
    .eq('reviewer_id', user.id) as { data: { reviewee_id: string }[] | null }
  const reviewed = new Set((mine ?? []).map(r => r.reviewee_id))

  const teammates = (members ?? []).map(m => ({
    id: m.profile_id,
    display_name: m.profile?.display_name ?? null,
    avatar_url: m.profile?.avatar_url ?? null,
    reviewed: reviewed.has(m.profile_id),
  }))

  return NextResponse.json({ teammates, can_review: canReview })
}

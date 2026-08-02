/**
 * GET /api/projects/[projectId]/tasks/search?q=texto
 *
 * Busca tareas del proyecto por titulo (ILIKE) para pickers como el de
 * dependencias entre tareas. Devuelve { tasks: [{ id, title }] } (max 10).
 *
 * Authz: miembro del proyecto o de su workspace. Anti-IDOR: el projectId viene
 * de la ruta y se valida contra la membresia real; nunca del body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { ERROR_ACCESO_INDETERMINADO } from '@/lib/team-access'

const querySchema = z.object({ q: z.string().min(1).max(80).trim() })

/**
 * ¿Pertenece el user al proyecto o a su workspace? NO es la regla de
 * `canAccessProject` (@/lib/team-access), que exige owner/admin del workspace:
 * esta acepta a cualquier miembro del workspace. La diferencia es deliberada,
 * pero el nombre compartido no lo era: se llamaba igual que la barrera auditada,
 * asi que leerla (o buscarla) daba la impresion de estar viendo aquella.
 *
 * `failed` separa "no pertenece" de "no pude averiguarlo": antes las tres
 * lecturas descartaban su `error` y una base caida terminaba en 403.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function isProjectOrWorkspaceMember(admin: any, projectId: string, userId: string): Promise<{ ok: boolean; failed: boolean }> {
  const { data: project, error: projectErr } = await admin
    .from('projects')
    .select('id, workspace_id')
    .eq('id', projectId)
    .maybeSingle() as { data: { id: string; workspace_id: string } | null; error: unknown }
  if (projectErr) console.error('[tasks search] projects read error:', projectErr)
  if (!project) return { ok: false, failed: !!projectErr }

  const { data: pmem, error: pmemErr } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { profile_id: string } | null; error: unknown }
  if (pmemErr) console.error('[tasks search] project_members read error:', pmemErr)
  if (pmem) return { ok: true, failed: false }

  const { data: wmem, error: wmemErr } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', project.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { profile_id: string } | null; error: unknown }
  if (wmemErr) console.error('[tasks search] workspace_members read error:', wmemErr)
  const ok = !!wmem
  return { ok, failed: !ok && !!(pmemErr || wmemErr) }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } },
) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const parsed = querySchema.safeParse({ q: request.nextUrl.searchParams.get('q') })
  if (!parsed.success) return NextResponse.json({ tasks: [] })

  const admin = createAdminClient()
  const { ok, failed } = await isProjectOrWorkspaceMember(admin, params.projectId, user.id)
  if (failed) return NextResponse.json({ error: ERROR_ACCESO_INDETERMINADO }, { status: 500 })
  if (!ok) return NextResponse.json({ error: 'Sin acceso al proyecto' }, { status: 403 })

  const escaped = parsed.data.q.replace(/[%_]/g, m => `\\${m}`)
  const { data: tasks, error: tasksError } = await admin
    .from('tasks')
    .select('id, title')
    .eq('project_id', params.projectId)
    .eq('is_archived', false)
    .ilike('title', `%${escaped}%`)
    .order('sort_order', { ascending: true })
    .limit(10) as { data: { id: string; title: string }[] | null; error: unknown }

  if (tasksError) {
    console.error('[project tasks search GET] read error:', tasksError)
    return NextResponse.json({ error: 'Error al buscar tareas' }, { status: 500 })
  }

  return NextResponse.json({ tasks: tasks ?? [] })
}
